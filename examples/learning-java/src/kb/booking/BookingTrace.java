package kb.booking;

import java.time.*;
import java.util.*;
import static kb.booking.BookingService.*;

/** Emits deterministic state snapshots from the real teaching service, not a second booking algorithm. */
public final class BookingTrace {
    static String q(String s){return "\""+s.replace("\\","\\\\").replace("\"","\\\"")+"\"";}
    static String step(BookingService s, BookingChecks.Time t, String title, String note) {
        String seats=s.seats("evening").stream().map(v->"{\"number\":"+q(v.number())+",\"state\":"+q(v.state())+",\"owner\":"+q(v.owner())+"}").reduce((a,b)->a+","+b).orElse("");
        return "{\"title\":"+q(title)+",\"note\":"+q(note)+",\"clock\":"+q(t.instant().toString())+",\"seats\":["+seats+"],\"facts\":["+q("Pending refund intents: "+s.pendingRefunds().size())+"]}";
    }
    static String scenario(String id, String title, List<String> steps) {return "{\"id\":"+q(id)+",\"title\":"+q(title)+",\"steps\":["+String.join(",",steps)+"]}";}
    public static void main(String[] args) {
        List<String> cases=new ArrayList<>();
        for(String winner:List.of("A","B")) {
            String loser=winner.equals("A")?"B":"A";BookingChecks.Time t=new BookingChecks.Time();BookingService s=BookingChecks.service(t);List<String> steps=new ArrayList<>();
            steps.add(step(s,t,"Two customers choose A7 and A8","Both screens can show the same available seats. The service decides ownership when it processes a hold."));
            Reservation r=s.hold(winner,"cart","evening",List.of("A7","A8"));
            steps.add(step(s,t,winner+" wins the whole cart","Both seats belong to reservation "+winner+" for 120 seconds. ₹250 + ₹250 = ₹500; A9 remains free."));
            try{s.hold(loser,"cart","evening",List.of("A7","A8"));throw new AssertionError();}catch(IllegalStateException expected){}
            steps.add(step(s,t,loser+" receives a conflict","The second hold changes no seat ownership. A stale screen is not a reservation."));
            Attempt a=s.beginPayment(winner,r.id());s.acceptReceipt(r.id(),new Receipt(a.key(),Payment.CAPTURED,"paid-"+winner,a.amountPaise()));
            steps.add(step(s,t,"The payment is captured","The matching live hold becomes CONFIRMED. A duplicate receipt will not create a second booking."));
            cases.add(scenario("winner-"+winner,"Customer "+winner+" arrives first",steps));
        }
        BookingChecks.Time t=new BookingChecks.Time();BookingService s=BookingChecks.service(t);List<String> steps=new ArrayList<>();
        Reservation a=s.hold("A","cart","evening",List.of("A7","A8"));Attempt attempt=s.beginPayment("A",a.id());
        steps.add(step(s,t,"A starts payment","The seats are HELD, not sold. The payment attempt has one stable key."));
        s.acceptReceipt(a.id(),new Receipt(attempt.key(),Payment.UNKNOWN,"",0));t.advance(119);
        steps.add(step(s,t,"No definite payment result yet","A network timeout is UNKNOWN. At 119 seconds A still owns the seats; do not treat uncertainty as a decline."));
        t.advance(1);s.get("A",a.id());
        steps.add(step(s,t,"Exactly at expiry","At 120 seconds the reservation becomes EXPIRED and the seats become available. This example chooses a firm expiry deadline."));
        s.hold("B","cart","evening",List.of("A7","A8"));
        steps.add(step(s,t,"B now owns the seats","B has a different reservation ID. A's old token has no right to release B's seats."));
        Receipt late=new Receipt(attempt.key(),Payment.CAPTURED,"late-charge",50000);s.acceptReceipt(a.id(),late);
        steps.add(step(s,t,"A's successful payment arrives late","A stays EXPIRED, B stays HELD, and one refund intent records A's ₹500 capture. Creating an intent is not proof that a refund has completed."));
        s.acceptReceipt(a.id(),late);
        steps.add(step(s,t,"The provider retries the callback","Identical capture is a no-op: the same one refund intent remains."));
        cases.add(scenario("late-payment","Expiry and a late payment",steps));
        System.out.println("{\"id\":\"booking\",\"kind\":\"seats\",\"title\":\"Who owns A7 and A8?\",\"back\":\"../#/t/4/0\",\"description\":\"Step through recorded executions of the Java BookingService. Change arrival order or follow a late payment. No money is charged.\",\"scenarios\":["+String.join(",",cases)+"]}");
    }
}

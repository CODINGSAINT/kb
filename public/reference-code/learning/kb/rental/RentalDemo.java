package kb.rental;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import static kb.rental.Rental.*;

public final class RentalDemo {
    public static final Tariff RATE = new Tariff(180_000,20_000,50_000);
    public static final class Time extends Clock {
        private Instant now=Instant.parse("2026-10-28T08:00:00Z");
        public void at(String value) { now=Instant.parse(value); }
        public Instant instant() { return now; }
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return Clock.fixed(now,zone); }
    }
    public record Fixture(Time time, Service service) {}
    public static Fixture fixture() {
        Time time=new Time(); Service service=new Service(time,RATE);
        service.addVehicle("CAR17",Category.ECONOMY); service.customer("A",true); service.customer("B",true);
        return new Fixture(time,service);
    }
    public static Window window(String start,String end) { return new Window(Instant.parse(start),Instant.parse(end)); }
    public static ReservationView book(Service service,String request,String customer,Window window) {
        return service.reserve(request,customer,service.quote(customer,"CAR17",window).id());
    }
    private record Step(String title,String note,Instant now,VehicleView vehicle,List<ReservationView> reservations) {}
    private record Scenario(String id,String title,List<Step> steps) {}
    public static void main(String[] args) {
        List<Scenario> scenarios=List.of(boundary(),late(),replay());
        if (args.length==1 && args[0].equals("--json")) { System.out.println(json(scenarios)); return; }
        for (Scenario scenario:scenarios) { System.out.println(scenario.title()); for (Step step:scenario.steps())
            System.out.printf("  %s %s: active=%s readyAt=%s reservations=%d%n",step.now(),step.title(),step.vehicle().activeReservationId(),step.vehicle().readyAt(),step.reservations().size()); }
    }
    private static Scenario boundary() {
        Fixture f=fixture(); Service s=f.service(); List<Step> steps=new ArrayList<>();
        book(s,"A","A",window("2026-10-28T09:00:00Z","2026-10-28T11:00:00Z"));
        steps.add(step("A reserves 09:00 to 11:00","The blocking interval ends at 12:00 because preparation takes one hour. The quote is not an extra reservation.",f));
        try { book(s,"bad","B",window("2026-10-28T11:00:00Z","2026-10-28T12:00:00Z")); throw new AssertionError("Overlap expected"); }
        catch (IllegalStateException expected) { }
        steps.add(step("11:00 pickup is rejected","Touching the rental end is not enough: 11:00 is inside A's preparation period. No second reservation is inserted.",f));
        book(s,"B","B",window("2026-10-28T12:00:00Z","2026-10-28T13:00:00Z"));
        steps.add(step("12:00 pickup can be promised","The half-open blocking intervals touch at 12:00 and do not overlap. Actual handover will still recheck readiness.",f));
        return new Scenario("boundary","Planned time includes preparation",List.copyOf(steps));
    }
    private static Scenario late() {
        Fixture f=fixture(); Service s=f.service(); List<Step> steps=new ArrayList<>();
        var a=book(s,"A","A",window("2026-10-28T09:00:00Z","2026-10-28T11:00:00Z"));
        var b=book(s,"B","B",window("2026-10-28T12:00:00Z","2026-10-28T13:00:00Z"));
        f.time().at("2026-10-28T09:00:00Z"); s.pickup(a.id(),"A",new Reading(1_000,80,false));
        steps.add(step("A has the actual vehicle","A's agreement records the handover. B's future reservation remains a separate promise.",f));
        f.time().at("2026-10-28T12:00:00Z"); var result=s.pickup(b.id(),"B",new Reading(1_100,70,false));
        if (result.decision()!=Handover.NOT_READY) throw new AssertionError("Must not hand out active car");
        steps.add(step("B arrives; CAR17 has not returned","NOT_READY keeps B confirmed and A active. The readiness issue is visible; no fictional second handover occurs.",f));
        f.time().at("2026-10-28T12:10:00Z"); s.returnVehicle(a.id(),"A",new Reading(1_100,50,false));
        steps.add(step("A returns 70 minutes late","The invoice is Rs 1800 base plus two started late hours at Rs 200 = Rs 2200. Preparation now ends at 13:10, later than B's promised pickup.",f));
        f.time().at("2026-10-28T12:30:00Z"); if (s.expireNoShow(b.id())) throw new AssertionError("Not a customer no-show");
        steps.add(step("No-show job does not blame B","The operator could not provide the car. B's readiness conflict prevents automatic no-show cancellation or its fee.",f));
        s.cancel(b.id(),"B");
        steps.add(step("B takes the chosen remedy: free cancellation","B's reservation closes with a zero cancellation invoice. A replacement-car workflow is an extension, not an unimplemented promise of this solution.",f));
        return new Scenario("late","Late return makes the next promise at risk",List.copyOf(steps));
    }
    private static Scenario replay() {
        Fixture f=fixture(); Service s=f.service(); List<Step> steps=new ArrayList<>();
        var a=book(s,"A","A",window("2026-10-28T09:00:00Z","2026-10-28T10:00:00Z"));
        var b=book(s,"B","B",window("2026-10-28T11:00:00Z","2026-10-28T12:00:00Z"));
        f.time().at("2026-10-28T09:00:00Z"); s.pickup(a.id(),"A",new Reading(1_000,80,false));
        f.time().at("2026-10-28T10:00:00Z"); s.returnVehicle(a.id(),"A",new Reading(1_020,70,false));
        steps.add(step("R1 returns and preparation starts","The immutable return invoice belongs to R1. CAR17 is not ready until 11:00.",f));
        f.time().at("2026-10-28T11:00:00Z"); s.pickup(b.id(),"B",new Reading(1_020,70,false));
        steps.add(step("B picks up under R2","The current physical owner is R2. The old R1 remains in history.",f));
        s.returnVehicle(a.id(),"A",new Reading(1_020,70,false)); s.expireNoShow(a.id());
        steps.add(step("Old R1 return and no-show events arrive","The return replays R1's invoice, and its no-show job sees the wrong state. Neither clears R2's active ownership.",f));
        return new Scenario("replay","A vehicle ID is not a return token",List.copyOf(steps));
    }
    private static Step step(String title,String note,Fixture f) { return new Step(title,note,f.time().instant(),f.service().vehicle("CAR17"),f.service().reservations()); }
    private static String json(List<Scenario> scenarios) {
        StringBuilder out=new StringBuilder("{\"source\":\"kb.rental.RentalDemo --json\",\"scenarios\":[");
        for(int i=0;i<scenarios.size();i++) { if(i>0)out.append(','); var scenario=scenarios.get(i);
            out.append("{\"id\":").append(q(scenario.id())).append(",\"title\":").append(q(scenario.title())).append(",\"steps\":[");
            for(int j=0;j<scenario.steps().size();j++) { if(j>0)out.append(','); var step=scenario.steps().get(j);
                out.append("{\"title\":").append(q(step.title())).append(",\"note\":").append(q(step.note())).append(",\"now\":").append(q(step.now().toString()))
                    .append(",\"active\":").append(q(step.vehicle().activeReservationId())).append(",\"readyAt\":").append(q(step.vehicle().readyAt().equals(Instant.MIN)?null:step.vehicle().readyAt().toString())).append(",\"reservations\":[");
                for(int k=0;k<step.reservations().size();k++) { if(k>0)out.append(','); var r=step.reservations().get(k);
                    out.append("{\"id\":").append(q(r.id())).append(",\"customer\":").append(q(r.quote().customerId())).append(",\"state\":").append(q(r.state().name()))
                        .append(",\"start\":").append(q(r.quote().window().start().toString())).append(",\"end\":").append(q(r.quote().window().end().toString()))
                        .append(",\"blockedUntil\":").append(q(r.quote().window().blockedUntil().toString())).append(",\"basePaise\":").append(r.quote().basePaise())
                        .append(",\"issue\":").append(q(r.readinessIssue())).append(",\"invoicePaise\":").append(r.invoice()==null?"null":r.invoice().totalPaise()).append('}');
                } out.append("]}");
            } out.append("]}");
        } return out.append("]}").toString();
    }
    private static String q(String value) { return value==null?"null":"\""+value.replace("\\","\\\\").replace("\"","\\\"")+"\""; }
}

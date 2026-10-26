package kb.library;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import static kb.library.Library.*;

/** Synthetic local scenarios; --json exports the exact walkthrough snapshots. */
public final class LibraryDemo {
    public static final Plan BASIC = new Plan("Basic",2,14,1,50);
    public static final Plan PLUS = new Plan("Plus",4,21,1,25);
    public static final class DayClock extends Clock {
        private final AtomicReference<Instant> instant;
        private final ZoneId zone;
        public DayClock(String date) {
            zone = ZoneId.of("Asia/Kolkata");
            instant = new AtomicReference<>(LocalDate.parse(date).atStartOfDay(zone).toInstant());
        }
        private DayClock(AtomicReference<Instant> instant, ZoneId zone) { this.instant = instant; this.zone = zone; }
        public void set(String date) { instant.set(LocalDate.parse(date).atStartOfDay(zone).toInstant()); }
        public ZoneId getZone() { return zone; }
        public Clock withZone(ZoneId zone) { return new DayClock(instant,zone); }
        public Instant instant() { return instant.get(); }
    }
    public record Fixture(DayClock clock, Service service) {}
    public static Fixture fixture() {
        DayClock clock = new DayClock("2026-10-01"); Service service = new Service(clock);
        service.addEdition(new BookEdition("E1","demo-isbn-1","Practical Java","Example Author"));
        service.addCopy("C17","E1");
        service.addMember("A",BASIC); service.addMember("B",BASIC); service.addMember("C",PLUS);
        return new Fixture(clock,service);
    }
    private record Frame(String title, String explanation, LocalDate date, CopyView copy,
                         List<LoanView> loans, List<HoldView> holds, List<MemberView> members,
                         int returnCount, long fineCents, int notices) {}
    private record Scenario(String id, String title, String description, List<Frame> frames) {}

    public static void main(String[] args) {
        List<Scenario> scenarios = List.of(queueScenario(),renewScenario(),repairScenario());
        if (args.length == 1 && args[0].equals("--json")) { System.out.println(json(scenarios)); return; }
        for (Scenario scenario : scenarios) {
            System.out.println(scenario.title());
            for (Frame frame : scenario.frames()) System.out.printf("  %s %s: copy=%s loan=%s pickup=%s; fine=%d cents; return records=%d%n",
                frame.date(),frame.title(),frame.copy().state(),frame.copy().loanId(),
                frame.copy().pickup() == null ? "none" : frame.copy().pickup().token(),frame.fineCents(),frame.returnCount());
        }
    }

    private static Scenario queueScenario() {
        Fixture fixture = fixture(); Service service = fixture.service(); List<Frame> frames = new ArrayList<>();
        frames.add(frame("One edition, one physical copy", "E1 describes Practical Java. Barcode C17 identifies the particular item that can change hands.",fixture));
        LoanView first = service.checkout("checkout-A","C17","A",null);
        frames.add(frame("A borrows C17", "Loan L1 belongs to this visit. Fourteen calendar days from October 1 gives an inclusive due date of October 15.",fixture));
        fixture.clock().set("2026-10-02"); service.placeHold("H-B","E1","B");
        frames.add(frame("B joins the edition queue", "B is waiting for the next healthy E1 copy, not claiming C17 while A is still using it.",fixture));
        service.placeHold("H-C","E1","C");
        frames.add(frame("C joins behind B", "The title-level queue is FIFO: B before C. The edition is the queue key in this chosen scope.",fixture));
        fixture.clock().set("2026-10-05");
        try { service.renew("renew-blocked",first.id(),"A"); throw new AssertionError("Renewal should be denied"); }
        catch (IllegalStateException expected) { /* The scenario records the unchanged position. */ }
        frames.add(frame("A's renewal is denied", "Another reader has an outstanding hold. A keeps the original due date; renewal cannot jump ahead of B.",fixture));
        fixture.clock().set("2026-10-18"); service.returnCopy("C17",first.id(),Condition.GOOD);
        String oldToken = service.copy("C17").pickup().token();
        frames.add(frame("Return closes L1 and offers C17 to B", "Three overdue dates at 50 cents/day create one $1.50 fine record. The copy is assigned to B with token P1, pickup by October 20 inclusive. Payment is not called.",fixture));
        fixture.clock().set("2026-10-20"); service.expirePickup("C17",oldToken);
        frames.add(frame("The final pickup date is still valid", "October 20 is included. An expiry call today changes nothing; B still owns the pickup assignment.",fixture));
        fixture.clock().set("2026-10-21"); service.expirePickup("C17",oldToken);
        frames.add(frame("B misses pickup; C is next", "P1 expires. C gets a new assignment P2, pickup by October 23. The old token no longer owns C17.",fixture));
        service.expirePickup("C17",oldToken);
        frames.add(frame("An old P1 timer arrives again", "Its token does not match P2. The handler returns false before changing the copy, so C's assignment remains intact.",fixture));
        service.checkout("checkout-C","C17","C",service.copy("C17").pickup().token());
        frames.add(frame("C picks up with P2", "New loan L2 belongs to C. Plus is composed into the member and gives a 21-day loan, due November 11.",fixture));
        service.returnCopy("C17",first.id(),Condition.GOOD);
        frames.add(frame("A delayed L1 return is replayed", "The service returns L1's saved $1.50 receipt. It does not close C's L2, free C17 or assess the fine again.",fixture));
        return new Scenario("queue","A return, two waiting readers and stale events",
            "Follow edition E1 and barcode C17 from A's loan to B's pickup, then C's loan. Watch assignment and loan tokens protect the current owner.",List.copyOf(frames));
    }

    private static Scenario renewScenario() {
        Fixture fixture = fixture(); Service service = fixture.service(); List<Frame> frames = new ArrayList<>();
        LoanView loan = service.checkout("checkout-A","C17","A",null);
        frames.add(frame("A's first due date is October 15", "Basic has a 14-day loan and one permitted renewal. There are no waiting readers.",fixture));
        fixture.clock().set("2026-10-12"); service.renew("renew-1",loan.id(),"A");
        frames.add(frame("One renewal extends from the existing due date", "October 15 plus 14 days is October 29. The policy does not restart the clock at today's date.",fixture));
        service.renew("renew-1",loan.id(),"A");
        frames.add(frame("Retrying renew-1 does not extend again", "The saved renewal receipt is returned. The count stays one and the due date stays October 29.",fixture));
        fixture.clock().set("2026-10-29"); service.returnCopy("C17",loan.id(),Condition.GOOD);
        frames.add(frame("A returns on the due date", "The due date is inclusive, so the overdue-day count is zero. C17 becomes available and the return creates no charge.",fixture));
        return new Scenario("renew","Renew once, then return on the due date","A renewal needs an active, not-overdue loan, an unused renewal allowance and no other outstanding reader hold.",List.copyOf(frames));
    }

    private static Scenario repairScenario() {
        Fixture fixture = fixture(); Service service = fixture.service(); List<Frame> frames = new ArrayList<>();
        LoanView loan = service.checkout("checkout-A","C17","A",null); service.placeHold("H-B","E1","B");
        frames.add(frame("B waits while A has C17", "The hold belongs to edition E1. Returning this copy is not enough if the physical item is damaged.",fixture));
        fixture.clock().set("2026-10-15"); service.returnCopy("C17",loan.id(),Condition.DAMAGED);
        frames.add(frame("Damaged return goes to repair", "L1 is closed, but C17 is REPAIR rather than AVAILABLE. B remains waiting and no pickup notice is recorded yet.",fixture));
        service.finishRepair("C17");
        frames.add(frame("Repair completion allocates to B", "The repaired copy is assigned to the oldest eligible waiting reader with a new pickup token, not placed on the open shelf first.",fixture));
        return new Scenario("repair","A damaged return does not become lendable","Circulation history and physical condition are different facts: closing a loan must not make a damaged item available.",List.copyOf(frames));
    }

    private static Frame frame(String title, String explanation, Fixture fixture) {
        Service service = fixture.service();
        return new Frame(title,explanation,service.today(),service.copy("C17"),service.loans(),service.holds(),service.members(),
            service.returns().size(),service.returns().stream().mapToLong(ReturnReceipt::fineCents).sum(),service.pickupNotices().size());
    }
    private static String json(List<Scenario> scenarios) {
        StringBuilder out = new StringBuilder("{\"source\":\"kb.library.LibraryDemo --json\",\"scenarios\":[");
        for (int n = 0; n < scenarios.size(); n++) {
            if (n > 0) out.append(','); Scenario scenario = scenarios.get(n);
            out.append("{\"id\":").append(q(scenario.id())).append(",\"title\":").append(q(scenario.title()))
                .append(",\"description\":").append(q(scenario.description())).append(",\"frames\":[");
            for (int i = 0; i < scenario.frames().size(); i++) {
                if (i > 0) out.append(','); Frame frame = scenario.frames().get(i);
                out.append("{\"title\":").append(q(frame.title())).append(",\"explanation\":").append(q(frame.explanation()))
                    .append(",\"date\":").append(q(frame.date().toString())).append(",\"copy\":{\"id\":").append(q(frame.copy().id()))
                    .append(",\"state\":").append(q(frame.copy().state().name())).append(",\"loanId\":").append(q(frame.copy().loanId()))
                    .append(",\"pickup\":").append(pickup(frame.copy().pickup())).append("},\"loans\":[");
                for (int j = 0; j < frame.loans().size(); j++) {
                    if (j > 0) out.append(','); LoanView loan = frame.loans().get(j);
                    out.append("{\"id\":").append(q(loan.id())).append(",\"memberId\":").append(q(loan.memberId()))
                        .append(",\"due\":").append(q(loan.due().toString())).append(",\"returned\":").append(q(loan.returned() == null ? null : loan.returned().toString()))
                        .append(",\"renewals\":").append(loan.renewals()).append('}');
                }
                out.append("],\"holds\":[");
                for (int j = 0; j < frame.holds().size(); j++) {
                    if (j > 0) out.append(','); HoldView hold = frame.holds().get(j);
                    out.append("{\"id\":").append(q(hold.id())).append(",\"memberId\":").append(q(hold.memberId()))
                        .append(",\"state\":").append(q(hold.state().name())).append(",\"pickup\":").append(pickup(hold.pickup())).append('}');
                }
                out.append("],\"members\":[");
                for (int j = 0; j < frame.members().size(); j++) {
                    if (j > 0) out.append(','); MemberView member = frame.members().get(j);
                    out.append("{\"id\":").append(q(member.id())).append(",\"plan\":").append(q(member.plan().name()))
                        .append(",\"activeLoans\":").append(member.activeLoans()).append(",\"limit\":").append(member.plan().maxLoans()).append('}');
                }
                out.append("],\"returnCount\":").append(frame.returnCount()).append(",\"fineCents\":").append(frame.fineCents())
                    .append(",\"noticeCount\":").append(frame.notices()).append('}');
            }
            out.append("]}");
        }
        return out.append("]}").toString();
    }
    private static String pickup(Pickup pickup) {
        return pickup == null ? "null" : "{\"token\":" + q(pickup.token()) + ",\"memberId\":" + q(pickup.memberId()) + ",\"pickupBy\":" + q(pickup.pickupBy().toString()) + "}";
    }
    private static String q(String value) { return value == null ? "null" : "\"" + value.replace("\\","\\\\").replace("\"","\\\"") + "\""; }
}

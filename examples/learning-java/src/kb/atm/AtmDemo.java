package kb.atm;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import static kb.atm.Atm.*;
import static kb.atm.DemoPorts.*;

/** Runs local fixtures. --json exports the exact states shown by the standalone lab. */
public final class AtmDemo {
    private record Frame(String title, String explanation, SessionView session,
                         InventoryView cash, Funds bank, WithdrawalView operation,
                         int commands, boolean cashBlocked) {}
    private record Scenario(String id, String title, String description, List<Frame> frames) {}

    public static void main(String[] args) {
        List<Scenario> scenarios = List.of(run("success"),run("cash-unknown"),run("none"),run("hold-unknown"),run("settlement-unknown"));
        if (args.length == 1 && args[0].equals("--json")) { System.out.println(json(scenarios)); return; }
        for (Scenario scenario : scenarios) {
            System.out.println(scenario.title());
            for (Frame frame : scenario.frames()) {
                System.out.printf("  %s: %s; bank ledger=%d held=%d; cash commands=%d; cash blocked=%s%n",
                    frame.title(),frame.operation() == null ? "NO_WITHDRAWAL" : frame.operation().stage(),
                    frame.bank().ledgerCents(),frame.bank().heldCents(),frame.commands(),frame.cashBlocked());
            }
        }
    }

    private static Scenario run(String id) {
        MemoryBank bank = new MemoryBank(10_000);
        Function<Notes,Report> behavior = id.equals("cash-unknown") ? plan -> Report.unknown()
            : id.equals("none") ? DemoPorts::none : DemoPorts::full;
        MemoryDispenser device = new MemoryDispenser(behavior);
        Machine machine = new Machine(bank,device,new MemoryReader(),new Notes(3,1));
        List<Frame> frames = new ArrayList<>();
        frames.add(frame("Ready for a card", "The machine has three $20 notes and one $50 note. No money is reserved.",machine,bank,device,null));
        machine.insertCard("opaque-card-reference");
        frames.add(frame("Card inserted", "The reader provides an opaque card reference. Cash withdrawal is still unavailable before authentication.",machine,bank,device,null));
        machine.enterPin(new PinEvidence("secure-input-handle"));
        frames.add(frame("Bank authorizes the session", "This fixture supplies an authorized bank reply. No PIN digits or card secrets enter the trace.",machine,bank,device,null));
        if (id.equals("hold-unknown")) bank.loseReserveReply = true;
        if (id.equals("settlement-unknown")) bank.loseSettlementReply = true;
        WithdrawalView op = machine.withdraw("W17",6_000);
        String title,description;
        switch (id) {
            case "success" -> {
                title = "$60 succeeds without a greedy dead end";
                description = "A $50 note would leave an impossible $10 remainder. The bounded planner selects three $20 notes; confirmed delivery settles $60 once.";
                frames.add(frame("Three twenties delivered", "The bank first holds $60. The device confirms all three notes reached the customer, so the bank debits $60 and closes the hold.",machine,bank,device,op));
                op = machine.withdraw("W17",6_000);
                frames.add(frame("Same ID retried", "W17 returns its saved result. No new physical command or bank debit occurs.",machine,bank,device,op));
            }
            case "cash-unknown" -> {
                title = "Lost cash reply, then confirmed partial delivery";
                description = "Unknown is not zero. Keep the funds hold and all planned notes reserved, query the original command, then settle only confirmed delivery.";
                frames.add(frame("Cash outcome unknown", "The device reply is inconclusive. Keep the full $60 bank hold and three-note reservation. Cash service is blocked.",machine,bank,device,op));
                op = machine.withdraw("W17",6_000);
                frames.add(frame("Customer retries W17", "The saved unknown result is returned. The command count remains one; a retry is not another dispense.",machine,bank,device,op));
                op = machine.reconcile("W17");
                frames.add(frame("Query is still inconclusive", "Lookup of W17 still gives no final evidence. Do not refund, free notes or start another withdrawal.",machine,bank,device,op));
                machine.endSession();
                frames.add(frame("Card session ends", "The card is ejected, but W17 and its reservations remain. A session ending cannot undo physical cash movement.",machine,bank,device,op));
                device.resolve("W17",twoTwentiesWithOneQuarantined());
                op = machine.reconcile("W17");
                frames.add(frame("Final evidence confirms $40 delivered", "Two $20 notes reached the customer; the third is quarantined. Debit $40, release the remaining $20 hold, and keep the jammed note unavailable. Cash service still needs maintenance.",machine,bank,device,op));
                op = machine.reconcile("W17");
                frames.add(frame("Reconciliation retried", "The terminal partial result is returned. Cash commands and settlement effects are unchanged.",machine,bank,device,op));
            }
            case "none" -> {
                title = "Proven zero delivery releases the hold";
                description = "Only final evidence that no notes reached the customer, with every note safely accounted for, permits settlement at zero.";
                frames.add(frame("No cash delivered; all notes reusable", "The final report accounts for all three planned notes as reusable. The bank settles zero, closes the hold, and the full cash inventory becomes available again.",machine,bank,device,op));
            }
            case "hold-unknown" -> {
                title = "Bank hold reply is lost before cash moves";
                description = "The bank actually created the hold, but the ATM has not confirmed that result. No dispense command may be sent yet.";
                frames.add(frame("Funds authorization unknown", "The bank fixture shows a $60 hold. The ATM remains FUNDS_UNKNOWN, reserves the notes and has sent zero cash commands.",machine,bank,device,op));
                op = machine.reconcile("W17");
                frames.add(frame("Lookup confirms the original hold", "The bank confirms W17's hold. Because the recorded phase proves no cash command was initiated, the ATM now sends its first command, then settles confirmed delivery.",machine,bank,device,op));
            }
            case "settlement-unknown" -> {
                title = "Cash is known; the settlement reply is lost";
                description = "Cash delivery and account settlement can be known at different times. Repeat only the idempotent bank settlement, never the physical command.";
                frames.add(frame("Bank applied settlement; reply lost", "The bank fixture has debited $60, but W17 is SETTLEMENT_UNKNOWN. The delivered notes are accounted for and the machine blocks another withdrawal until confirmation.",machine,bank,device,op));
                op = machine.reconcile("W17");
                frames.add(frame("Same settlement is confirmed", "Repeating settlement for W17 with the same $60 amount returns the bank's recorded result. The account was debited once and the dispenser was called once.",machine,bank,device,op));
            }
            default -> throw new IllegalArgumentException("Unknown scenario");
        }
        return new Scenario(id,title,description,List.copyOf(frames));
    }

    private static Frame frame(String title, String explanation, Machine machine, MemoryBank bank,
                               MemoryDispenser device, WithdrawalView operation) {
        return new Frame(title,explanation,machine.session(),machine.inventory(),bank.balance("demo-account"),
            operation,device.commandCalls,machine.cashBlocked());
    }
    private static String json(List<Scenario> scenarios) {
        StringBuilder out = new StringBuilder("{\"source\":\"kb.atm.AtmDemo --json\",\"scenarios\":[");
        for (int index = 0; index < scenarios.size(); index++) {
            if (index > 0) out.append(',');
            Scenario scenario = scenarios.get(index);
            out.append("{\"id\":").append(q(scenario.id())).append(",\"title\":").append(q(scenario.title()))
                .append(",\"description\":").append(q(scenario.description())).append(",\"frames\":[");
            for (int step = 0; step < scenario.frames().size(); step++) {
                if (step > 0) out.append(',');
                Frame frame = scenario.frames().get(step);
                out.append("{\"title\":").append(q(frame.title())).append(",\"explanation\":").append(q(frame.explanation()))
                    .append(",\"session\":").append(q(frame.session().state().name()))
                    .append(",\"commands\":").append(frame.commands()).append(",\"cashBlocked\":").append(frame.cashBlocked())
                    .append(",\"cash\":{\"available\":").append(notes(frame.cash().available()))
                    .append(",\"reserved\":").append(notes(frame.cash().reserved()))
                    .append(",\"quarantined\":").append(notes(frame.cash().quarantined())).append('}')
                    .append(",\"bank\":{\"ledgerCents\":").append(frame.bank().ledgerCents())
                    .append(",\"heldCents\":").append(frame.bank().heldCents())
                    .append(",\"availableCents\":").append(frame.bank().availableCents()).append('}')
                    .append(",\"operation\":");
                WithdrawalView op = frame.operation();
                if (op == null) out.append("null");
                else out.append("{\"id\":").append(q(op.id())).append(",\"stage\":").append(q(op.stage().name()))
                    .append(",\"requestedCents\":").append(op.requestedCents()).append(",\"plan\":").append(notes(op.plan()))
                    .append(",\"deliveredCents\":").append(op.deliveredCents() < 0 ? "null" : op.deliveredCents()).append('}');
                out.append('}');
            }
            out.append("]}");
        }
        return out.append("]}").toString();
    }
    private static String notes(Notes notes) { return "{\"twenties\":" + notes.twenties() + ",\"fifties\":" + notes.fifties() + "}"; }
    private static String q(String value) { return "\"" + value.replace("\\","\\\\").replace("\"","\\\"") + "\""; }
}

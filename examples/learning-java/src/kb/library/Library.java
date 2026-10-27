package kb.library;

import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/** One-branch, in-memory circulation mechanism. No payment or notification I/O. */
public final class Library {
    private Library() {}

    // BEGIN values
    public enum CopyState { AVAILABLE, ON_LOAN, PICKUP, REPAIR }
    public enum HoldState { WAITING, PICKUP, FULFILLED, EXPIRED, CANCELLED }
    public enum Condition { GOOD, DAMAGED }
    public record BookEdition(String id, String isbn, String title, String author) {
        public BookEdition { key(id); key(isbn); key(title); key(author); }
    }
    public record Plan(String name, int maxLoans, int loanDays, int maxRenewals, long fineCentsPerDay) {
        public Plan {
            key(name);
            if (maxLoans < 1 || loanDays < 1 || maxRenewals < 0 || fineCentsPerDay < 0)
                throw new IllegalArgumentException("Invalid plan");
        }
    }
    public record Pickup(String token, String holdId, String memberId, LocalDate pickupBy) {}
    public record CopyView(String id, String editionId, CopyState state, String loanId, Pickup pickup) {}
    public record MemberView(String id, boolean active, Plan plan, long activeLoans) {}
    public record LoanView(String id, String copyId, String memberId, LocalDate checkedOut,
                           LocalDate due, LocalDate returned, int renewals, Plan terms) {}
    public record HoldView(String id, String editionId, String memberId, HoldState state,
                           Pickup pickup, String reason) {}
    public record ReturnReceipt(String loanId, LocalDate returnedOn, Condition condition,
                                long overdueDays, long fineCents) {}
    public record RenewalReceipt(String loanId, LocalDate due, int renewals) {}
    public record PickupNotice(String token, String memberId, String copyId, LocalDate pickupBy) {}
    // END values

    private static final class Member {
        private final String id;
        private final Plan plan;
        private boolean active = true;
        private Member(String id, Plan plan) { this.id = id; this.plan = plan; }
    }
    private static final class Copy {
        private final String id, editionId;
        private CopyState state = CopyState.AVAILABLE;
        private String loanId;
        private Pickup pickup;
        private Copy(String id, String editionId) { this.id = id; this.editionId = editionId; }
        private CopyView view() { return new CopyView(id,editionId,state,loanId,pickup); }
    }
    private static final class Loan {
        private final String id, copyId, memberId;
        private final LocalDate checkedOut;
        private final Plan terms;
        private LocalDate due;
        private int renewals;
        private ReturnReceipt receipt;
        private Loan(String id, Copy copy, Member member, LocalDate today) {
            this.id = id; copyId = copy.id; memberId = member.id;
            checkedOut = today; terms = member.plan; due = today.plusDays(terms.loanDays());
        }
        private LoanView view() {
            return new LoanView(id,copyId,memberId,checkedOut,due,receipt == null ? null : receipt.returnedOn(),renewals,terms);
        }
    }
    private static final class Hold {
        private final String id, editionId, memberId;
        private HoldState state = HoldState.WAITING;
        private Pickup pickup;
        private String reason;
        private Hold(String id, String editionId, String memberId) { this.id = id; this.editionId = editionId; this.memberId = memberId; }
        private HoldView view() { return new HoldView(id,editionId,memberId,state,pickup,reason); }
    }
    private record CheckoutCommand(String copyId, String memberId, String pickupToken, LoanView receipt) {}
    private record RenewalCommand(String loanId, String memberId, RenewalReceipt receipt) {}

    public static final class Service {
        private final Clock clock;
        private final Map<String,BookEdition> editions = new LinkedHashMap<>();
        private final Map<String,Copy> copies = new LinkedHashMap<>();
        private final Map<String,Member> members = new LinkedHashMap<>();
        private final Map<String,Loan> loans = new LinkedHashMap<>();
        private final Map<String,Hold> holds = new LinkedHashMap<>();
        private final Map<String,ArrayDeque<Hold>> waiting = new HashMap<>();
        private final Map<String,CheckoutCommand> checkoutCommands = new HashMap<>();
        private final Map<String,RenewalCommand> renewalCommands = new HashMap<>();
        private final List<PickupNotice> notices = new ArrayList<>();
        private int loanSequence, pickupSequence;

        public Service(Clock branchClock) { clock = Objects.requireNonNull(branchClock); }
        public synchronized LocalDate today() { return LocalDate.now(clock); }
        public synchronized void addEdition(BookEdition edition) {
            Objects.requireNonNull(edition);
            if (editions.putIfAbsent(edition.id(),edition) != null) throw new IllegalArgumentException("Duplicate edition");
        }
        public synchronized void addMember(String id, Plan plan) {
            key(id); Objects.requireNonNull(plan);
            if (members.putIfAbsent(id,new Member(id,plan)) != null) throw new IllegalArgumentException("Duplicate member");
        }
        public synchronized void addCopy(String id, String editionId) {
            key(id); edition(editionId);
            if (copies.putIfAbsent(id,new Copy(id,editionId)) != null) throw new IllegalArgumentException("Duplicate barcode");
            allocate(editionId,today());
        }
        public synchronized void setActive(String memberId, boolean active) { member(memberId).active = active; }
        public synchronized List<BookEdition> search(String text) {
            String query = Objects.requireNonNull(text).toLowerCase(Locale.ROOT);
            return editions.values().stream().filter(e -> (e.title()+" "+e.author()+" "+e.isbn()).toLowerCase(Locale.ROOT).contains(query)).toList();
        }
        public synchronized CopyView copy(String id) { return item(id).view(); }
        public synchronized LoanView loan(String id) { return loanRecord(id).view(); }
        public synchronized HoldView hold(String id) { return holdRecord(id).view(); }
        public synchronized List<CopyView> copies() { return copies.values().stream().map(Copy::view).toList(); }
        public synchronized List<HoldView> holds() { return holds.values().stream().map(Hold::view).toList(); }
        public synchronized List<LoanView> loans() { return loans.values().stream().map(Loan::view).toList(); }
        public synchronized List<MemberView> members() { return members.values().stream().map(m -> new MemberView(m.id,m.active,m.plan,activeLoans(m.id))).toList(); }
        public synchronized List<PickupNotice> pickupNotices() { return List.copyOf(notices); }
        public synchronized List<ReturnReceipt> returns() { return loans.values().stream().filter(l -> l.receipt != null).map(l -> l.receipt).toList(); }

        // BEGIN checkout
        public synchronized LoanView checkout(String requestId, String copyId, String memberId, String pickupToken) {
            key(requestId);
            CheckoutCommand previous = checkoutCommands.get(requestId);
            if (previous != null) {
                if (!Objects.equals(copyId,previous.copyId()) || !Objects.equals(memberId,previous.memberId())
                    || !Objects.equals(pickupToken,previous.pickupToken())) throw new IllegalArgumentException("Checkout ID payload conflict");
                return previous.receipt();
            }
            Copy copy = item(copyId); Member member = member(memberId); LocalDate today = today();
            requireEligible(member,copy.editionId);
            if (copy.state == CopyState.PICKUP) {
                if (!copy.pickup.memberId().equals(memberId) || !copy.pickup.token().equals(pickupToken)
                    || today.isAfter(copy.pickup.pickupBy())) throw new IllegalStateException("Pickup does not belong to this request or has expired");
            } else if (copy.state != CopyState.AVAILABLE || pickupToken != null) {
                throw new IllegalStateException("Copy unavailable or stale pickup token");
            }
            Loan loan = new Loan("L" + ++loanSequence,copy,member,today);
            if (copy.pickup != null) holdRecord(copy.pickup.holdId()).state = HoldState.FULFILLED;
            copy.pickup = null; copy.state = CopyState.ON_LOAN; copy.loanId = loan.id;
            loans.put(loan.id,loan);
            LoanView receipt = loan.view();
            checkoutCommands.put(requestId,new CheckoutCommand(copyId,memberId,pickupToken,receipt));
            return receipt;
        }
        // END checkout

        // BEGIN return
        public synchronized ReturnReceipt returnCopy(String copyId, String expectedLoanId, Condition condition) {
            Objects.requireNonNull(condition);
            Loan loan = loanRecord(expectedLoanId);
            if (!loan.copyId.equals(copyId)) throw new IllegalArgumentException("Loan belongs to another copy");
            if (loan.receipt != null) {
                if (loan.receipt.condition() != condition) throw new IllegalArgumentException("Return token payload conflict");
                return loan.receipt; // Old return replay cannot touch the copy's current owner.
            }
            Copy copy = item(copyId);
            if (copy.state != CopyState.ON_LOAN || !expectedLoanId.equals(copy.loanId))
                throw new IllegalStateException("Stale loan token");
            LocalDate today = today();
            if (today.isBefore(loan.checkedOut)) throw new IllegalStateException("Return date precedes checkout");
            long overdueDays = Math.max(0,ChronoUnit.DAYS.between(loan.due,today));
            long fine = Math.multiplyExact(overdueDays,loan.terms.fineCentsPerDay());
            loan.receipt = new ReturnReceipt(loan.id,today,condition,overdueDays,fine);
            copy.loanId = null; copy.state = condition == Condition.DAMAGED ? CopyState.REPAIR : CopyState.AVAILABLE;
            allocate(copy.editionId,today); // Record ownership and ready notices, never call a payment network.
            return loan.receipt;
        }
        // END return

        // BEGIN renew
        public synchronized RenewalReceipt renew(String requestId, String loanId, String memberId) {
            key(requestId);
            RenewalCommand previous = renewalCommands.get(requestId);
            if (previous != null) {
                if (!Objects.equals(loanId,previous.loanId()) || !Objects.equals(memberId,previous.memberId()))
                    throw new IllegalArgumentException("Renewal ID payload conflict");
                return previous.receipt();
            }
            Loan loan = loanRecord(loanId); Member member = member(memberId);
            if (!loan.memberId.equals(memberId) || loan.receipt != null || !member.active
                || today().isAfter(loan.due) || loan.renewals >= loan.terms.maxRenewals())
                throw new IllegalStateException("Loan cannot be renewed");
            if (holds.values().stream().anyMatch(h -> h.editionId.equals(item(loan.copyId).editionId)
                && !h.memberId.equals(memberId) && (h.state == HoldState.WAITING || h.state == HoldState.PICKUP)))
                throw new IllegalStateException("Another reader has an outstanding hold");
            loan.due = loan.due.plusDays(loan.terms.loanDays()); loan.renewals++;
            RenewalReceipt receipt = new RenewalReceipt(loanId,loan.due,loan.renewals);
            renewalCommands.put(requestId,new RenewalCommand(loanId,memberId,receipt));
            return receipt;
        }
        // END renew

        // BEGIN holds
        public synchronized HoldView placeHold(String holdId, String editionId, String memberId) {
            key(holdId); edition(editionId); Member member = member(memberId);
            Hold previous = holds.get(holdId);
            if (previous != null) {
                if (!previous.editionId.equals(editionId) || !previous.memberId.equals(memberId))
                    throw new IllegalArgumentException("Hold ID payload conflict");
                return previous.view();
            }
            requireEligible(member,editionId);
            if (holds.values().stream().anyMatch(h -> h.editionId.equals(editionId) && h.memberId.equals(memberId)
                && (h.state == HoldState.WAITING || h.state == HoldState.PICKUP)))
                throw new IllegalStateException("Member already has an outstanding hold for this edition");
            Hold hold = new Hold(holdId,editionId,memberId);
            holds.put(holdId,hold); waiting.computeIfAbsent(editionId,ignored -> new ArrayDeque<>()).addLast(hold);
            allocate(editionId,today());
            return hold.view();
        }

        public synchronized boolean expirePickup(String copyId, String expectedPickupToken) {
            Copy copy = item(copyId);
            if (copy.state != CopyState.PICKUP || !copy.pickup.token().equals(expectedPickupToken)
                || !today().isAfter(copy.pickup.pickupBy())) return false;
            holdRecord(copy.pickup.holdId()).state = HoldState.EXPIRED;
            copy.pickup = null; copy.state = CopyState.AVAILABLE;
            allocate(copy.editionId,today());
            return true;
        }
        // END holds

        public synchronized void finishRepair(String copyId) {
            Copy copy = item(copyId);
            if (copy.state != CopyState.REPAIR) throw new IllegalStateException("Copy is not in repair");
            copy.state = CopyState.AVAILABLE; allocate(copy.editionId,today());
        }

        // BEGIN allocate
        private void allocate(String editionId, LocalDate today) {
            ArrayDeque<Hold> queue = waiting.get(editionId);
            if (queue == null) return;
            List<Copy> available = copies.values().stream().filter(c -> c.editionId.equals(editionId)
                && c.state == CopyState.AVAILABLE).sorted(Comparator.comparing(c -> c.id)).toList();
            for (Copy copy : available) {
                while (!queue.isEmpty()) {
                    Hold hold = queue.removeFirst(); Member member = member(hold.memberId);
                    String reason = ineligibility(member,editionId);
                    if (reason != null) { hold.state = HoldState.CANCELLED; hold.reason = reason; continue; }
                    Pickup pickup = new Pickup("P" + ++pickupSequence,hold.id,hold.memberId,today.plusDays(2));
                    hold.state = HoldState.PICKUP; hold.pickup = pickup;
                    copy.state = CopyState.PICKUP; copy.pickup = pickup;
                    notices.add(new PickupNotice(pickup.token(),member.id,copy.id,pickup.pickupBy()));
                    break;
                }
            }
        }
        // END allocate

        private String ineligibility(Member member, String editionId) {
            if (!member.active) return "Membership inactive";
            if (activeLoans(member.id) >= member.plan.maxLoans()) return "Borrowing limit reached";
            if (loans.values().stream().anyMatch(l -> l.receipt == null && l.memberId.equals(member.id)
                && item(l.copyId).editionId.equals(editionId))) return "Already borrowing this edition";
            return null;
        }
        private void requireEligible(Member member, String editionId) {
            String reason = ineligibility(member,editionId);
            if (reason != null) throw new IllegalStateException(reason);
        }
        private long activeLoans(String memberId) {
            return loans.values().stream().filter(l -> l.memberId.equals(memberId) && l.receipt == null).count();
        }
        private BookEdition edition(String id) { return required(editions,id,"edition"); }
        private Copy item(String id) { return required(copies,id,"copy"); }
        private Member member(String id) { return required(members,id,"member"); }
        private Loan loanRecord(String id) { return required(loans,id,"loan"); }
        private Hold holdRecord(String id) { return required(holds,id,"hold"); }
    }

    private static void key(String value) { if (value == null || value.isBlank()) throw new IllegalArgumentException("Missing identifier"); }
    private static <T> T required(Map<String,T> map, String id, String type) {
        T value = map.get(id);
        if (value == null) throw new IllegalArgumentException("Unknown " + type + ": " + id);
        return value;
    }
}

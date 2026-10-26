package kb.booking;

import java.time.*;
import java.util.*;

/** One-process teaching implementation. A database transaction replaces this monitor across servers. */
public final class BookingService {
    public enum State { HELD, CONFIRMED, EXPIRED, CANCELLED }
    public enum Payment { NOT_STARTED, PENDING, UNKNOWN, DECLINED, CAPTURED }
    public enum RefundState { NOT_REQUIRED, PENDING }
    public record Seat(String show, String number) {}
    public record Reservation(UUID id, String customer, String show, List<String> seats,
                              long totalPaise, Instant expiresAt, State state, Payment payment,
                              RefundState refundState, long refundAmountPaise) {}
    public record Attempt(UUID reservation, String key, long amountPaise) {}
    /** The payment adapter must authenticate the provider and bind the receipt to this attempt. */
    public record Receipt(String attemptKey, Payment result, String chargeId, long amountPaise) {}
    public record Refund(String chargeId, long amountPaise, String reason) {}
    public record Reconciliation(UUID reservation, String attemptKey, String chargeId, long amountPaise, String reason) {}
    public static final class ReceiptConflict extends IllegalArgumentException {
        private final Reconciliation evidence;
        ReceiptConflict(Reconciliation evidence){super(evidence.reason());this.evidence=evidence;}
        public Reconciliation evidence(){return evidence;}
    }
    public record SeatView(String number, String state, String owner) {}
    public record Availability(String number, String state) {}
    private record Request(String customer, String key) {}
    private record Fingerprint(String show, List<String> seats) {}
    private static final class Hold {
        final UUID id = UUID.randomUUID();
        final String customer, show;
        final List<String> seats;
        final long total;
        final Instant expires;
        State state = State.HELD;
        Payment payment = Payment.NOT_STARTED;
        String attempt, charge;
        long chargedAmount;
        boolean refundPending;
        Hold(String customer, String show, List<String> seats, long total, Instant expires) {
            this.customer=customer; this.show=show; this.seats=seats; this.total=total; this.expires=expires;
        }
        Reservation view() { return new Reservation(id,customer,show,seats,total,expires,state,payment,
            refundPending?RefundState.PENDING:RefundState.NOT_REQUIRED,refundPending?chargedAmount:0); }
    }
    private final Clock clock;
    private final Duration holdFor;
    private final Map<Seat,Long> prices;
    private final Map<Seat,UUID> owners = new HashMap<>();
    private final Map<UUID,Hold> holds = new HashMap<>();
    private final Map<Request,UUID> requests = new HashMap<>();
    private final Map<Request,Fingerprint> fingerprints = new HashMap<>();
    private final Map<String,UUID> charges = new HashMap<>();
    private final Map<String,Refund> refunds = new LinkedHashMap<>();
    private final Set<Reconciliation> reconciliations = new LinkedHashSet<>();

    public BookingService(Map<Seat,Long> prices, Clock clock, Duration holdFor) {
        this.prices=Map.copyOf(prices); this.clock=Objects.requireNonNull(clock);
        if (holdFor.isNegative() || holdFor.isZero()) throw new IllegalArgumentException("positive hold duration");
        if (this.prices.isEmpty() || this.prices.values().stream().anyMatch(p->p<=0))
            throw new IllegalArgumentException("positive seat prices in paise");
        this.holdFor=holdFor;
    }
    // BEGIN hold
    public synchronized Reservation hold(String customer, String requestKey, String show, List<String> requested) {
        text(customer); text(requestKey); text(show); Objects.requireNonNull(requested);
        if (requested.isEmpty() || requested.size()>8 || new HashSet<>(requested).size()!=requested.size())
            throw new IllegalArgumentException("choose 1..8 distinct seats");
        requested.forEach(BookingService::text);
        List<String> seats=requested.stream().sorted().toList();
        Request request=new Request(customer,requestKey);
        Fingerprint fingerprint=new Fingerprint(show,seats);
        if (requests.containsKey(request)) {
            if (!fingerprints.get(request).equals(fingerprint)) throw new IllegalArgumentException("key reused with another cart");
            Hold old=holds.get(requests.get(request)); expire(old,clock.instant()); return old.view();
        }
        Instant now=clock.instant(); long total=0;
        for (String number:seats) {
            Seat seat=new Seat(show,number);
            Long price=prices.get(seat);
            if (price==null) throw new IllegalArgumentException("unknown show-seat");
            UUID owner=owners.get(seat);
            if (owner!=null) expire(holds.get(owner),now);
            if (owners.containsKey(seat)) throw new IllegalStateException("seat unavailable: "+number);
            total=Math.addExact(total,price);
        }
        // Validation above changes no new ownership. Only a completely available cart reaches here.
        Hold hold=new Hold(customer,show,seats,total,now.plus(holdFor));
        holds.put(hold.id,hold);
        for (String number:seats) owners.put(new Seat(show,number),hold.id);
        requests.put(request,hold.id); fingerprints.put(request,fingerprint);
        return hold.view();
    }
    // END hold
    // BEGIN payment
    public synchronized Attempt beginPayment(String customer, UUID id) {
        Hold hold=owned(customer,id); expire(hold,clock.instant());
        if (hold.state!=State.HELD) throw new IllegalStateException("hold is not payable");
        if (hold.attempt==null) { hold.attempt="reservation/"+id; hold.payment=Payment.PENDING; }
        return new Attempt(id,hold.attempt,hold.total);
    }
    // No provider call runs under the service monitor. The caller sends Attempt.key as its idempotency key.
    public synchronized Reservation acceptReceipt(UUID id, Receipt receipt) {
        Objects.requireNonNull(receipt);
        Hold hold=required(id);
        if (hold.attempt==null || !hold.attempt.equals(receipt.attemptKey()))
            throw new IllegalArgumentException("receipt does not match the payment attempt");
        if (!Set.of(Payment.UNKNOWN,Payment.DECLINED,Payment.CAPTURED).contains(receipt.result()))
            throw new IllegalArgumentException("not a provider outcome");
        expire(hold,clock.instant());
        if (receipt.result()==Payment.CAPTURED) {
            text(receipt.chargeId());
            if (receipt.amountPaise()<=0) throw new IllegalArgumentException("positive captured amount");
            UUID previous=charges.get(receipt.chargeId());
            if (previous!=null && !previous.equals(id)) throw conflict(hold,receipt,"charge already belongs to another reservation");
            if (hold.charge!=null) {
                if (!hold.charge.equals(receipt.chargeId()) || hold.chargedAmount!=receipt.amountPaise())
                    throw conflict(hold,receipt,"conflicting capture: reconcile with provider");
                return hold.view(); // Identical callback is a no-op, even after cancellation.
            }
            if (hold.payment==Payment.DECLINED) throw conflict(hold,receipt,"conflicting terminal payment: reconcile");
            charges.put(receipt.chargeId(),id); hold.charge=receipt.chargeId();
            hold.chargedAmount=receipt.amountPaise(); hold.payment=Payment.CAPTURED;
            if (hold.state==State.HELD && receipt.amountPaise()==hold.total) hold.state=State.CONFIRMED;
            else {
                if (hold.state==State.HELD) { hold.state=State.CANCELLED; release(hold); }
                refund(hold,receipt.amountPaise()==hold.total?"paid after release":"captured amount differs from quote");
            }
        } else if (hold.payment!=Payment.CAPTURED && hold.payment!=Payment.DECLINED) {
            hold.payment=receipt.result();
            if (hold.payment==Payment.DECLINED && hold.state==State.HELD) { hold.state=State.CANCELLED; release(hold); }
        }
        return hold.view();
    }
    // END payment
    public synchronized Reservation cancel(String customer, UUID id) {
        Hold hold=owned(customer,id); expire(hold,clock.instant());
        if (hold.state==State.HELD || hold.state==State.CONFIRMED) {
            hold.state=State.CANCELLED; release(hold);
            if (hold.payment==Payment.CAPTURED) refund(hold,"customer cancellation");
        }
        return hold.view();
    }
    public synchronized Reservation get(String customer, UUID id) {
        Hold hold=owned(customer,id); expire(hold,clock.instant()); return hold.view();
    }
    public synchronized List<Refund> pendingRefunds() { return List.copyOf(refunds.values()); }
    public synchronized List<Reconciliation> pendingReconciliations() { return List.copyOf(reconciliations); }
    public synchronized List<Availability> availability(String show) {
        return seats(show).stream().map(v->new Availability(v.number(),v.state())).toList();
    }
    /** Internal diagnostic/trace view. Public browsing must use availability(), which omits customer IDs. */
    public synchronized List<SeatView> seats(String show) {
        Instant now=clock.instant(); holds.values().forEach(h->expire(h,now));
        return prices.keySet().stream().filter(s->s.show().equals(show)).sorted(Comparator.comparing(Seat::number)).map(s->{
            UUID id=owners.get(s); Hold h=id==null?null:holds.get(id);
            return new SeatView(s.number(),h==null?"AVAILABLE":h.state.name(),h==null?"":h.customer);
        }).toList();
    }
    private Hold required(UUID id) {
        Hold h=holds.get(id); if(h==null) throw new IllegalArgumentException("unknown reservation"); return h;
    }
    private Hold owned(String customer, UUID id) {
        Hold h=required(id); if(!h.customer.equals(customer)) throw new SecurityException("not your reservation"); return h;
    }
    // BEGIN expiry
    private void expire(Hold hold, Instant now) {
        if (hold.state==State.HELD && !now.isBefore(hold.expires)) { hold.state=State.EXPIRED; release(hold); }
    }
    private void release(Hold hold) {
        // Compare owner as well as seat: an old callback must never release a newer hold.
        for (String number:hold.seats) owners.remove(new Seat(hold.show,number),hold.id);
    }
    // END expiry
    private void refund(Hold h, String reason) {
        refunds.putIfAbsent(h.charge,new Refund(h.charge,h.chargedAmount,reason));h.refundPending=true;
    }
    private ReceiptConflict conflict(Hold h, Receipt r, String reason) {
        Reconciliation evidence=new Reconciliation(h.id,r.attemptKey(),r.chargeId(),r.amountPaise(),reason);
        reconciliations.add(evidence);return new ReceiptConflict(evidence);
    }
    private static void text(String s) { if(s==null || s.isBlank()) throw new IllegalArgumentException("nonblank value required"); }
}

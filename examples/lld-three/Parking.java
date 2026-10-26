package lldthree;

import java.time.*;
import java.util.*;
import java.util.function.Supplier;

/** Single-process parking ownership and payment orchestration; provider calls never hold the lot monitor. */
public final class Parking {
    private Parking() {}
    // region:values
    public enum VehicleKind { MOTORCYCLE, CAR, TRUCK }
    public enum SpotKind { MOTORCYCLE, COMPACT, LARGE }
    public enum SessionState { PARKED, PAYMENT_PENDING, PAYMENT_UNKNOWN, PAID, CLOSED }
    public enum PaymentState { PENDING, UNKNOWN, CONFIRMED, DECLINED }
    public record Vehicle(String registration, VehicleKind kind) {
        public Vehicle {
            registration=Objects.requireNonNull(registration).trim().toUpperCase(Locale.ROOT);
            if(registration.isBlank())throw new IllegalArgumentException("Blank registration");
            Objects.requireNonNull(kind);
        }
    }
    public record Spot(String id,int floor,int order,SpotKind kind) {
        public Spot { if(id==null||id.isBlank()||floor<0||order<0)throw new IllegalArgumentException("Invalid spot");Objects.requireNonNull(kind); }
    }
    public record Quote(long totalMinor,long paidMinor,long dueMinor,String tariffVersion,Instant quotedAt) {}
    public record SessionView(String id,Vehicle vehicle,Spot spot,Instant enteredAt,SessionState state,
                              long paidMinor,Instant exitBy) {}
    public record PaymentView(String key,String sessionId,long amountMinor,PaymentState state,String reference,Quote quote) {}
    public record ProviderReply(PaymentState state,String reference) {
        public ProviderReply {
            Objects.requireNonNull(state);
            if(state==PaymentState.CONFIRMED && (reference==null||reference.isBlank()))
                throw new IllegalArgumentException("Confirmation requires provider evidence");
        }
    }
    public interface PaymentPort {
        ProviderReply charge(String paymentKey,long amountMinor);
        ProviderReply lookup(String paymentKey);
    }
    public interface Tariff { String version(); long totalMinor(Duration stay); }
    // endregion:values

    // region:tariff
    /** One currency (INR/paise). First hour is charged even for an immediate exit. */
    public record HourlyTariff(String version,long firstHourMinor,long extraHourMinor) implements Tariff {
        public HourlyTariff {
            if(version==null||version.isBlank()||firstHourMinor<0||extraHourMinor<0)throw new IllegalArgumentException("Invalid tariff");
        }
        @Override public long totalMinor(Duration stay) {
            if(stay.isNegative())throw new IllegalArgumentException("Clock precedes entry");
            // Ceiling at nanosecond precision: exactly 60 minutes is one hour, 60m+1ns is two.
            long seconds=stay.getSeconds(),hours=seconds/3600;
            if(seconds%3600!=0 || stay.getNano()!=0)hours=Math.addExact(hours,1);
            hours=Math.max(1,hours);
            return Math.addExact(firstHourMinor,Math.multiplyExact(hours-1,extraHourMinor));
        }
    }
    // endregion:tariff

    public interface AllocationPolicy { Spot choose(Vehicle vehicle,List<Spot> free); }
    public static final class SmallestFit implements AllocationPolicy {
        @Override public Spot choose(Vehicle v,List<Spot> free) {
            return free.stream().filter(s->fits(v.kind,s.kind))
                .min(Comparator.comparingInt((Spot s)->s.kind.ordinal()).thenComparingInt(Spot::floor)
                    .thenComparingInt(Spot::order).thenComparing(Spot::id))
                .orElseThrow(()->new IllegalStateException("No compatible spot"));
        }
    }
    public static boolean fits(VehicleKind vehicle,SpotKind spot) {
        return switch(vehicle) {
            case MOTORCYCLE -> true;
            case CAR -> spot==SpotKind.COMPACT||spot==SpotKind.LARGE;
            case TRUCK -> spot==SpotKind.LARGE;
        };
    }
    private static final class Session {
        final String id;final Vehicle vehicle;final Spot spot;final Instant enteredAt;final Tariff tariff;
        SessionState state=SessionState.PARKED;long paid;Instant exitBy;String activePayment;
        Session(String id,Vehicle vehicle,Spot spot,Instant entry,Tariff tariff){this.id=id;this.vehicle=vehicle;this.spot=spot;this.enteredAt=entry;this.tariff=tariff;}
        SessionView view(){return new SessionView(id,vehicle,spot,enteredAt,state,paid,exitBy);}
    }
    private static final class Attempt {
        final String key,sessionId;final long amount;final Quote quote;PaymentState state=PaymentState.PENDING;String reference;
        Attempt(String key,String sessionId,Quote quote){this.key=key;this.sessionId=sessionId;this.quote=quote;this.amount=quote.dueMinor;}
        PaymentView view(){return new PaymentView(key,sessionId,amount,state,reference,quote);}
    }
    public static final class Lot {
        private final Map<String,Spot> spots=new LinkedHashMap<>();
        private final Map<String,String> occupancy=new HashMap<>(),entries=new HashMap<>(),activeVehicles=new HashMap<>(),exits=new HashMap<>();
        private final Map<String,Session> sessions=new HashMap<>();private final Map<String,Attempt> attempts=new HashMap<>();
        private final Set<String> disabled=new HashSet<>();
        private final Clock clock;private final Supplier<String> ids;private final AllocationPolicy allocator;private final PaymentPort payments;
        private final Duration exitGrace;private Tariff tariff;
        public Lot(Collection<Spot> initial,Tariff tariff,AllocationPolicy allocator,PaymentPort payments,
                   Clock clock,Supplier<String> ids,Duration exitGrace) {
            this.tariff=Objects.requireNonNull(tariff);this.allocator=Objects.requireNonNull(allocator);this.payments=Objects.requireNonNull(payments);
            this.clock=Objects.requireNonNull(clock);this.ids=Objects.requireNonNull(ids);this.exitGrace=Objects.requireNonNull(exitGrace);
            if(exitGrace.isZero()||exitGrace.isNegative())throw new IllegalArgumentException("Positive exit grace required");
            for(Spot s:initial)if(spots.putIfAbsent(s.id,s)!=null)throw new IllegalArgumentException("Duplicate spot");
        }
        // region:enter
        public synchronized SessionView enter(String entryKey, Vehicle vehicle) {
            requireKey(entryKey);
            Objects.requireNonNull(vehicle);

            String previous = entries.get(entryKey);
            if (previous != null) {
                Session visit = session(previous);
                if (!visit.vehicle.equals(vehicle)) {
                    throw new IllegalArgumentException("Entry key payload conflict");
                }
                return visit.view();
            }
            if (activeVehicles.containsKey(vehicle.registration)) {
                throw new IllegalStateException("Vehicle already inside");
            }

            List<Spot> free = spots.values().stream()
                .filter(spot -> !disabled.contains(spot.id))
                .filter(spot -> !occupancy.containsKey(spot.id))
                .toList();
            Spot spot = allocator.choose(vehicle, free);
            if (!free.contains(spot) || !fits(vehicle.kind, spot.kind)) {
                throw new IllegalStateException("Allocation policy returned invalid spot");
            }

            String id = Objects.requireNonNull(ids.get());
            if (id.isBlank() || sessions.containsKey(id)) {
                throw new IllegalStateException("Session identity collision");
            }
            Session visit = new Session(id, vehicle, spot, clock.instant(), tariff);
            sessions.put(id, visit);
            occupancy.put(spot.id, id);
            activeVehicles.put(vehicle.registration, id);
            entries.put(entryKey, id);
            return visit.view();
        }
        // endregion:enter
        public synchronized Quote quote(String sessionId) {
            Session s=session(sessionId);
            if(s.state==SessionState.CLOSED)throw new IllegalStateException("Session closed");
            Instant now=clock.instant();
            long total=s.state==SessionState.PAID&&now.isBefore(s.exitBy)?s.paid:s.tariff.totalMinor(Duration.between(s.enteredAt,now));
            return new Quote(total,s.paid,Math.max(0,total-s.paid),s.tariff.version(),now);
        }
        // region:payment
        public PaymentView pay(String sessionId, String paymentKey, long approvedDueMinor) {
            Attempt work;
            synchronized (this) {
                requireKey(paymentKey);
                if (approvedDueMinor < 0) {
                    throw new IllegalArgumentException("Negative approval");
                }
                Session visit = session(sessionId);
                Attempt old = attempts.get(paymentKey);
                if (old != null) {
                    if (!old.sessionId.equals(sessionId) || old.amount != approvedDueMinor) {
                        throw new IllegalArgumentException("Payment key payload conflict");
                    }
                    return old.view(); // A duplicate cannot start a second provider call.
                }
                if (visit.state == SessionState.CLOSED) {
                    throw new IllegalStateException("Session closed");
                }
                if (visit.state == SessionState.PAYMENT_PENDING
                        || visit.state == SessionState.PAYMENT_UNKNOWN) {
                    throw new IllegalStateException("Resolve original payment first");
                }
                if (visit.state == SessionState.PAID && clock.instant().isBefore(visit.exitBy)) {
                    if (approvedDueMinor != 0) {
                        throw new IllegalStateException("Quote changed; approve the current amount");
                    }
                    Attempt covered = new Attempt(paymentKey, sessionId, quote(sessionId));
                    covered.state = PaymentState.CONFIRMED;
                    covered.reference = "ALREADY_COVERED";
                    attempts.put(paymentKey, covered);
                    return covered.view(); // Does not extend grace.
                }

                Quote current = quote(sessionId);
                if (current.dueMinor != approvedDueMinor) {
                    throw new IllegalStateException("Quote changed; approve the current amount");
                }
                work = new Attempt(paymentKey, sessionId, current);
                attempts.put(paymentKey, work);
                visit.activePayment = paymentKey;
                visit.state = SessionState.PAYMENT_PENDING;
                if (work.amount == 0) {
                    return finish(paymentKey, new ProviderReply(
                        PaymentState.CONFIRMED, "COVERED_BY_PRIOR_PAYMENTS"));
                }
            }

            ProviderReply reply;
            try {
                reply = payments.charge(work.key, work.amount);
            } catch (RuntimeException uncertain) {
                reply = new ProviderReply(PaymentState.UNKNOWN, null);
            }
            return finish(work.key, reply); // The payment-service call held no lot lock.
        }
        public PaymentView reconcile(String paymentKey) {
            synchronized (this) {
                Attempt saved = attempt(paymentKey);
                if (saved.state == PaymentState.CONFIRMED || saved.state == PaymentState.DECLINED) {
                    return saved.view();
                }
            }
            ProviderReply reply;
            try {
                reply = payments.lookup(paymentKey);
            } catch (RuntimeException uncertain) {
                reply = new ProviderReply(PaymentState.UNKNOWN, null);
            }
            return finish(paymentKey, reply);
        }
        // endregion:payment
        private synchronized PaymentView finish(String key,ProviderReply reply) {
            Attempt a=attempt(key);Session s=session(a.sessionId);
            if(a.state==PaymentState.CONFIRMED||a.state==PaymentState.DECLINED)return a.view();
            if(!key.equals(s.activePayment))throw new IllegalStateException("Payment ownership conflict");
            PaymentState outcome=reply==null||reply.state==PaymentState.PENDING?PaymentState.UNKNOWN:reply.state;
            if(outcome==PaymentState.CONFIRMED) {
                s.paid=Math.addExact(s.paid,a.amount);s.exitBy=clock.instant().plus(exitGrace);s.state=SessionState.PAID;
            }else if(outcome==PaymentState.DECLINED)s.state=SessionState.PARKED;
            else s.state=SessionState.PAYMENT_UNKNOWN;
            a.state=outcome;a.reference=reply==null?null:reply.reference;return a.view();
        }
        // region:exit
        public synchronized SessionView confirmExit(String sessionId, String exitEventId) {
            requireKey(exitEventId);
            Session visit = session(sessionId);
            String previous = exits.get(exitEventId);
            if (previous != null && !previous.equals(sessionId)) {
                throw new IllegalArgumentException("Exit event payload conflict");
            }
            if (visit.state == SessionState.CLOSED) {
                return visit.view();
            }
            if (visit.state != SessionState.PAID || !clock.instant().isBefore(visit.exitBy)) {
                throw new IllegalStateException("Payment or additional payment required");
            }
            if (!sessionId.equals(occupancy.get(visit.spot.id))) {
                throw new IllegalStateException("Spot ownership mismatch");
            }

            occupancy.remove(visit.spot.id);
            activeVehicles.remove(visit.vehicle.registration, sessionId);
            visit.state = SessionState.CLOSED;
            exits.put(exitEventId, sessionId);
            return visit.view();
        }
        // endregion:exit
        public synchronized SessionView view(String sessionId){return session(sessionId).view();}
        public synchronized int available(VehicleKind kind){return (int)spots.values().stream().filter(s->!disabled.contains(s.id)&&!occupancy.containsKey(s.id)&&fits(kind,s.kind)).count();}
        public synchronized void tariff(Tariff next){tariff=Objects.requireNonNull(next);}
        public synchronized void disable(String spotId){if(!spots.containsKey(spotId)||occupancy.containsKey(spotId))throw new IllegalStateException("Spot unknown or occupied");disabled.add(spotId);}
        public synchronized int occupied(){return occupancy.size();}
        private Session session(String id){Session s=sessions.get(id);if(s==null)throw new IllegalArgumentException("Unknown session");return s;}
        private Attempt attempt(String key){Attempt a=attempts.get(key);if(a==null)throw new IllegalArgumentException("Unknown payment");return a;}
    }
    private static void requireKey(String key){if(key==null||key.isBlank())throw new IllegalArgumentException("Identity required");}
}

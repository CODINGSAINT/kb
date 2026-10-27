package kb.rental;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** One branch, specific-vehicle reservations, memory-only authority. No payment I/O. */
public final class Rental {
    private Rental() {}
    public static final Duration PREPARATION = Duration.ofHours(1);
    public static final Duration PICKUP_GRACE = Duration.ofMinutes(30);
    public static final Duration QUOTE_LIFE = Duration.ofMinutes(5);

    // BEGIN values
    public enum Category { ECONOMY, SUV }
    public enum State { CONFIRMED, ACTIVE, RETURNED, CANCELLED }
    public enum Handover { STARTED, REPLAYED, TOO_EARLY, WINDOW_CLOSED, NOT_READY }
    public record Window(Instant start, Instant end) {
        public Window {
            Objects.requireNonNull(start); Objects.requireNonNull(end);
            if (!start.isBefore(end)) throw new IllegalArgumentException("Require start < end");
        }
        public Instant blockedUntil() { return end.plus(PREPARATION); }
        public boolean overlaps(Window other) {
            return start.isBefore(other.blockedUntil()) && other.start.isBefore(blockedUntil());
        }
    }
    public record Tariff(long dailyPaise, long lateHourPaise, long lateCancelPaise) {
        public Tariff {
            if (dailyPaise <= 0 || lateHourPaise < 0 || lateCancelPaise < 0)
                throw new IllegalArgumentException("Invalid rates");
        }
    }
    public record Reading(long odometerKm, int fuelPercent, boolean damaged) {
        public Reading {
            if (odometerKm < 0 || fuelPercent < 0 || fuelPercent > 100)
                throw new IllegalArgumentException("Invalid inspection reading");
        }
    }
    public record Quote(String id, String customerId, String vehicleId, Window window,
                        Tariff tariff, long basePaise, Instant validUntil) {}
    public record AgreementView(String id, Instant pickedUpAt, Reading pickup,
                                Instant returnedAt, Reading returned) {}
    public record Invoice(String id, String reservationId, long basePaise, long latePaise,
                          long cancellationPaise, long totalPaise, Instant assessedAt) {}
    public record ReservationView(String id, Quote quote, State state, AgreementView agreement,
                                  Invoice invoice, String readinessIssue) {}
    public record VehicleView(String id, Category category, String activeReservationId,
                              Instant readyAt, boolean maintenance) {}
    public record PickupResult(Handover decision, AgreementView agreement) {}
    // END values

    private static final class Vehicle {
        private final String id;
        private final Category category;
        private Instant readyAt = Instant.MIN;
        private String activeId;
        private boolean maintenance;
        private Vehicle(String id, Category category) { this.id=id; this.category=category; }
        private VehicleView view() { return new VehicleView(id,category,activeId,readyAt,maintenance); }
    }
    private static final class Booking {
        private final String id;
        private final Quote quote;
        private State state = State.CONFIRMED;
        private AgreementView agreement;
        private Invoice invoice;
        private Booking(String id, Quote quote) { this.id=id; this.quote=quote; }
    }
    private record RequestKey(String customerId, String requestId) {}
    private record SavedRequest(String quoteId, String reservationId) {}

    public static final class Service {
        private final Clock clock;
        private Tariff tariff;
        private final Map<String,Boolean> eligible = new HashMap<>();
        private final Map<String,Vehicle> vehicles = new LinkedHashMap<>();
        private final Map<String,Quote> quotes = new HashMap<>();
        private final Map<String,Booking> bookings = new LinkedHashMap<>();
        private final Map<RequestKey,SavedRequest> requests = new HashMap<>();
        private int quoteSequence, reservationSequence;

        public Service(Clock clock, Tariff tariff) { this.clock=Objects.requireNonNull(clock); this.tariff=Objects.requireNonNull(tariff); }
        public synchronized void addVehicle(String id, Category category) {
            key(id); Objects.requireNonNull(category);
            if (vehicles.putIfAbsent(id,new Vehicle(id,category)) != null) throw new IllegalArgumentException("Duplicate vehicle");
        }
        public synchronized void customer(String id, boolean isEligible) { key(id); eligible.put(id,isEligible); }
        public synchronized void changeTariff(Tariff replacement) { tariff=Objects.requireNonNull(replacement); }
        public synchronized Instant now() { return clock.instant(); }
        public synchronized VehicleView vehicle(String id) { return asset(id).view(); }
        public synchronized ReservationView reservation(String id) { return view(booking(id)); }
        public synchronized List<ReservationView> reservations() { return bookings.values().stream().map(this::view).toList(); }
        public synchronized List<String> search(Category category, Window window) {
            validateWindow(window);
            return vehicles.values().stream().filter(v -> v.category==category && free(v,window)).map(v -> v.id).sorted().toList();
        }
        public synchronized Quote quote(String customerId, String vehicleId, Window window) {
            requireEligible(customerId); validateWindow(window); Vehicle vehicle=asset(vehicleId);
            if (!free(vehicle,window)) throw new IllegalStateException("Vehicle is not available for those times");
            Quote quote=new Quote("Q" + ++quoteSequence,customerId,vehicleId,window,tariff,
                Math.multiplyExact(startedUnits(Duration.between(window.start(),window.end()),Duration.ofDays(1)),tariff.dailyPaise()),
                now().plus(QUOTE_LIFE));
            quotes.put(quote.id(),quote); return quote;
        }

        // BEGIN reserve
        public synchronized ReservationView reserve(String requestId, String customerId, String quoteId) {
            key(requestId); key(customerId);
            RequestKey key=new RequestKey(customerId,requestId); SavedRequest saved=requests.get(key);
            if (saved != null) {
                if (!saved.quoteId().equals(quoteId)) throw new IllegalArgumentException("Request ID payload conflict");
                return view(booking(saved.reservationId()));
            }
            Quote quote=Objects.requireNonNull(quotes.get(quoteId),"Unknown quote");
            if (!quote.customerId().equals(customerId)) throw new IllegalArgumentException("Quote belongs to another customer");
            requireEligible(customerId);
            if (!now().isBefore(quote.validUntil())) throw new IllegalStateException("Quote expired");
            validateWindow(quote.window());
            if (!free(asset(quote.vehicleId()),quote.window())) throw new IllegalStateException("Vehicle interval already allocated or not ready");
            Booking booking=new Booking("R" + ++reservationSequence,quote);
            bookings.put(booking.id,booking); requests.put(key,new SavedRequest(quoteId,booking.id));
            return view(booking);
        }
        // END reserve

        // BEGIN pickup
        public synchronized PickupResult pickup(String reservationId, String customerId, Reading reading) {
            Booking booking=owned(reservationId,customerId); Objects.requireNonNull(reading);
            if (booking.agreement != null) {
                if (!booking.agreement.pickup().equals(reading)) throw new IllegalArgumentException("Pickup payload conflict");
                return new PickupResult(Handover.REPLAYED,booking.agreement);
            }
            if (booking.state != State.CONFIRMED) throw new IllegalStateException("Reservation cannot be picked up");
            requireEligible(customerId); Instant now=now(); Window window=booking.quote.window();
            if (now.isBefore(window.start())) return new PickupResult(Handover.TOO_EARLY,null);
            if (!now.isBefore(window.start().plus(PICKUP_GRACE))) return new PickupResult(Handover.WINDOW_CLOSED,null);
            Vehicle vehicle=asset(booking.quote.vehicleId());
            if (vehicle.activeId != null || vehicle.maintenance || now.isBefore(vehicle.readyAt))
                return new PickupResult(Handover.NOT_READY,null);
            if (reading.damaged()) throw new IllegalArgumentException("Do not hand over a damaged vehicle");
            booking.agreement=new AgreementView("A/" + booking.id,now,reading,null,null);
            booking.state=State.ACTIVE; vehicle.activeId=booking.id;
            return new PickupResult(Handover.STARTED,booking.agreement);
        }
        // END pickup

        // BEGIN return
        public synchronized Invoice returnVehicle(String reservationId, String customerId, Reading reading) {
            Booking booking=owned(reservationId,customerId); Objects.requireNonNull(reading);
            if (booking.agreement == null) throw new IllegalStateException("No rental agreement");
            if (booking.state == State.RETURNED) {
                if (!booking.agreement.returned().equals(reading)) throw new IllegalArgumentException("Return payload conflict");
                return booking.invoice; // A replay never changes the vehicle's newer active reservation.
            }
            Vehicle vehicle=asset(booking.quote.vehicleId());
            if (booking.state != State.ACTIVE || !booking.id.equals(vehicle.activeId)) throw new IllegalStateException("Stale rental owner");
            if (reading.odometerKm() < booking.agreement.pickup().odometerKm()) throw new IllegalArgumentException("Odometer moved backwards");
            Instant now=now();
            if (now.isBefore(booking.agreement.pickedUpAt())) throw new IllegalStateException("Return before pickup");
            Duration late=now.isAfter(booking.quote.window().end()) ? Duration.between(booking.quote.window().end(),now) : Duration.ZERO;
            long latePaise=Math.multiplyExact(startedUnits(late,Duration.ofHours(1)),booking.quote.tariff().lateHourPaise());
            long base=booking.quote.basePaise();
            Invoice invoice=new Invoice("invoice/"+booking.id,booking.id,base,latePaise,0,Math.addExact(base,latePaise),now);
            booking.agreement=new AgreementView(booking.agreement.id(),booking.agreement.pickedUpAt(),booking.agreement.pickup(),now,reading);
            booking.invoice=invoice; booking.state=State.RETURNED;
            vehicle.activeId=null; vehicle.readyAt=now.plus(PREPARATION); vehicle.maintenance=reading.damaged();
            return invoice;
        }
        // END return

        // BEGIN cancel
        public synchronized Invoice cancel(String reservationId, String customerId) {
            Booking booking=owned(reservationId,customerId);
            if (booking.state == State.CANCELLED) return booking.invoice;
            if (booking.state != State.CONFIRMED) throw new IllegalStateException("After pickup, return the vehicle instead");
            long fee=now().isBefore(booking.quote.window().start()) || readinessIssue(booking)!=null
                ? 0 : booking.quote.tariff().lateCancelPaise();
            booking.invoice=new Invoice("cancel/"+booking.id,booking.id,0,0,fee,fee,now());
            booking.state=State.CANCELLED; return booking.invoice;
        }
        public synchronized boolean expireNoShow(String reservationId) {
            Booking booking=booking(reservationId);
            if (booking.state != State.CONFIRMED || now().isBefore(booking.quote.window().start().plus(PICKUP_GRACE))
                || readinessIssue(booking)!=null) return false; // Operator unreadiness is not a customer no-show.
            cancel(booking.id,booking.quote.customerId()); return true;
        }
        // END cancel

        public synchronized void finishMaintenance(String vehicleId) {
            Vehicle vehicle=asset(vehicleId);
            if (vehicle.activeId != null) throw new IllegalStateException("Vehicle is still rented");
            vehicle.maintenance=false; // The independently recorded preparation deadline still applies.
        }

        private boolean free(Vehicle vehicle, Window requested) {
            if (vehicle.maintenance || requested.start().isBefore(vehicle.readyAt)) return false;
            if (vehicle.activeId != null && !now().isBefore(booking(vehicle.activeId).quote.window().end())) return false;
            return bookings.values().stream().noneMatch(b -> b.quote.vehicleId().equals(vehicle.id)
                && (b.state==State.CONFIRMED || b.state==State.ACTIVE) && b.quote.window().overlaps(requested));
        }
        private String readinessIssue(Booking booking) {
            if (booking.state != State.CONFIRMED) return null;
            Vehicle vehicle=asset(booking.quote.vehicleId());
            if (vehicle.maintenance) return "Vehicle requires maintenance; arrange replacement or customer remedy";
            if (booking.quote.window().start().isBefore(vehicle.readyAt)) return "Actual preparation deadline conflicts with promised pickup";
            if (vehicle.activeId != null && !now().isBefore(booking(vehicle.activeId).quote.window().end()))
                return "Previous rental is overdue; readiness is unknown";
            return null;
        }
        private ReservationView view(Booking booking) {
            return new ReservationView(booking.id,booking.quote,booking.state,booking.agreement,booking.invoice,readinessIssue(booking));
        }
        private void validateWindow(Window window) {
            Objects.requireNonNull(window);
            if (window.start().isBefore(now()) || Duration.between(window.start(),window.end()).compareTo(Duration.ofDays(30))>0)
                throw new IllegalArgumentException("New reservations start now or later and last at most 30 days");
        }
        private void requireEligible(String customerId) {
            if (!Boolean.TRUE.equals(eligible.get(customerId))) throw new IllegalStateException("Customer is not currently eligible");
        }
        private Booking owned(String id,String customerId) {
            Booking booking=booking(id);
            if (!booking.quote.customerId().equals(customerId)) throw new IllegalArgumentException("Reservation belongs to another customer");
            return booking;
        }
        private Vehicle asset(String id) { return Objects.requireNonNull(vehicles.get(id),"Unknown vehicle"); }
        private Booking booking(String id) { return Objects.requireNonNull(bookings.get(id),"Unknown reservation"); }
    }

    // BEGIN price
    public static long startedUnits(Duration elapsed, Duration unit) {
        if (elapsed.isNegative() || unit.isNegative() || unit.isZero()) throw new IllegalArgumentException("Invalid duration");
        long whole=elapsed.dividedBy(unit);
        return elapsed.minus(unit.multipliedBy(whole)).isZero() ? whole : Math.incrementExact(whole);
    }
    // END price
    private static void key(String value) { if (value==null || value.isBlank()) throw new IllegalArgumentException("Missing ID"); }
}

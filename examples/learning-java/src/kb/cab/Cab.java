package kb.cab;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/** One dispatch authority. City-plane positions and meter data are teaching inputs. */
public final class Cab {
    private Cab() {}
    public static final Duration OFFER_LIFE = Duration.ofSeconds(15);
    public static final Duration SEARCH_LIFE = Duration.ofMinutes(2);
    public static final Duration GPS_AGE = Duration.ofSeconds(10);

    // BEGIN values
    public enum Category { STANDARD, XL }
    public enum DriverState { OFFLINE, AVAILABLE, OFFERED, ON_TRIP }
    public enum TripState { SEARCHING, OFFERED, ASSIGNED, ARRIVED, IN_PROGRESS, COMPLETED, CANCELLED }
    public enum OfferState { PENDING, ACCEPTED, DECLINED, EXPIRED, CANCELLED }
    public enum Decision { ACCEPTED, REPLAYED, EXPIRED, NOT_CURRENT, CANCELLED, STALE_VERSION }
    public record Point(int xMeters, int yMeters) {
        public Point {
            if (xMeters < -100_000 || xMeters > 100_000 || yMeters < -100_000 || yMeters > 100_000)
                throw new IllegalArgumentException("Outside demo city plane");
        }
        public long distanceSquared(Point other) {
            long dx = (long) xMeters - other.xMeters, dy = (long) yMeters - other.yMeters;
            return dx * dx + dy * dy;
        }
    }
    public record Estimate(int distanceMeters, int durationSeconds) {
        public Estimate {
            if (distanceMeters < 0 || durationSeconds < 0 || distanceMeters > 1_000_000 || durationSeconds > 86_400)
                throw new IllegalArgumentException("Invalid route estimate");
        }
    }
    /** Implementations here are pure bounded calculations, never network calls. */
    public interface Estimator { Estimate estimate(Point pickup, Point destination); }
    public record Tariff(long basePaise, long startedKmPaise, long startedMinutePaise,
                         long arrivedCancellationPaise) {
        public Tariff {
            if (basePaise < 0 || startedKmPaise < 0 || startedMinutePaise < 0 || arrivedCancellationPaise < 0)
                throw new IllegalArgumentException("Negative tariff");
        }
    }
    public record OfferView(String id, String tripId, String driverId, Instant expiresAt, OfferState state) {}
    public record DriverView(String id, DriverState state, Point point, Instant observedAt,
                             String offerId, String tripId) {}
    public record TripView(String id, String riderId, TripState state, int version, String offerId,
                           String driverId, long estimatedPaise, Long finalPaise,
                           Long cancellationQuotePaise, long cancellationPaise, String reason) {}
    public record Result(Decision decision, TripView trip) {}
    public record Event(String tripId, int version, TripState state, String reason) {}
    // END values

    private record RequestKey(String riderId, String requestId) {}
    private record Command(Point pickup, Point destination, Category category) {}
    private static final class Driver {
        final String id;
        final Category category;
        DriverState state = DriverState.AVAILABLE;
        Point point;
        Instant observedAt;
        long locationSequence;
        String offerId, tripId;
        Driver(String id, Category category, Point point, Instant now) {
            this.id = id; this.category = category; this.point = point; observedAt = now;
        }
        DriverView view() { return new DriverView(id, state, point, observedAt, offerId, tripId); }
    }
    private static final class Trip {
        final String id, riderId;
        final Command command;
        final Tariff tariff;
        final long estimatedPaise;
        final Instant searchUntil;
        final Set<String> triedDrivers = new HashSet<>();
        TripState state = TripState.SEARCHING;
        int version;
        String offerId, driverId, reason = "awaiting dispatch";
        Instant arrivedAt, startedAt, completedAt;
        Integer measuredMeters;
        Long finalPaise;
        long cancellationPaise;
        Trip(String id, String riderId, Command command, Tariff tariff, long estimatedPaise, Instant searchUntil) {
            this.id = id; this.riderId = riderId; this.command = command;
            this.tariff = tariff; this.estimatedPaise = estimatedPaise; this.searchUntil = searchUntil;
        }
        TripView view() {
            Long cancellationQuote = switch (state) {
                case SEARCHING, OFFERED, ASSIGNED -> 0L;
                case ARRIVED -> tariff.arrivedCancellationPaise();
                default -> null;
            };
            return new TripView(id, riderId, state, version, offerId, driverId,
                estimatedPaise, finalPaise, cancellationQuote, cancellationPaise, reason);
        }
    }
    private static final class Offer {
        final String id, tripId, driverId;
        final Instant expiresAt;
        OfferState state = OfferState.PENDING;
        Offer(String id, String tripId, String driverId, Instant expiresAt) {
            this.id = id; this.tripId = tripId; this.driverId = driverId; this.expiresAt = expiresAt;
        }
        OfferView view() { return new OfferView(id, tripId, driverId, expiresAt, state); }
    }

    public static final class Service {
        private final Clock clock;
        private final Estimator estimator;
        private Tariff tariff;
        private final Map<String, Driver> drivers = new LinkedHashMap<>();
        private final Map<String, Trip> trips = new LinkedHashMap<>();
        private final Map<String, Offer> offers = new LinkedHashMap<>();
        private final Map<RequestKey, String> requests = new HashMap<>();
        private final Map<String, String> riderActive = new HashMap<>();
        private final List<Event> events = new ArrayList<>();
        private int tripSequence, offerSequence;

        public Service(Clock clock, Estimator estimator, Tariff tariff) {
            this.clock = Objects.requireNonNull(clock);
            this.estimator = Objects.requireNonNull(estimator);
            this.tariff = Objects.requireNonNull(tariff);
        }
        public synchronized Instant now() { return clock.instant(); }
        public synchronized void addDriver(String id, Category category, Point point) {
            key(id); Objects.requireNonNull(category); Objects.requireNonNull(point);
            if (drivers.putIfAbsent(id, new Driver(id, category, point, now())) != null)
                throw new IllegalArgumentException("Duplicate driver");
        }
        public synchronized boolean location(String driverId, long sequence, Point point) {
            Driver d = driver(driverId); Objects.requireNonNull(point);
            if (sequence <= d.locationSequence) return false;
            d.locationSequence = sequence; d.point = point; d.observedAt = now();
            return true;
        }
        public synchronized void online(String driverId, boolean online) {
            Driver d = driver(driverId);
            if (d.offerId != null || d.tripId != null) throw new IllegalStateException("Cannot discard current ownership");
            d.state = online ? DriverState.AVAILABLE : DriverState.OFFLINE;
        }
        public synchronized void changeTariff(Tariff next) { tariff = Objects.requireNonNull(next); }
        public synchronized DriverView driverView(String id) { return driver(id).view(); }
        public synchronized TripView tripView(String id) { return trip(id).view(); }
        public synchronized OfferView offerView(String id) { return offer(id).view(); }
        public synchronized List<DriverView> drivers() { return drivers.values().stream().map(Driver::view).toList(); }
        public synchronized List<TripView> trips() { return trips.values().stream().map(Trip::view).toList(); }
        public synchronized List<OfferView> offers() { return offers.values().stream().map(Offer::view).toList(); }
        public synchronized List<Event> events() { return List.copyOf(events); }

        public synchronized TripView request(String requestId, String riderId, Point pickup,
                                             Point destination, Category category) {
            key(requestId); key(riderId);
            Command command = new Command(Objects.requireNonNull(pickup), Objects.requireNonNull(destination), Objects.requireNonNull(category));
            RequestKey key = new RequestKey(riderId, requestId);
            String old = requests.get(key);
            if (old != null) {
                Trip t = trip(old);
                if (!t.command.equals(command)) throw new IllegalArgumentException("Request ID payload conflict");
                return t.view();
            }
            if (riderActive.containsKey(riderId)) throw new IllegalStateException("Rider already has a live trip");
            Estimate estimate = Objects.requireNonNull(estimator.estimate(pickup, destination));
            Trip t = new Trip("T" + ++tripSequence, riderId, command, tariff,
                fare(tariff, estimate.distanceMeters(), Duration.ofSeconds(estimate.durationSeconds())), now().plus(SEARCH_LIFE));
            trips.put(t.id, t); requests.put(key, t.id); riderActive.put(riderId, t.id);
            events.add(new Event(t.id, 0, t.state, t.reason));
            return t.view();
        }

        // BEGIN offer
        public synchronized Optional<OfferView> offerNext(String tripId) {
            Trip t = trip(tripId);
            expireSearch(tripId);
            if (t.state == TripState.CANCELLED) return Optional.empty();
            if (t.state != TripState.SEARCHING) throw new IllegalStateException("Trip already has an offer or assignment");
            Instant now = now();
            Optional<Driver> candidate = drivers.values().stream()
                .filter(d -> d.state == DriverState.AVAILABLE && d.category == t.command.category()
                    && !t.triedDrivers.contains(d.id) && !d.observedAt.isAfter(now)
                    && Duration.between(d.observedAt, now).compareTo(GPS_AGE) < 0
                    && d.point.distanceSquared(t.command.pickup()) <= 25_000_000L)
                .min(Comparator.comparingLong((Driver d) -> d.point.distanceSquared(t.command.pickup())).thenComparing(d -> d.id));
            if (candidate.isEmpty()) return Optional.empty();
            Driver d = candidate.get();
            Instant until = now.plus(OFFER_LIFE);
            if (t.searchUntil.isBefore(until)) until = t.searchUntil;
            Offer offer = new Offer("O" + ++offerSequence, t.id, d.id, until);
            offers.put(offer.id, offer); t.triedDrivers.add(d.id);
            d.state = DriverState.OFFERED; d.offerId = offer.id; t.offerId = offer.id;
            transition(t, TripState.OFFERED, "exclusive offer issued");
            return Optional.of(offer.view());
        }

        public synchronized Result accept(String offerId, String driverId) {
            Offer offer = ownedOffer(offerId, driverId);
            Trip t = trip(offer.tripId); Driver d = driver(driverId);
            if (offer.state == OfferState.ACCEPTED) return new Result(Decision.REPLAYED, t.view());
            if (offer.state != OfferState.PENDING) return new Result(Decision.NOT_CURRENT, t.view());
            if (!now().isBefore(offer.expiresAt)) {
                expireOffer(offer.id);
                return new Result(Decision.EXPIRED, t.view());
            }
            if (t.state != TripState.OFFERED || !offer.id.equals(t.offerId)
                || d.state != DriverState.OFFERED || !offer.id.equals(d.offerId))
                return new Result(Decision.NOT_CURRENT, t.view());
            offer.state = OfferState.ACCEPTED;
            t.offerId = null; t.driverId = d.id;
            d.offerId = null; d.tripId = t.id; d.state = DriverState.ON_TRIP;
            transition(t, TripState.ASSIGNED, "driver and trip assigned together");
            return new Result(Decision.ACCEPTED, t.view());
        }
        // END offer

        // BEGIN expiry
        public synchronized boolean decline(String offerId, String driverId) {
            Offer o = ownedOffer(offerId, driverId);
            if (o.state != OfferState.PENDING) return false;
            retire(o, OfferState.DECLINED, true); return true;
        }
        public synchronized boolean expireOffer(String offerId) {
            Offer o = offer(offerId);
            if (o.state != OfferState.PENDING || now().isBefore(o.expiresAt)) return false;
            retire(o, OfferState.EXPIRED, true); expireSearch(o.tripId); return true;
        }
        public synchronized boolean expireSearch(String tripId) {
            Trip t = trip(tripId);
            if ((t.state != TripState.SEARCHING && t.state != TripState.OFFERED) || now().isBefore(t.searchUntil)) return false;
            if (t.offerId != null) retire(offer(t.offerId), OfferState.CANCELLED, false);
            transition(t, TripState.CANCELLED, "search deadline expired without assignment");
            riderActive.remove(t.riderId, t.id); return true;
        }
        private void retire(Offer o, OfferState state, boolean resetTrip) {
            Driver d = driver(o.driverId); Trip t = trip(o.tripId);
            if (d.state == DriverState.OFFERED && o.id.equals(d.offerId)) {
                d.offerId = null; d.state = DriverState.AVAILABLE;
            }
            if (t.state == TripState.OFFERED && o.id.equals(t.offerId)) {
                t.offerId = null;
                if (resetTrip) transition(t, TripState.SEARCHING, "offer retired: " + state);
            }
            o.state = state;
        }
        // END expiry

        // BEGIN lifecycle
        public synchronized TripView arrive(String tripId, String driverId) {
            Trip t = driverTrip(tripId, driverId);
            if (t.arrivedAt != null) return t.view();
            requireState(t, TripState.ASSIGNED); requireDriverOwner(t);
            t.arrivedAt = now(); transition(t, TripState.ARRIVED, "driver reported arrival; not proof of rider pickup");
            return t.view();
        }
        public synchronized TripView start(String tripId, String riderId) {
            Trip t = riderTrip(tripId, riderId);
            if (t.startedAt != null) return t.view();
            requireState(t, TripState.ARRIVED); requireDriverOwner(t);
            t.startedAt = now(); transition(t, TripState.IN_PROGRESS, "authenticated rider confirmed start");
            return t.view();
        }
        public synchronized TripView finish(String tripId, String driverId, int measuredMeters) {
            Trip t = driverTrip(tripId, driverId);
            if (t.completedAt != null) {
                if (!Objects.equals(t.measuredMeters, measuredMeters)) throw new IllegalArgumentException("Completion evidence conflict");
                return t.view();
            }
            if (measuredMeters < 0 || measuredMeters > 1_000_000) throw new IllegalArgumentException("Invalid meter evidence");
            requireState(t, TripState.IN_PROGRESS); requireDriverOwner(t);
            Instant now = now();
            if (now.isBefore(t.startedAt)) throw new IllegalStateException("Clock precedes trip start");
            long finalFare = fare(t.tariff, measuredMeters, Duration.between(t.startedAt, now));
            t.completedAt = now; t.measuredMeters = measuredMeters; t.finalPaise = finalFare;
            Driver d = driver(t.driverId); d.tripId = null; d.state = DriverState.AVAILABLE;
            transition(t, TripState.COMPLETED, "meter evidence frozen; cash fare due, not proof of payment");
            riderActive.remove(t.riderId, t.id); return t.view();
        }
        // END lifecycle

        // BEGIN cancel
        public synchronized Result cancel(String tripId, String riderId, int expectedVersion) {
            Trip t = riderTrip(tripId, riderId);
            if (t.state == TripState.CANCELLED) return new Result(Decision.REPLAYED, t.view());
            if (t.state == TripState.IN_PROGRESS || t.state == TripState.COMPLETED)
                throw new IllegalStateException("Use trip completion or dispute workflow");
            if (t.version != expectedVersion) return new Result(Decision.STALE_VERSION, t.view());
            if (t.offerId != null) retire(offer(t.offerId), OfferState.CANCELLED, false);
            if (t.driverId != null) {
                requireDriverOwner(t); Driver d = driver(t.driverId);
                d.tripId = null; d.state = DriverState.AVAILABLE;
            }
            t.cancellationPaise = t.state == TripState.ARRIVED ? t.tariff.arrivedCancellationPaise() : 0;
            transition(t, TripState.CANCELLED, "rider cancellation at approved version");
            riderActive.remove(t.riderId, t.id); return new Result(Decision.CANCELLED, t.view());
        }
        // END cancel

        private void requireDriverOwner(Trip t) {
            Driver d = driver(t.driverId);
            if (d.state != DriverState.ON_TRIP || !t.id.equals(d.tripId)) throw new IllegalStateException("Driver belongs to another trip");
        }
        private void transition(Trip t, TripState state, String reason) {
            t.state = state; t.version++; t.reason = reason;
            events.add(new Event(t.id, t.version, state, reason));
        }
        private Trip riderTrip(String id, String rider) {
            Trip t = trip(id); if (!t.riderId.equals(rider)) throw new IllegalArgumentException("Wrong rider"); return t;
        }
        private Trip driverTrip(String id, String driver) {
            Trip t = trip(id); if (!Objects.equals(t.driverId, driver)) throw new IllegalArgumentException("Wrong driver"); return t;
        }
        private Offer ownedOffer(String id, String driver) {
            Offer o = offer(id); if (!o.driverId.equals(driver)) throw new IllegalArgumentException("Wrong offer driver"); return o;
        }
        private Trip trip(String id) { return Objects.requireNonNull(trips.get(id), "Unknown trip"); }
        private Driver driver(String id) { return Objects.requireNonNull(drivers.get(id), "Unknown driver"); }
        private Offer offer(String id) { return Objects.requireNonNull(offers.get(id), "Unknown offer"); }
        private static void requireState(Trip t, TripState expected) {
            if (t.state != expected) throw new IllegalStateException("Expected " + expected + ", was " + t.state);
        }
    }

    // BEGIN fare
    public static long fare(Tariff tariff, int meters, Duration elapsed) {
        if (meters < 0 || elapsed.isNegative()) throw new IllegalArgumentException("Invalid measured usage");
        long km = meters / 1_000L + (meters % 1_000 == 0 ? 0 : 1);
        long minutes = elapsed.dividedBy(Duration.ofMinutes(1));
        if (!elapsed.minus(Duration.ofMinutes(minutes)).isZero()) minutes++;
        return Math.addExact(tariff.basePaise(), Math.addExact(
            Math.multiplyExact(km, tariff.startedKmPaise()), Math.multiplyExact(minutes, tariff.startedMinutePaise())));
    }
    // END fare
    private static void key(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Missing ID");
    }
}

package kb.cabbooking;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

// region:enums
enum VehicleType { MINI, SEDAN, SUV }
enum DriverStatus { OFFLINE, AVAILABLE, ON_TRIP }
enum TripStatus {
    REQUESTED, DRIVER_ASSIGNED, DRIVER_ARRIVED, IN_PROGRESS, COMPLETED, CANCELLED
}
// endregion:enums

// region:location
record Location(double lat, double lng) {
    /** Straight-line distance in km (haversine). Real apps use road ETA. */
    double distanceKm(Location o) {
        double dLat = Math.toRadians(o.lat - lat), dLng = Math.toRadians(o.lng - lng);
        double a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(Math.toRadians(lat))
                * Math.cos(Math.toRadians(o.lat)) * Math.pow(Math.sin(dLng / 2), 2);
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
// endregion:location

// region:driver
class Driver {
    private final String name;
    private final VehicleType type;
    private volatile Location location;
    private final AtomicReference<DriverStatus> status =
            new AtomicReference<>(DriverStatus.OFFLINE);

    Driver(String name, VehicleType type, Location location) {
        this.name = name; this.type = type; this.location = location;
    }
    void goOnline()           { status.set(DriverStatus.AVAILABLE); }
    /** Atomic: becomes ON_TRIP only if still AVAILABLE. */
    boolean tryClaim() {
        return status.compareAndSet(DriverStatus.AVAILABLE, DriverStatus.ON_TRIP);
    }
    void release()            { status.set(DriverStatus.AVAILABLE); }
    String getName()          { return name; }
    VehicleType getType()     { return type; }
    Location getLocation()    { return location; }
    DriverStatus getStatus()  { return status.get(); }
}
// endregion:driver

// region:trip
class Trip {
    private final String rider;
    private final Location pickup, drop;
    private final VehicleType type;
    private TripStatus status = TripStatus.REQUESTED;
    private Driver driver;
    private long fareRupees;

    Trip(String rider, Location pickup, Location drop, VehicleType type) {
        this.rider = rider; this.pickup = pickup; this.drop = drop; this.type = type;
    }
    /** Moves to the next status only from the expected one. */
    void transition(TripStatus from, TripStatus to) {
        if (status != from) {
            throw new IllegalStateException("Trip is " + status + ", not " + from);
        }
        status = to;
    }
    void assign(Driver d) {
        transition(TripStatus.REQUESTED, TripStatus.DRIVER_ASSIGNED);
        driver = d;
    }
    String getRider()        { return rider; }
    Location getPickup()     { return pickup; }
    VehicleType getType()    { return type; }
    TripStatus getStatus()   { return status; }
    Driver getDriver()       { return driver; }
    long getFare()           { return fareRupees; }
    void setFare(long fare)  { fareRupees = fare; }
}
// endregion:trip

// region:strategies
interface MatchingStrategy {
    List<Driver> findCandidates(Trip trip, Collection<Driver> drivers);
}

class NearestDriverStrategy implements MatchingStrategy {
    public List<Driver> findCandidates(Trip trip, Collection<Driver> drivers) {
        return drivers.stream()
                .filter(d -> d.getStatus() == DriverStatus.AVAILABLE)
                .filter(d -> d.getType() == trip.getType())
                .filter(d -> d.getLocation().distanceKm(trip.getPickup()) <= 5)
                .sorted(Comparator.comparingDouble(
                        d -> d.getLocation().distanceKm(trip.getPickup())))
                .toList();
    }
}

interface FareStrategy {
    long fare(double km, Duration time);
}

/** Rs 40 base + Rs 12 per km + Rs 2 per minute. */
class StandardFare implements FareStrategy {
    public long fare(double km, Duration time) {
        return Math.round(40 + 12 * km + 2 * time.toMinutes());
    }
}
// endregion:strategies

// region:service
class RideService {
    private final List<Driver> drivers;
    private final MatchingStrategy matching;
    private final FareStrategy fares;
    private final Set<String> ridersOnTrip = new HashSet<>();

    RideService(List<Driver> drivers, MatchingStrategy matching, FareStrategy fares) {
        this.drivers = drivers; this.matching = matching; this.fares = fares;
    }

    synchronized Trip requestRide(String rider, Location pickup, Location drop,
                                  VehicleType type) {
        if (!ridersOnTrip.add(rider)) {
            throw new IllegalStateException(rider + " already has a trip");
        }
        return new Trip(rider, pickup, drop, type);
    }

    List<Driver> candidates(Trip trip) { return matching.findCandidates(trip, drivers); }

    /** Called when a driver taps Accept. Only one driver per trip, one trip per driver. */
    boolean accept(Trip trip, Driver driver) {
        synchronized (trip) {
            if (trip.getStatus() != TripStatus.REQUESTED) return false;  // trip taken
            if (!driver.tryClaim()) return false;                         // driver busy
            trip.assign(driver);
            return true;
        }
    }

    void arrive(Trip trip) {
        synchronized (trip) {
            trip.transition(TripStatus.DRIVER_ASSIGNED, TripStatus.DRIVER_ARRIVED);
        }
    }

    void start(Trip trip) {
        synchronized (trip) {
            trip.transition(TripStatus.DRIVER_ARRIVED, TripStatus.IN_PROGRESS);
        }
    }

    long end(Trip trip, double km, Duration time) {
        synchronized (trip) {
            trip.transition(TripStatus.IN_PROGRESS, TripStatus.COMPLETED);
            trip.setFare(fares.fare(km, time));
            trip.getDriver().release();                     // ready for the next ride
            synchronized (this) { ridersOnTrip.remove(trip.getRider()); }
            return trip.getFare();
        }
    }
}
// endregion:service

public class CabBookingDemo {
    public static void main(String[] args) {
        Location mgRoad = new Location(12.9756, 77.6050);
        Driver ravi  = new Driver("Ravi",  VehicleType.MINI, new Location(12.9790, 77.6060));
        Driver sunil = new Driver("Sunil", VehicleType.MINI, new Location(12.9830, 77.6060));
        Driver meena = new Driver("Meena", VehicleType.SEDAN, new Location(12.9760, 77.6055));
        List.of(ravi, sunil, meena).forEach(Driver::goOnline);
        RideService service = new RideService(List.of(ravi, sunil, meena),
                new NearestDriverStrategy(), new StandardFare());

        Trip asha = service.requestRide("Asha", mgRoad, new Location(12.93, 77.62), VehicleType.MINI);
        Trip bilal = service.requestRide("Bilal", mgRoad, new Location(12.95, 77.64), VehicleType.MINI);
        check(service.candidates(asha).get(0) == ravi, "Ravi nearest mini");
        check(service.accept(asha, ravi), "Ravi takes Asha");
        check(!service.accept(bilal, ravi), "Ravi cannot take Bilal too");
        check(!service.accept(asha, sunil), "Asha's trip already has a driver");
        check(service.accept(bilal, sunil), "Sunil takes Bilal");
        service.arrive(asha); service.start(asha);
        check(service.end(asha, 2.1, Duration.ofMinutes(8)) == 81, "40 + 25.2 + 16 = 81");
        check(ravi.getStatus() == DriverStatus.AVAILABLE, "Ravi free again");
        System.out.println("All checks passed");
    }
    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}

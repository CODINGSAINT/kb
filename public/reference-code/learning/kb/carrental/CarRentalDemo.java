package kb.carrental;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

// region:enums
enum VehicleType { HATCHBACK, SEDAN, SUV }
enum VehicleStatus { AVAILABLE, RENTED, IN_MAINTENANCE }
enum ReservationStatus { CONFIRMED, PICKED_UP, RETURNED, CANCELLED }
// endregion:enums

// region:vehicle
class Vehicle {
    private final String registration;           // KA-01-MJ-4521
    private final VehicleType type;
    private VehicleStatus status = VehicleStatus.AVAILABLE;

    Vehicle(String registration, VehicleType type) {
        this.registration = registration;
        this.type = type;
    }
    String getRegistration()          { return registration; }
    VehicleType getType()             { return type; }
    VehicleStatus getStatus()         { return status; }
    void setStatus(VehicleStatus s)   { status = s; }
}
// endregion:vehicle

// region:reservation
class Reservation {
    static final Duration CLEANING = Duration.ofHours(1);

    private final String customer;
    private final Vehicle vehicle;
    private final Instant start, end;              // the time range [start, end)
    private ReservationStatus status = ReservationStatus.CONFIRMED;

    Reservation(String customer, Vehicle vehicle, Instant start, Instant end) {
        this.customer = customer; this.vehicle = vehicle;
        this.start = start; this.end = end;
    }

    boolean isActive() {
        return status == ReservationStatus.CONFIRMED
            || status == ReservationStatus.PICKED_UP;
    }

    /** Two ranges overlap when each starts before the other ends (cleaning included). */
    boolean overlaps(Instant otherStart, Instant otherEnd) {
        return start.isBefore(otherEnd.plus(CLEANING))
            && otherStart.isBefore(end.plus(CLEANING));
    }

    Vehicle getVehicle()                 { return vehicle; }
    Instant getStart()                   { return start; }
    Instant getEnd()                     { return end; }
    ReservationStatus getStatus()        { return status; }
    void setStatus(ReservationStatus s)  { status = s; }
}
// endregion:reservation

// region:pricing
record Invoice(long baseRupees, long lateFeeRupees) {
    long total() { return baseRupees + lateFeeRupees; }
}

interface PricingStrategy {
    Invoice invoice(Reservation r, Instant returnedAt);
}

/** Rs 1,800 per started day booked, plus Rs 200 per started hour late. */
class DailyRatePricing implements PricingStrategy {
    public Invoice invoice(Reservation r, Instant returnedAt) {
        Duration booked = Duration.between(r.getStart(), r.getEnd());
        long days = startedUnits(booked, Duration.ofDays(1));
        Duration late = returnedAt.isAfter(r.getEnd())
                ? Duration.between(r.getEnd(), returnedAt) : Duration.ZERO;
        long lateHours = startedUnits(late, Duration.ofHours(1));
        return new Invoice(days * 1_800, lateHours * 200);
    }

    static long startedUnits(Duration d, Duration unit) {   // 25 hours -> 2 started days
        long whole = d.dividedBy(unit);
        return d.equals(unit.multipliedBy(whole)) ? whole : whole + 1;
    }
}
// endregion:pricing

// region:service
class RentalService {
    private final List<Vehicle> fleet;
    private final Map<Vehicle, List<Reservation>> calendar = new HashMap<>();
    private final PricingStrategy pricing;

    RentalService(List<Vehicle> fleet, PricingStrategy pricing) {
        this.fleet = fleet;
        this.pricing = pricing;
    }

    List<Vehicle> search(VehicleType type, Instant start, Instant end) {
        return fleet.stream()
                .filter(v -> v.getType() == type)
                .filter(v -> v.getStatus() != VehicleStatus.IN_MAINTENANCE)
                .filter(v -> isFree(v, start, end))
                .toList();
    }

    Reservation reserve(String customer, Vehicle vehicle, Instant start, Instant end) {
        if (!start.isBefore(end)) {
            throw new IllegalArgumentException("End must be after start");
        }
        synchronized (vehicle) {                           // check and insert together
            if (!isFree(vehicle, start, end)) {
                throw new IllegalStateException(vehicle.getRegistration() + " is not free");
            }
            Reservation r = new Reservation(customer, vehicle, start, end);
            calendar.computeIfAbsent(vehicle, v -> new ArrayList<>()).add(r);
            return r;
        }
    }

    private boolean isFree(Vehicle vehicle, Instant start, Instant end) {
        return calendar.getOrDefault(vehicle, List.of()).stream()
                .filter(Reservation::isActive)
                .noneMatch(r -> r.overlaps(start, end));
    }

    void pickup(Reservation r) {
        synchronized (r.getVehicle()) {
            if (r.getStatus() != ReservationStatus.CONFIRMED
                    || r.getVehicle().getStatus() != VehicleStatus.AVAILABLE) {
                throw new IllegalStateException("Vehicle not ready");
            }
            r.setStatus(ReservationStatus.PICKED_UP);
            r.getVehicle().setStatus(VehicleStatus.RENTED);
        }
    }

    Invoice returnVehicle(Reservation r, Instant returnedAt, boolean damaged) {
        synchronized (r.getVehicle()) {
            if (r.getStatus() != ReservationStatus.PICKED_UP) {
                throw new IllegalStateException("Not on rent");
            }
            r.setStatus(ReservationStatus.RETURNED);
            r.getVehicle().setStatus(damaged ? VehicleStatus.IN_MAINTENANCE
                                             : VehicleStatus.AVAILABLE);
            return pricing.invoice(r, returnedAt);
        }
    }

    void cancel(Reservation r) {
        synchronized (r.getVehicle()) {
            if (r.getStatus() != ReservationStatus.CONFIRMED) {
                throw new IllegalStateException("Only a confirmed reservation can be cancelled");
            }
            r.setStatus(ReservationStatus.CANCELLED);     // stops blocking the calendar
        }
    }
}
// endregion:service

public class CarRentalDemo {
    public static void main(String[] args) {
        Vehicle swift = new Vehicle("KA-01-MJ-4521", VehicleType.HATCHBACK);
        RentalService service = new RentalService(List.of(swift), new DailyRatePricing());
        Instant nine = Instant.parse("2026-11-01T09:00:00Z");
        Instant eleven = nine.plus(Duration.ofHours(2)), noon = nine.plus(Duration.ofHours(3));

        Reservation asha = service.reserve("Asha", swift, nine, eleven);
        check(service.search(VehicleType.HATCHBACK, eleven, noon.plusSeconds(7200)).isEmpty(),
              "11:00 overlaps cleaning");
        try { service.reserve("Bilal", swift, eleven, noon.plusSeconds(7200)); check(false, "11:00"); }
        catch (IllegalStateException expected) { }
        Reservation bilal = service.reserve("Bilal", swift, noon, noon.plus(Duration.ofHours(3)));
        service.pickup(asha);
        Invoice bill = service.returnVehicle(asha, eleven.plus(Duration.ofMinutes(70)), false);
        check(bill.baseRupees() == 1_800 && bill.lateFeeRupees() == 400 && bill.total() == 2_200,
              "Rs 1,800 + 2 late hours");
        service.cancel(bilal);
        check(service.search(VehicleType.HATCHBACK, noon, noon.plusSeconds(3600)).size() == 1,
              "cancelled booking frees the slot");
        check(DailyRatePricing.startedUnits(Duration.ofHours(25), Duration.ofDays(1)) == 2, "25h = 2 days");
        System.out.println("All checks passed");
    }
    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}

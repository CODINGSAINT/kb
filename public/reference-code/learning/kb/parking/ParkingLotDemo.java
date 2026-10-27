package kb.parking;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

// region:vehicle
enum Size { SMALL, MEDIUM, LARGE }   // order matters: a vehicle fits a spot of its size or bigger

abstract class Vehicle {
    private final String licensePlate;
    protected Vehicle(String licensePlate) { this.licensePlate = licensePlate; }
    String getLicensePlate() { return licensePlate; }
    abstract Size getSize();
}

class Motorcycle extends Vehicle {
    Motorcycle(String plate) { super(plate); }
    Size getSize() { return Size.SMALL; }
}

class Car extends Vehicle {
    Car(String plate) { super(plate); }
    Size getSize() { return Size.MEDIUM; }
}

class Truck extends Vehicle {
    Truck(String plate) { super(plate); }
    Size getSize() { return Size.LARGE; }
}
// endregion:vehicle

// region:spot
class ParkingSpot {
    private final int floor;
    private final int number;
    private final Size size;
    private Vehicle vehicle;            // null when the spot is free

    ParkingSpot(int floor, int number, Size size) {
        this.floor = floor; this.number = number; this.size = size;
    }

    boolean isFree()             { return vehicle == null; }
    boolean canFit(Vehicle v)    { return isFree() && size.compareTo(v.getSize()) >= 0; }
    void park(Vehicle v)         { vehicle = v; }
    void free()                  { vehicle = null; }
    Size getSize()               { return size; }
    int getFloor()               { return floor; }
    String label()               { return "Floor " + floor + ", spot " + number; }
}
// endregion:spot

// region:ticket
class Ticket {
    private final String id;
    private final Vehicle vehicle;
    private final ParkingSpot spot;
    private final Instant entryTime;

    Ticket(String id, Vehicle vehicle, ParkingSpot spot, Instant entryTime) {
        this.id = id; this.vehicle = vehicle; this.spot = spot; this.entryTime = entryTime;
    }
    String getId()          { return id; }
    Vehicle getVehicle()    { return vehicle; }
    ParkingSpot getSpot()   { return spot; }
    Instant getEntryTime()  { return entryTime; }
}
// endregion:ticket

// region:fee
interface FeeStrategy {
    long calculateFee(Instant entry, Instant exit);   // in rupees
}

/** ₹40 for the first hour (or part of it), ₹20 for every further hour that has started. */
class HourlyFeeStrategy implements FeeStrategy {
    public long calculateFee(Instant entry, Instant exit) {
        long minutes = Duration.between(entry, exit).toMinutes();
        long hours = Math.max(1, (minutes + 59) / 60);   // round up to whole hours, minimum 1
        return 40 + (hours - 1) * 20;
    }
}
// endregion:fee

// region:lot
class ParkingLot {
    private final List<ParkingSpot> spots;                      // sorted: smallest size, then lowest floor
    private final Map<String, Ticket> activeTickets = new HashMap<>();
    private final FeeStrategy feeStrategy;
    private int nextTicket = 1;

    ParkingLot(List<ParkingSpot> spots, FeeStrategy feeStrategy) {
        this.spots = new ArrayList<>(spots);
        this.spots.sort(Comparator.comparing(ParkingSpot::getSize).thenComparing(ParkingSpot::getFloor));
        this.feeStrategy = feeStrategy;
    }

    /** Called by an entry gate. Returns a ticket, or throws if no suitable spot is free. */
    synchronized Ticket parkVehicle(Vehicle vehicle, Instant now) {
        for (ParkingSpot spot : spots) {                // smallest suitable spot first
            if (spot.canFit(vehicle)) {
                spot.park(vehicle);
                Ticket ticket = new Ticket("T-" + nextTicket++, vehicle, spot, now);
                activeTickets.put(ticket.getId(), ticket);
                return ticket;
            }
        }
        throw new IllegalStateException("Parking full for " + vehicle.getSize() + " vehicles");
    }

    /** Called by an exit gate. Frees the spot and returns the fee to pay. */
    synchronized long unparkVehicle(String ticketId, Instant now) {
        Ticket ticket = activeTickets.remove(ticketId);
        if (ticket == null) throw new IllegalArgumentException("Unknown or already used ticket");
        ticket.getSpot().free();
        return feeStrategy.calculateFee(ticket.getEntryTime(), now);
    }

    synchronized long freeSpots(Size size) {
        return spots.stream().filter(s -> s.isFree() && s.getSize() == size).count();
    }
}
// endregion:lot

public class ParkingLotDemo {
    public static void main(String[] args) {
        List<ParkingSpot> spots = List.of(
                new ParkingSpot(1, 1, Size.SMALL),
                new ParkingSpot(1, 2, Size.MEDIUM),
                new ParkingSpot(2, 7, Size.MEDIUM),
                new ParkingSpot(2, 9, Size.LARGE));
        ParkingLot lot = new ParkingLot(spots, new HourlyFeeStrategy());
        Instant nine = Instant.parse("2026-10-27T09:00:00Z");

        Ticket car = lot.parkVehicle(new Car("KA-01-AB-1234"), nine);
        Ticket bike = lot.parkVehicle(new Motorcycle("KA-05-XY-9876"), nine);
        Ticket truck = lot.parkVehicle(new Truck("MH-12-TR-4455"), nine);
        System.out.println(car.getVehicle().getLicensePlate() + " -> " + car.getSpot().label());
        System.out.println(bike.getVehicle().getLicensePlate() + " -> " + bike.getSpot().label());
        System.out.println(truck.getVehicle().getLicensePlate() + " -> " + truck.getSpot().label());

        check(lot.unparkVehicle(car.getId(), nine.plus(Duration.ofMinutes(50))) == 40, "50 min = Rs 40");
        Ticket car2 = lot.parkVehicle(new Car("KA-03-MN-1111"), nine);
        check(lot.unparkVehicle(car2.getId(), nine.plus(Duration.ofMinutes(61))) == 60, "61 min = Rs 60");
        check(lot.unparkVehicle(bike.getId(), nine.plus(Duration.ofMinutes(155))) == 80, "2h35 = Rs 80");
        try { lot.unparkVehicle(bike.getId(), nine); check(false, "reused ticket"); }
        catch (IllegalArgumentException expected) { }
        lot.parkVehicle(new Car("A"), nine); lot.parkVehicle(new Car("B"), nine);
        try { lot.parkVehicle(new Car("C"), nine); check(false, "full"); }
        catch (IllegalStateException expected) { }
        System.out.println("All checks passed");
    }
    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}

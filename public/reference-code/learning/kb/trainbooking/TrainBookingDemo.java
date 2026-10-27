package kb.trainbooking;

import java.util.*;

// region:route
/** A train's stops in order. Segment i is the stretch from stop i to stop i+1. */
record Route(List<String> stops) {
    int index(String station) {
        int i = stops.indexOf(station);
        if (i < 0) throw new IllegalArgumentException("Train doesn't stop at " + station);
        return i;
    }
}

/** The journey Asha asked for, as a range of segments [from, to). */
record Journey(int from, int to) {
    Journey {
        if (from >= to) throw new IllegalArgumentException("Destination is before source");
    }
}
// endregion:route

// region:seat
class Seat {
    private final String number;
    private final String[] heldBy;                  // one slot per segment; null = free

    Seat(String number, int segments) {
        this.number = number;
        this.heldBy = new String[segments];
    }
    String number() { return number; }

    boolean isFree(Journey j) {
        for (int s = j.from(); s < j.to(); s++) if (heldBy[s] != null) return false;
        return true;
    }
    void hold(Journey j, String bookingId) {
        for (int s = j.from(); s < j.to(); s++) heldBy[s] = bookingId;
    }
    void release(String bookingId) {
        for (int s = 0; s < heldBy.length; s++) {
            if (bookingId.equals(heldBy[s])) heldBy[s] = null;
        }
    }
}
// endregion:seat

// region:booking
enum BookingStatus { CONFIRMED, WAITLISTED, CANCELLED }

class Booking {
    final String id;
    final List<String> passengers;
    final Journey journey;
    final List<Seat> seats = new ArrayList<>();
    BookingStatus status;

    Booking(String id, List<String> passengers, Journey journey) {
        this.id = id; this.passengers = List.copyOf(passengers); this.journey = journey;
    }
}
// endregion:booking

// region:train
class TrainRun {                                    // one train on one date
    private final Route route;
    private final List<Seat> seats = new ArrayList<>();
    private final Deque<Booking> waitlist = new ArrayDeque<>();
    private int nextId = 1;

    TrainRun(Route route, int seatCount) {
        this.route = route;
        int segments = route.stops().size() - 1;
        for (int i = 1; i <= seatCount; i++) seats.add(new Seat("S" + i, segments));
    }

    /** All passengers get seats for the whole journey, or the booking is waitlisted. */
    synchronized Booking book(List<String> passengers, String from, String to) {
        Journey j = new Journey(route.index(from), route.index(to));
        Booking b = new Booking("PNR" + (1000 + nextId++), passengers, j);
        if (!tryConfirm(b)) { b.status = BookingStatus.WAITLISTED; waitlist.addLast(b); }
        return b;
    }

    synchronized void cancel(Booking b) {
        if (b.status == BookingStatus.CANCELLED) return;
        if (b.status == BookingStatus.WAITLISTED) waitlist.remove(b);
        b.seats.forEach(s -> s.release(b.id));
        b.seats.clear();
        b.status = BookingStatus.CANCELLED;
        waitlist.removeIf(this::tryConfirm);        // promote anyone who now fits, in order
    }

    private boolean tryConfirm(Booking b) {
        List<Seat> free = seats.stream().filter(s -> s.isFree(b.journey))
                .limit(b.passengers.size()).toList();
        if (free.size() < b.passengers.size()) return false;
        free.forEach(s -> s.hold(b.journey, b.id));
        b.seats.addAll(free);
        b.status = BookingStatus.CONFIRMED;
        return true;
    }
}
// endregion:train

public class TrainBookingDemo {
    public static void main(String[] args) {
        Route route = new Route(List.of("Bengaluru", "Jolarpettai", "Katpadi", "Chennai"));
        TrainRun shatabdi = new TrainRun(route, 2);

        Booking asha = shatabdi.book(List.of("Asha"), "Bengaluru", "Jolarpettai");
        Booking bilal = shatabdi.book(List.of("Bilal"), "Jolarpettai", "Chennai");
        check(asha.seats.get(0) == bilal.seats.get(0), "same seat, different segments");

        Booking family = shatabdi.book(List.of("Chetan", "Ravi"), "Bengaluru", "Chennai");
        check(family.status == BookingStatus.WAITLISTED, "only one seat free for the whole way");

        Booking ravi = shatabdi.book(List.of("Ravi"), "Katpadi", "Chennai");
        check(ravi.status == BookingStatus.CONFIRMED && ravi.seats.get(0).number().equals("S2"),
                "S2 free from Katpadi");

        shatabdi.cancel(ravi);
        check(family.status == BookingStatus.WAITLISTED, "still needs S1 from Bengaluru");
        shatabdi.cancel(bilal);
        check(family.status == BookingStatus.WAITLISTED, "Asha still holds S1 to Jolarpettai");
        shatabdi.cancel(asha);
        check(family.status == BookingStatus.CONFIRMED && family.seats.size() == 2,
                "both seats free end to end: family confirmed together");
        System.out.println("All checks passed");
    }

    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}

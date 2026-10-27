package kb.moviebooking;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

// region:enums
enum SeatType { SILVER, GOLD, RECLINER }
enum SeatStatus { AVAILABLE, HELD, BOOKED }
enum BookingStatus { PENDING, CONFIRMED, EXPIRED, CANCELLED }
// endregion:enums

// region:catalog
record Movie(String title, int durationMinutes) {}
record Seat(String number, SeatType type) {}                 // furniture: A7 in Screen 2
record Screen(String name, List<Seat> seats) {}
// endregion:catalog

// region:showseat
class ShowSeat {
    private final Seat seat;
    private final long pricePaise;                           // ₹250 = 25,000 paise
    private SeatStatus status = SeatStatus.AVAILABLE;
    private String heldBy;                                   // booking that holds it
    private Instant holdExpiresAt;

    ShowSeat(Seat seat, long pricePaise) { this.seat = seat; this.pricePaise = pricePaise; }

    boolean isAvailable(Instant now) {
        if (status == SeatStatus.HELD && !now.isBefore(holdExpiresAt)) {
            release();                                       // an expired hold counts as free
        }
        return status == SeatStatus.AVAILABLE;
    }

    void hold(String bookingId, Instant until) {
        status = SeatStatus.HELD; heldBy = bookingId; holdExpiresAt = until;
    }
    boolean isHeldBy(String bookingId) {
        return status == SeatStatus.HELD && bookingId.equals(heldBy);
    }
    void book()    { status = SeatStatus.BOOKED; holdExpiresAt = null; }
    void release() { status = SeatStatus.AVAILABLE; heldBy = null; holdExpiresAt = null; }

    long getPricePaise()   { return pricePaise; }
    SeatStatus getStatus() { return status; }
}
// endregion:showseat

// region:show
class Show {
    private final Movie movie;
    private final Screen screen;
    private final Instant startTime;
    private final Map<String, ShowSeat> seats = new LinkedHashMap<>();

    Show(Movie movie, Screen screen, Instant startTime, Map<SeatType, Long> prices) {
        this.movie = movie; this.screen = screen; this.startTime = startTime;
        for (Seat seat : screen.seats()) {
            seats.put(seat.number(), new ShowSeat(seat, prices.get(seat.type())));
        }
    }
    ShowSeat getSeat(String number) {
        ShowSeat s = seats.get(number);
        if (s == null) throw new IllegalArgumentException("No seat " + number);
        return s;
    }
    Movie getMovie() { return movie; }
}
// endregion:show

// region:booking
class Booking {
    private final String id;
    private final String user;
    private final Show show;
    private final List<ShowSeat> seats;
    private final long amountPaise;
    private final Instant holdUntil;
    private BookingStatus status = BookingStatus.PENDING;

    Booking(String id, String user, Show show, List<ShowSeat> seats,
            long amountPaise, Instant holdUntil) {
        this.id = id; this.user = user; this.show = show;
        this.seats = List.copyOf(seats);
        this.amountPaise = amountPaise; this.holdUntil = holdUntil;
    }
    boolean isExpired(Instant now) { return !now.isBefore(holdUntil); }
    String getId()            { return id; }
    Show getShow()            { return show; }
    List<ShowSeat> getSeats() { return seats; }
    long getAmountPaise()     { return amountPaise; }
    BookingStatus getStatus() { return status; }
    void setStatus(BookingStatus s) { status = s; }
}
// endregion:booking

// region:payment
interface PaymentService {
    boolean charge(String bookingId, long amountPaise);   // true if the money was taken
    void refund(String bookingId, long amountPaise);
}
// endregion:payment

// region:service
class BookingService {
    private static final Duration HOLD_TIME = Duration.ofMinutes(5);
    private static final int MAX_SEATS = 8;
    private final Map<String, Booking> bookings = new HashMap<>();
    private final PaymentService payments;
    private int nextId = 1;

    BookingService(PaymentService payments) { this.payments = payments; }

    Booking holdSeats(String user, Show show, List<String> seatNumbers, Instant now) {
        if (seatNumbers.isEmpty() || seatNumbers.size() > MAX_SEATS) {
            throw new IllegalArgumentException("Choose 1 to " + MAX_SEATS + " seats");
        }
        synchronized (show) {                                   // one show at a time
            List<ShowSeat> chosen = new ArrayList<>();
            for (String number : seatNumbers) {                 // 1. check every seat
                ShowSeat seat = show.getSeat(number);
                if (!seat.isAvailable(now)) {
                    throw new IllegalStateException("Seat " + number + " is not available");
                }
                chosen.add(seat);
            }
            String id = "booking-" + nextId++;                  // 2. then hold all of them
            Instant until = now.plus(HOLD_TIME);
            chosen.forEach(seat -> seat.hold(id, until));
            long total = chosen.stream().mapToLong(ShowSeat::getPricePaise).sum();
            Booking booking = new Booking(id, user, show, chosen, total, until);
            bookings.put(id, booking);
            return booking;
        }
    }

    Booking confirm(String bookingId, Instant paidAt) {
        Booking booking = bookings.get(bookingId);
        // Payment can take seconds, so it runs without holding the show lock.
        boolean paid = payments.charge(bookingId, booking.getAmountPaise());
        synchronized (booking.getShow()) {
            boolean stillOurs = booking.getSeats().stream()
                                       .allMatch(s -> s.isHeldBy(bookingId));
            if (paid && stillOurs && !booking.isExpired(paidAt)) {
                booking.getSeats().forEach(ShowSeat::book);
                booking.setStatus(BookingStatus.CONFIRMED);
            } else {
                if (paid) payments.refund(bookingId, booking.getAmountPaise());
                booking.getSeats().stream().filter(s -> s.isHeldBy(bookingId))
                       .forEach(ShowSeat::release);
                booking.setStatus(BookingStatus.EXPIRED);
            }
            return booking;
        }
    }
}
// endregion:service

public class MovieBookingDemo {
    public static void main(String[] args) {
        List<Seat> layout = List.of(new Seat("A7", SeatType.GOLD), new Seat("A8", SeatType.GOLD),
                                    new Seat("F1", SeatType.SILVER));
        Screen screen2 = new Screen("Screen 2", layout);
        Show show = new Show(new Movie("The Long Night", 150), screen2, Instant.parse("2026-11-01T13:30:00Z"),
                Map.of(SeatType.SILVER, 18_000L, SeatType.GOLD, 25_000L, SeatType.RECLINER, 45_000L));
        List<String> refunds = new ArrayList<>();
        BookingService service = new BookingService(new PaymentService() {
            public boolean charge(String id, long paise) { return true; }
            public void refund(String id, long paise) { refunds.add(id); }
        });
        Instant t = Instant.parse("2026-11-01T10:00:00Z");

        Booking asha = service.holdSeats("Asha", show, List.of("A7", "A8"), t);
        check(asha.getAmountPaise() == 50_000, "two gold seats = Rs 500");
        try { service.holdSeats("Bilal", show, List.of("A8", "F1"), t); check(false, "A8 taken"); }
        catch (IllegalStateException expected) { }
        check(show.getSeat("F1").getStatus() == SeatStatus.AVAILABLE, "nothing half-held");
        check(service.confirm(asha.getId(), t.plusSeconds(60)).getStatus() == BookingStatus.CONFIRMED, "confirmed");
        check(show.getSeat("A7").getStatus() == SeatStatus.BOOKED, "A7 booked");

        Booking late = service.holdSeats("Chetan", show, List.of("F1"), t);
        Booking bilal = service.holdSeats("Bilal", show, List.of("F1"), t.plus(Duration.ofMinutes(6)));
        check(service.confirm(late.getId(), t.plus(Duration.ofMinutes(7))).getStatus() == BookingStatus.EXPIRED, "late pay expired");
        check(refunds.contains(late.getId()), "late payment refunded");
        check(service.confirm(bilal.getId(), t.plus(Duration.ofMinutes(7))).getStatus() == BookingStatus.CONFIRMED, "Bilal keeps F1");
        System.out.println("All checks passed");
    }
    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}

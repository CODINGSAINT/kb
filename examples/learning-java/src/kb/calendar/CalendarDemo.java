package kb.calendar;

import java.time.*;
import java.util.*;

// region:event
/** A time range [start, end). Stored as Instants so time zones can't confuse comparisons. */
record Slot(Instant start, Instant end) {
    Slot {
        if (!start.isBefore(end)) throw new IllegalArgumentException("End before start");
    }
    boolean overlaps(Slot o) { return start.isBefore(o.end) && o.start.isBefore(end); }
}

record Event(String id, String title, String organizer, Set<String> attendees,
             Slot slot, String room) {}
// endregion:event

// region:recurring
/** "Every Monday 10:00–10:30 in Asia/Kolkata", expanded into concrete slots. */
record WeeklyRule(DayOfWeek day, LocalTime start, Duration length, ZoneId zone) {
    List<Slot> occurrences(LocalDate from, int count) {
        List<Slot> out = new ArrayList<>();
        LocalDate d = from;
        while (d.getDayOfWeek() != day) d = d.plusDays(1);
        for (int i = 0; i < count; i++, d = d.plusWeeks(1)) {
            Instant s = ZonedDateTime.of(d, start, zone).toInstant();  // local → instant
            out.add(new Slot(s, s.plus(length)));
        }
        return out;
    }
}
// endregion:recurring

// region:service
class CalendarService {
    private final Map<String, List<Event>> byPerson = new HashMap<>();
    private final Map<String, List<Event>> byRoom = new HashMap<>();
    private int nextId = 1;

    /** Rooms can't be double-booked; people get a warning-free invite (they decide). */
    synchronized Event schedule(String title, String organizer, Set<String> attendees,
                                Slot slot, String room) {
        if (room != null && byRoom.getOrDefault(room, List.of()).stream()
                .anyMatch(e -> e.slot().overlaps(slot)))
            throw new IllegalStateException(room + " is already booked then");
        Event e = new Event("EV-" + nextId++, title, organizer, Set.copyOf(attendees),
                slot, room);
        Set<String> everyone = new HashSet<>(attendees);
        everyone.add(organizer);
        everyone.forEach(p -> byPerson.computeIfAbsent(p, k -> new ArrayList<>()).add(e));
        if (room != null) byRoom.computeIfAbsent(room, k -> new ArrayList<>()).add(e);
        return e;
    }

    List<Event> conflictsFor(String person, Slot slot) {
        return byPerson.getOrDefault(person, List.of()).stream()
                .filter(e -> e.slot().overlaps(slot)).toList();
    }

    /** Earliest gap of `length` inside `window` when everyone is free. */
    Optional<Slot> firstCommonFree(Set<String> people, Slot window, Duration length) {
        List<Slot> busy = people.stream()
                .flatMap(p -> byPerson.getOrDefault(p, List.of()).stream())
                .map(Event::slot)
                .filter(s -> s.overlaps(window))
                .sorted(Comparator.comparing(Slot::start))
                .toList();
        Instant cursor = window.start();
        for (Slot b : busy) {
            if (!cursor.plus(length).isAfter(b.start()))            // gap before this meeting
                return Optional.of(new Slot(cursor, cursor.plus(length)));
            if (b.end().isAfter(cursor)) cursor = b.end();          // skip past this meeting
        }
        Instant end = cursor.plus(length);
        if (end.isAfter(window.end())) return Optional.empty();
        return Optional.of(new Slot(cursor, end));
    }
}
// endregion:service

public class CalendarDemo {
    public static void main(String[] args) {
        ZoneId ist = ZoneId.of("Asia/Kolkata");
        LocalDate oct28 = LocalDate.of(2026, 10, 28);
        java.util.function.BiFunction<String, String, Slot> at = (a, b) -> new Slot(
                ZonedDateTime.of(oct28, LocalTime.parse(a), ist).toInstant(),
                ZonedDateTime.of(oct28, LocalTime.parse(b), ist).toInstant());

        CalendarService cal = new CalendarService();
        cal.schedule("Design review", "Asha", Set.of("Bilal"), at.apply("10:00", "11:00"), "Kaveri");
        cal.schedule("1:1", "Bilal", Set.of("Chetan"), at.apply("11:30", "12:00"), null);

        try {
            cal.schedule("Standup", "Chetan", Set.of(), at.apply("10:30", "10:45"), "Kaveri");
            check(false, "room taken");
        } catch (IllegalStateException expected) { }

        check(cal.conflictsFor("Bilal", at.apply("10:30", "11:45")).size() == 2, "two overlaps");
        check(cal.conflictsFor("Bilal", at.apply("11:00", "11:30")).isEmpty(), "back-to-back ok");

        Optional<Slot> free = cal.firstCommonFree(Set.of("Asha", "Bilal", "Chetan"),
                at.apply("09:30", "18:00"), Duration.ofMinutes(45));
        check(free.orElseThrow().equals(at.apply("12:00", "12:45")), "first 45-min gap at 12:00");
        Optional<Slot> short30 = cal.firstCommonFree(Set.of("Asha", "Bilal", "Chetan"),
                at.apply("09:30", "18:00"), Duration.ofMinutes(30));
        check(short30.orElseThrow().equals(at.apply("09:30", "10:00")), "30 min fits at 09:30");

        WeeklyRule standup = new WeeklyRule(DayOfWeek.MONDAY, LocalTime.of(9, 0),
                Duration.ofMinutes(15), ZoneId.of("America/New_York"));
        List<Slot> weeks = standup.occurrences(LocalDate.of(2026, 10, 26), 2);
        ZonedDateTime first = weeks.get(0).start().atZone(ist);
        ZonedDateTime second = weeks.get(1).start().atZone(ist);
        check(first.toLocalTime().equals(LocalTime.of(18, 30)), "9:00 New York = 18:30 IST (EDT)");
        check(second.toLocalTime().equals(LocalTime.of(19, 30)), "after US clocks change: 19:30");
        System.out.println("All checks passed");
    }

    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}

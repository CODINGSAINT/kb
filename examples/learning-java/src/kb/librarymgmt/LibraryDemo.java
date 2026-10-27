package kb.librarymgmt;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;

// region:plan
/** Borrowing rules. A new plan is new data, not a new class. */
record MembershipPlan(String name, int maxBooks, int loanDays,
                      int maxRenewals, long finePerDay) {
    static final MembershipPlan BASIC   = new MembershipPlan("Basic", 3, 14, 1, 10);
    static final MembershipPlan PREMIUM = new MembershipPlan("Premium", 5, 21, 2, 5);
}

record Member(String name, MembershipPlan plan) {}
// endregion:plan

// region:book
enum ItemStatus { AVAILABLE, ON_LOAN, ON_HOLD_SHELF }

/** One physical copy with its own barcode. */
class BookItem {
    private final String barcode;
    private final Book book;
    private ItemStatus status = ItemStatus.AVAILABLE;

    BookItem(String barcode, Book book) { this.barcode = barcode; this.book = book; }
    String getBarcode()            { return barcode; }
    Book getBook()                 { return book; }
    ItemStatus getStatus()         { return status; }
    void setStatus(ItemStatus s)   { status = s; }
}

/** A title in the catalogue. Holds are per title, because any copy will do. */
class Book {
    private final String isbn, title, author;
    private final Deque<Hold> holds = new ArrayDeque<>();

    Book(String isbn, String title, String author) {
        this.isbn = isbn; this.title = title; this.author = author;
    }
    String getTitle()     { return title; }
    String getAuthor()    { return author; }
    Deque<Hold> holds()   { return holds; }
}
// endregion:book

// region:loan
class Loan {
    private final BookItem item;
    private final Member member;
    private LocalDate dueDate;
    private int renewals;

    Loan(BookItem item, Member member, LocalDate today) {
        this.item = item; this.member = member;
        this.dueDate = today.plusDays(member.plan().loanDays());
    }
    void extend() {
        dueDate = dueDate.plusDays(member.plan().loanDays());
        renewals++;
    }
    BookItem getItem()      { return item; }
    Member getMember()      { return member; }
    LocalDate getDueDate()  { return dueDate; }
    int getRenewals()       { return renewals; }
}

class Hold {
    private final Member member;
    private LocalDate pickupBy;           // set when a copy is waiting on the shelf

    Hold(Member member) { this.member = member; }
    Member getMember()               { return member; }
    LocalDate getPickupBy()          { return pickupBy; }
    void readyUntil(LocalDate date)  { pickupBy = date; }
}
// endregion:loan

// region:service
class LibraryService {
    private final Map<String, BookItem> items = new HashMap<>();
    private final Map<String, Loan> activeLoans = new HashMap<>();   // barcode -> loan
    private final Map<BookItem, Hold> heldFor = new HashMap<>();     // copies on hold shelf

    void addCopy(BookItem item) { items.put(item.getBarcode(), item); }

    synchronized Loan checkout(Member member, String barcode, LocalDate today) {
        BookItem item = items.get(barcode);
        long borrowed = activeLoans.values().stream()
                .filter(l -> l.getMember() == member).count();
        if (borrowed >= member.plan().maxBooks()) {
            throw new IllegalStateException(member.name() + " has reached the limit");
        }
        Hold hold = heldFor.get(item);
        boolean waitingForThisMember = hold != null && hold.getMember() == member;
        if (item.getStatus() != ItemStatus.AVAILABLE && !waitingForThisMember) {
            throw new IllegalStateException("Copy " + barcode + " is not available");
        }
        if (waitingForThisMember) heldFor.remove(item);
        Loan loan = new Loan(item, member, today);
        item.setStatus(ItemStatus.ON_LOAN);
        activeLoans.put(barcode, loan);
        return loan;
    }

    /** Returns the fine in rupees. */
    synchronized long returnBook(String barcode, LocalDate today) {
        Loan loan = activeLoans.remove(barcode);
        if (loan == null) throw new IllegalStateException("Copy is not on loan");
        long daysLate = Math.max(0, ChronoUnit.DAYS.between(loan.getDueDate(), today));
        giveToNextInQueue(loan.getItem(), today);
        return daysLate * loan.getMember().plan().finePerDay();
    }

    synchronized Hold placeHold(Member member, Book book) {
        Hold hold = new Hold(member);
        book.holds().addLast(hold);
        return hold;
    }

    synchronized Loan renew(String barcode, LocalDate today) {
        Loan loan = activeLoans.get(barcode);
        if (today.isAfter(loan.getDueDate())) throw new IllegalStateException("Overdue");
        if (loan.getRenewals() >= loan.getMember().plan().maxRenewals()) {
            throw new IllegalStateException("No renewals left");
        }
        if (!loan.getItem().getBook().holds().isEmpty()) {
            throw new IllegalStateException("Someone is waiting for this book");
        }
        loan.extend();
        return loan;
    }

    /** Daily job: a copy nobody collected goes to the next person in the queue. */
    synchronized void expireHolds(LocalDate today) {
        for (Map.Entry<BookItem, Hold> e : new ArrayList<>(heldFor.entrySet())) {
            if (today.isAfter(e.getValue().getPickupBy())) {
                heldFor.remove(e.getKey());
                giveToNextInQueue(e.getKey(), today);
            }
        }
    }

    private void giveToNextInQueue(BookItem item, LocalDate today) {
        Hold next = item.getBook().holds().pollFirst();       // first come, first served
        if (next == null) {
            item.setStatus(ItemStatus.AVAILABLE);
            return;
        }
        next.readyUntil(today.plusDays(2));                    // 2 days to collect
        heldFor.put(item, next);
        item.setStatus(ItemStatus.ON_HOLD_SHELF);
    }
}
// endregion:service

public class LibraryDemo {
    public static void main(String[] args) {
        Book book = new Book("978-1-4842-0", "Practical Java", "R. Sharma");
        BookItem copy = new BookItem("BK-0001", book);
        LibraryService library = new LibraryService();
        library.addCopy(copy);
        Member asha = new Member("Asha", MembershipPlan.BASIC);
        Member bilal = new Member("Bilal", MembershipPlan.BASIC);
        Member chetan = new Member("Chetan", MembershipPlan.PREMIUM);
        LocalDate oct1 = LocalDate.of(2026, 10, 1);

        Loan loan = library.checkout(asha, "BK-0001", oct1);
        check(loan.getDueDate().equals(LocalDate.of(2026, 10, 15)), "due 15 Oct");
        library.placeHold(bilal, book); library.placeHold(chetan, book);
        try { library.renew("BK-0001", oct1.plusDays(5)); check(false, "someone waiting"); }
        catch (IllegalStateException expected) { }
        check(library.returnBook("BK-0001", LocalDate.of(2026, 10, 18)) == 30, "3 days x Rs 10");
        check(copy.getStatus() == ItemStatus.ON_HOLD_SHELF, "waiting for Bilal");
        try { library.checkout(chetan, "BK-0001", LocalDate.of(2026, 10, 19)); check(false, "Bilal first"); }
        catch (IllegalStateException expected) { }
        library.expireHolds(LocalDate.of(2026, 10, 21));
        Loan c = library.checkout(chetan, "BK-0001", LocalDate.of(2026, 10, 22));
        check(c.getDueDate().equals(LocalDate.of(2026, 11, 12)), "Premium: 21 days");
        System.out.println("All checks passed");
    }
    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}

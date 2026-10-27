package kb.fooddelivery;

import java.util.*;

// region:menu
record MenuItem(String name, long pricePaise, boolean veg) {}

class Restaurant {
    private final String name;
    private final Map<String, MenuItem> menu = new LinkedHashMap<>();
    private boolean open = true;

    Restaurant(String name, List<MenuItem> items) {
        this.name = name;
        items.forEach(i -> menu.put(i.name(), i));
    }
    String getName()               { return name; }
    boolean isOpen()               { return open; }
    void setOpen(boolean open)     { this.open = open; }
    MenuItem item(String itemName) {
        MenuItem i = menu.get(itemName);
        if (i == null) throw new IllegalArgumentException("Not on the menu: " + itemName);
        return i;
    }
}
// endregion:menu

// region:status
enum OrderStatus {
    PLACED, ACCEPTED, PREPARING, READY, PICKED_UP, DELIVERED, CANCELLED;

    private static final Map<OrderStatus, Set<OrderStatus>> NEXT = Map.of(
            PLACED,    EnumSet.of(ACCEPTED, CANCELLED),
            ACCEPTED,  EnumSet.of(PREPARING, CANCELLED),
            PREPARING, EnumSet.of(READY),
            READY,     EnumSet.of(PICKED_UP),
            PICKED_UP, EnumSet.of(DELIVERED),
            DELIVERED, EnumSet.noneOf(OrderStatus.class),
            CANCELLED, EnumSet.noneOf(OrderStatus.class));

    boolean canMoveTo(OrderStatus next) { return NEXT.get(this).contains(next); }
}
// endregion:status

// region:order
record OrderLine(MenuItem item, int qty) {
    long totalPaise() { return item.pricePaise() * qty; }
}

class Order {
    private final String id;
    private final String customer;
    private final Restaurant restaurant;
    private final List<OrderLine> lines;
    private final long deliveryFeePaise;
    private OrderStatus status = OrderStatus.PLACED;
    private DeliveryPartner partner;

    Order(String id, String customer, Restaurant r, List<OrderLine> lines, long feePaise) {
        this.id = id; this.customer = customer; this.restaurant = r;
        this.lines = List.copyOf(lines); this.deliveryFeePaise = feePaise;
    }

    long itemTotalPaise() { return lines.stream().mapToLong(OrderLine::totalPaise).sum(); }
    long totalPaise()     { return itemTotalPaise() + deliveryFeePaise; }

    void moveTo(OrderStatus next) {
        if (!status.canMoveTo(next))
            throw new IllegalStateException(status + " -> " + next + " is not allowed");
        status = next;
    }

    String getId()                   { return id; }
    String getCustomer()             { return customer; }
    Restaurant getRestaurant()       { return restaurant; }
    OrderStatus getStatus()          { return status; }
    DeliveryPartner getPartner()     { return partner; }
    void setPartner(DeliveryPartner p) { partner = p; }
}
// endregion:order

// region:partner
class DeliveryPartner {
    private final String name;
    private final double kmFromRestaurant;
    private Order current;                                  // at most one active order

    DeliveryPartner(String name, double km) { this.name = name; this.kmFromRestaurant = km; }
    String getName()      { return name; }
    double distanceKm()   { return kmFromRestaurant; }
    boolean isFree()      { return current == null; }

    /** Check-and-take in one step, so two orders can never get the same partner. */
    synchronized boolean tryAssign(Order order) {
        if (current != null) return false;
        current = order;
        return true;
    }
    synchronized void finish() { current = null; }
}

interface AssignmentStrategy {
    Optional<DeliveryPartner> pick(Order order, List<DeliveryPartner> partners);
}

class NearestFreePartner implements AssignmentStrategy {
    public Optional<DeliveryPartner> pick(Order order, List<DeliveryPartner> partners) {
        return partners.stream()
                .filter(DeliveryPartner::isFree)
                .sorted(Comparator.comparingDouble(DeliveryPartner::distanceKm))
                .filter(p -> p.tryAssign(order))            // first one we actually win
                .findFirst();
    }
}
// endregion:partner

// region:service
class FoodDeliveryService {
    private final List<DeliveryPartner> partners;
    private final AssignmentStrategy strategy;
    private final Map<String, Order> orders = new HashMap<>();
    private int nextId = 1;

    FoodDeliveryService(List<DeliveryPartner> partners, AssignmentStrategy strategy) {
        this.partners = partners; this.strategy = strategy;
    }

    Order placeOrder(String customer, Restaurant r, Map<String, Integer> cart) {
        if (!r.isOpen()) throw new IllegalStateException(r.getName() + " is closed");
        List<OrderLine> lines = cart.entrySet().stream()
                .map(e -> new OrderLine(r.item(e.getKey()), e.getValue())).toList();
        long itemTotal = lines.stream().mapToLong(OrderLine::totalPaise).sum();
        long fee = itemTotal >= 49_900 ? 0 : 3_000;         // free delivery from Rs 499
        Order o = new Order("ORD-" + nextId++, customer, r, lines, fee);
        orders.put(o.getId(), o);
        return o;
    }

    void restaurantAccepts(Order o) {
        o.moveTo(OrderStatus.ACCEPTED);
        DeliveryPartner p = strategy.pick(o, partners)
                .orElseThrow(() -> new IllegalStateException("No partner free; retry soon"));
        o.setPartner(p);
    }

    void startPreparing(Order o) { o.moveTo(OrderStatus.PREPARING); }
    void foodReady(Order o)      { o.moveTo(OrderStatus.READY); }
    void pickedUp(Order o)       { o.moveTo(OrderStatus.PICKED_UP); }

    void delivered(Order o) {
        o.moveTo(OrderStatus.DELIVERED);
        o.getPartner().finish();
    }

    /** Customer cancel: full refund before cooking starts, otherwise refused. */
    long cancel(Order o) {
        o.moveTo(OrderStatus.CANCELLED);                    // throws once PREPARING
        if (o.getPartner() != null) o.getPartner().finish();
        return o.totalPaise();                              // refund amount
    }
}
// endregion:service

public class FoodDeliveryDemo {
    public static void main(String[] args) {
        Restaurant meghana = new Restaurant("Meghana Foods", List.of(
                new MenuItem("Chicken Biryani", 32_000, false),
                new MenuItem("Paneer Biryani", 28_000, true)));
        DeliveryPartner ravi = new DeliveryPartner("Ravi", 0.8);
        DeliveryPartner chetan = new DeliveryPartner("Chetan", 2.5);
        var app = new FoodDeliveryService(List.of(chetan, ravi), new NearestFreePartner());

        Order asha = app.placeOrder("Asha", meghana, Map.of("Chicken Biryani", 1, "Paneer Biryani", 1));
        check(asha.itemTotalPaise() == 60_000, "Rs 320 + Rs 280");
        check(asha.totalPaise() == 60_000, "free delivery from Rs 499");

        app.restaurantAccepts(asha);
        check(asha.getPartner() == ravi, "nearest free partner");
        check(!ravi.isFree(), "Ravi is busy now");

        Order bilal = app.placeOrder("Bilal", meghana, Map.of("Paneer Biryani", 1));
        check(bilal.totalPaise() == 31_000, "Rs 280 + Rs 30 delivery");
        app.restaurantAccepts(bilal);
        check(bilal.getPartner() == chetan, "Ravi taken, so Chetan");

        try { app.pickedUp(asha); check(false, "cannot skip cooking"); }
        catch (IllegalStateException expected) { }

        app.startPreparing(asha);
        try { app.cancel(asha); check(false, "too late to cancel"); }
        catch (IllegalStateException expected) { }
        app.foodReady(asha); app.pickedUp(asha); app.delivered(asha);
        check(asha.getStatus() == OrderStatus.DELIVERED && ravi.isFree(), "delivered, Ravi free");

        check(app.cancel(bilal) == 31_000 && chetan.isFree(), "full refund before cooking");

        meghana.setOpen(false);
        try { app.placeOrder("Asha", meghana, Map.of("Paneer Biryani", 1)); check(false, "closed"); }
        catch (IllegalStateException expected) { }
        System.out.println("All checks passed");
    }

    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}

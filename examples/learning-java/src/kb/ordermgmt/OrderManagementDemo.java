package kb.ordermgmt;

import java.util.*;
import java.util.stream.Collectors;

// region:line
/** One product in an order. Its units are split across pending, shipped and cancelled. */
class OrderLine {
    final String sku, seller;
    final int ordered;
    final long unitPricePaise;
    private int shipped, cancelled, returned;

    OrderLine(String sku, String seller, int qty, long unitPricePaise) {
        this.sku = sku; this.seller = seller; this.ordered = qty;
        this.unitPricePaise = unitPricePaise;
    }
    int pending()   { return ordered - shipped - cancelled; }   // always >= 0
    int shipped()   { return shipped; }
    int cancelled() { return cancelled; }

    void ship(int n) {
        if (n > pending()) throw new IllegalStateException("Only " + pending() + " to ship");
        shipped += n;
    }
    long cancel(int n) {
        if (n > pending()) throw new IllegalStateException("Only " + pending() + " left");
        cancelled += n;
        return n * unitPricePaise;                                // refund
    }
    long returnUnits(int n) {
        if (n > shipped - returned) throw new IllegalStateException("Nothing to return");
        returned += n;
        return n * unitPricePaise;
    }
}
// endregion:line

// region:shipment
enum ShipmentStatus { CREATED, DISPATCHED, DELIVERED }

/** What one seller sends in one parcel. */
class Shipment {
    final String id, seller;
    final Map<OrderLine, Integer> units = new LinkedHashMap<>();
    ShipmentStatus status = ShipmentStatus.CREATED;

    Shipment(String id, String seller) { this.id = id; this.seller = seller; }
}
// endregion:shipment

// region:order
enum OrderStatus { PLACED, PARTLY_SHIPPED, SHIPPED, DELIVERED, CANCELLED }

class Order {
    final String id, customer;
    final List<OrderLine> lines;
    final List<Shipment> shipments = new ArrayList<>();
    private long refundedPaise;

    Order(String id, String customer, List<OrderLine> lines) {
        this.id = id; this.customer = customer; this.lines = List.copyOf(lines);
    }

    /** One shipment per seller for everything not yet shipped or cancelled. */
    List<Shipment> planShipments() {
        Map<String, List<OrderLine>> bySeller = lines.stream().filter(l -> l.pending() > 0)
                .collect(Collectors.groupingBy(l -> l.seller, LinkedHashMap::new,
                        Collectors.toList()));
        List<Shipment> created = new ArrayList<>();
        bySeller.forEach((seller, ls) -> {
            Shipment s = new Shipment(id + "-S" + (shipments.size() + 1), seller);
            ls.forEach(l -> { s.units.put(l, l.pending()); l.ship(l.pending()); });
            shipments.add(s);
            created.add(s);
        });
        return created;
    }

    long cancel(String sku, int qty) {
        long refund = line(sku).cancel(qty);
        refundedPaise += refund;
        return refund;
    }

    /** The status is derived from the lines and shipments, never set by hand. */
    OrderStatus status() {
        int pending = lines.stream().mapToInt(OrderLine::pending).sum();
        int shipped = lines.stream().mapToInt(OrderLine::shipped).sum();
        if (shipped == 0) return pending == 0 ? OrderStatus.CANCELLED : OrderStatus.PLACED;
        if (pending > 0) return OrderStatus.PARTLY_SHIPPED;
        boolean allDelivered = shipments.stream()
                .allMatch(s -> s.status == ShipmentStatus.DELIVERED);
        return allDelivered ? OrderStatus.DELIVERED : OrderStatus.SHIPPED;
    }

    OrderLine line(String sku) {
        return lines.stream().filter(l -> l.sku.equals(sku)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("No line " + sku));
    }
    long refunded() { return refundedPaise; }
}
// endregion:order

public class OrderManagementDemo {
    public static void main(String[] args) {
        Order order = new Order("ORD-7781", "Asha", List.of(
                new OrderLine("HEADPHONES", "SoundHub", 1, 249_900),
                new OrderLine("USB-C-CABLE", "SoundHub", 3, 39_900),
                new OrderLine("NOTEBOOK", "PaperCo", 4, 12_000)));
        check(order.status() == OrderStatus.PLACED, "placed");

        check(order.cancel("USB-C-CABLE", 1) == 39_900, "cancel 1 of 3 cables before shipping");
        check(order.line("USB-C-CABLE").pending() == 2, "2 cables left to ship");

        List<Shipment> parcels = order.planShipments();
        check(parcels.size() == 2, "one parcel per seller");
        check(parcels.get(0).units.values().stream().mapToInt(i -> i).sum() == 3,
                "SoundHub: headphones + 2 cables");
        check(order.status() == OrderStatus.SHIPPED, "everything left is shipped");

        try { order.cancel("NOTEBOOK", 1); check(false, "already shipped"); }
        catch (IllegalStateException expected) { }
        check(order.line("NOTEBOOK").returnUnits(1) == 12_000, "return instead of cancel");

        parcels.get(0).status = ShipmentStatus.DELIVERED;
        check(order.status() == OrderStatus.SHIPPED, "PaperCo still on the way");
        parcels.get(1).status = ShipmentStatus.DELIVERED;
        check(order.status() == OrderStatus.DELIVERED, "both parcels delivered");

        Order bilal = new Order("ORD-7782", "Bilal",
                List.of(new OrderLine("NOTEBOOK", "PaperCo", 2, 12_000)));
        bilal.cancel("NOTEBOOK", 2);
        check(bilal.status() == OrderStatus.CANCELLED && bilal.refunded() == 24_000, "all gone");
        System.out.println("All checks passed");
    }

    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}

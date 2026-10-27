package kb.food;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** One modular order authority; payment calls use an explicit external boundary. */
public final class Food {
    private Food() {}

    // BEGIN values
    public enum State { OPEN, CANCELLED, REJECTED, PAYMENT_FAILED, DELIVERED }
    public enum Kitchen { WAITING, ACCEPTED, PREPARING, READY, REJECTED, CANCELLED }
    public enum Money {
        NEW, NOT_CHARGED, CAPTURE_PENDING, CAPTURE_UNKNOWN, PAID, DECLINED,
        REFUND_NEEDED, REFUND_PENDING, REFUND_UNKNOWN, REFUNDED, REFUND_FAILED
    }
    public enum DeliveryState { ASSIGNED, PICKED_UP, DELIVERED, RELEASED }
    public enum Decision { APPLIED, REPLAYED, STALE_VERSION, IGNORED_CLOSED, DENIED_STAGE, NOT_CURRENT }
    public enum ChargeOutcome { PAID, DECLINED, UNKNOWN }
    public enum RefundOutcome { REFUNDED, FAILED, UNKNOWN }
    public record MenuItem(String id, String restaurantId, String name, long unitPaise, boolean available) {
        public MenuItem { key(id); key(restaurantId); key(name); if (unitPaise < 0) throw new IllegalArgumentException("Negative price"); }
    }
    public record Selection(String itemId, int quantity) {
        public Selection { key(itemId); if (quantity < 1 || quantity > 10) throw new IllegalArgumentException("Quantity must be 1..10"); }
    }
    public record Line(String itemId, String name, int quantity, long unitPaise) {}
    public record Quote(String id, String customerId, String restaurantId, String address,
                        List<Line> lines, long subtotalPaise, long deliveryPaise,
                        long discountPaise, long totalPaise, Instant validUntil) {
        public Quote { lines = List.copyOf(lines); }
    }
    public record ChargeCommand(String id, long amountPaise) {}
    public record ChargeReport(String id, long amountPaise, ChargeOutcome outcome, String reference) {}
    public record RefundCommand(String id, String chargeReference, long amountPaise) {}
    public record RefundReport(String id, String chargeReference, long amountPaise,
                               RefundOutcome outcome, String reference) {}
    public interface Payments {
        ChargeReport capture(ChargeCommand command);
        ChargeReport lookupCharge(ChargeCommand command);
        RefundReport refund(RefundCommand command);
        RefundReport lookupRefund(RefundCommand command);
    }
    public record OrderView(String id, Quote quote, State state, Kitchen kitchen, Money money,
                            int version, String deliveryId, String chargeReference,
                            String refundReference, String paymentReason) {}
    public record DeliveryView(String id, String orderId, String courierId, DeliveryState state, String proofId) {}
    public record CourierView(String id, String activeDeliveryId) {}
    public record Result(Decision decision, OrderView order) {}
    public record DeliveryResult(Decision decision, DeliveryView delivery, OrderView order) {}
    public record Event(String orderId, int version, String description) {}
    // END values

    private static final class Restaurant {
        boolean open = true;
        final Map<String, MenuItem> menu = new LinkedHashMap<>();
    }
    private static final class Order {
        final String id;
        final Quote quote;
        State state = State.OPEN;
        Kitchen kitchen = Kitchen.WAITING;
        Money money = Money.NEW;
        int version;
        String deliveryId, chargeReference, refundReference, decisionId, prepToken;
        Boolean accepted;
        String paymentReason = "capture not requested";
        boolean paymentBusy;
        Order(String id, Quote quote) { this.id = id; this.quote = quote; }
        OrderView view() { return new OrderView(id, quote, state, kitchen, money, version, deliveryId, chargeReference, refundReference, paymentReason); }
    }
    private static final class Delivery {
        final String id, orderId, courierId;
        DeliveryState state = DeliveryState.ASSIGNED;
        String proofId;
        Delivery(String id, String orderId, String courierId) { this.id = id; this.orderId = orderId; this.courierId = courierId; }
        DeliveryView view() { return new DeliveryView(id, orderId, courierId, state, proofId); }
    }
    private record CheckoutKey(String customerId, String requestId) {}
    private record SavedCheckout(String quoteId, String orderId) {}
    private enum WorkKind { CAPTURE, LOOKUP_CHARGE, REFUND, LOOKUP_REFUND }
    private record Work(String orderId, WorkKind kind, ChargeCommand charge, RefundCommand refund) {}

    public static final class Service {
        private final Clock clock;
        private final Payments payments;
        private final Map<String, Restaurant> restaurants = new LinkedHashMap<>();
        private final Map<String, Quote> quotes = new HashMap<>();
        private final Map<String, Order> orders = new LinkedHashMap<>();
        private final Map<CheckoutKey, SavedCheckout> checkouts = new HashMap<>();
        private final Map<String, Delivery> deliveries = new LinkedHashMap<>();
        private final Set<String> couriers = new LinkedHashSet<>();
        private final Map<String, String> courierActive = new HashMap<>();
        private final List<Event> events = new ArrayList<>();
        private int quoteSequence, orderSequence;

        public Service(Clock clock, Payments payments) { this.clock = Objects.requireNonNull(clock); this.payments = Objects.requireNonNull(payments); }
        public synchronized Instant now() { return clock.instant(); }
        public synchronized void addRestaurant(String id) {
            key(id); if (restaurants.putIfAbsent(id, new Restaurant()) != null) throw new IllegalArgumentException("Duplicate restaurant");
        }
        public synchronized void open(String id, boolean open) { restaurant(id).open = open; }
        public synchronized void menu(MenuItem item) { restaurant(item.restaurantId()).menu.put(item.id(), item); }
        public synchronized List<MenuItem> menu(String restaurantId) { return List.copyOf(restaurant(restaurantId).menu.values()); }
        public synchronized void addCourier(String id) { key(id); if (!couriers.add(id)) throw new IllegalArgumentException("Duplicate courier"); }
        public synchronized OrderView orderView(String id) { return order(id).view(); }
        public synchronized DeliveryView deliveryView(String id) { return delivery(id).view(); }
        public synchronized List<OrderView> orders() { return orders.values().stream().map(Order::view).toList(); }
        public synchronized List<DeliveryView> deliveries() { return deliveries.values().stream().map(Delivery::view).toList(); }
        public synchronized List<CourierView> couriers() { return couriers.stream().map(id -> new CourierView(id, courierActive.get(id))).toList(); }
        public synchronized List<Event> events() { return List.copyOf(events); }

        // BEGIN checkout
        public synchronized Quote quote(String customerId, String restaurantId, List<Selection> basket, String address) {
            key(customerId); key(address); Objects.requireNonNull(basket);
            Restaurant restaurant = restaurant(restaurantId);
            if (!restaurant.open || basket.isEmpty() || basket.size() > 20) throw new IllegalStateException("Restaurant closed or invalid basket size");
            List<Line> lines = new ArrayList<>(); Set<String> seen = new HashSet<>(); long subtotal = 0;
            for (Selection selected : basket) {
                MenuItem item = restaurant.menu.get(selected.itemId());
                if (item == null || !item.available() || !seen.add(item.id())) throw new IllegalArgumentException("Unavailable, duplicate or cross-restaurant item");
                lines.add(new Line(item.id(), item.name(), selected.quantity(), item.unitPaise()));
                subtotal = Math.addExact(subtotal, Math.multiplyExact(item.unitPaise(), selected.quantity()));
            }
            long delivery = 5_000, discount = Math.min(4_000, subtotal);
            Quote quote = new Quote("Q" + ++quoteSequence, customerId, restaurantId, address, lines,
                subtotal, delivery, discount, Math.subtractExact(Math.addExact(subtotal, delivery), discount), now().plus(Duration.ofMinutes(5)));
            quotes.put(quote.id(), quote); return quote;
        }
        public synchronized OrderView place(String requestId, String customerId, String quoteId) {
            key(requestId); key(customerId); CheckoutKey key = new CheckoutKey(customerId, requestId);
            SavedCheckout old = checkouts.get(key);
            if (old != null) {
                if (!old.quoteId().equals(quoteId)) throw new IllegalArgumentException("Checkout ID payload conflict");
                return order(old.orderId()).view();
            }
            Quote quote = Objects.requireNonNull(quotes.get(quoteId), "Unknown quote");
            if (!quote.customerId().equals(customerId)) throw new IllegalArgumentException("Quote belongs to another customer");
            if (!now().isBefore(quote.validUntil())) throw new IllegalStateException("Quote expired");
            Restaurant r = restaurant(quote.restaurantId());
            if (!r.open || quote.lines().stream().anyMatch(line -> !r.menu.containsKey(line.itemId()) || !r.menu.get(line.itemId()).available()))
                throw new IllegalStateException("Restaurant/item no longer available");
            Order order = new Order("O" + ++orderSequence, quote); orders.put(order.id, order);
            checkouts.put(key, new SavedCheckout(quoteId, order.id)); events.add(new Event(order.id, 0, "order snapshots committed"));
            return order.view();
        }
        // END checkout

        // BEGIN payment
        public OrderView workPayment(String orderId) {
            Work work;
            synchronized (this) {
                Order order = order(orderId);
                if (order.paymentBusy) return order.view();
                work = nextWork(order);
                if (work == null) return order.view();
                order.paymentBusy = true;
            }
            ChargeReport charge = null; RefundReport refund = null;
            try {
                switch (work.kind()) {
                    case CAPTURE -> charge = payments.capture(work.charge());
                    case LOOKUP_CHARGE -> charge = payments.lookupCharge(work.charge());
                    case REFUND -> refund = payments.refund(work.refund());
                    case LOOKUP_REFUND -> refund = payments.lookupRefund(work.refund());
                }
            } catch (RuntimeException unavailableOrAmbiguous) {
                // An exception cannot prove the external side effect did not occur.
            }
            synchronized (this) {
                Order order = order(orderId); order.paymentBusy = false;
                if (work.kind() == WorkKind.CAPTURE || work.kind() == WorkKind.LOOKUP_CHARGE)
                    recordCharge(order, work.charge(), charge);
                else recordRefund(order, work.refund(), refund);
                return order.view();
            }
        }
        private Work nextWork(Order order) {
            ChargeCommand charge = new ChargeCommand("charge/" + order.id, order.quote.totalPaise());
            if (order.money == Money.NEW && order.state == State.OPEN) {
                order.money = Money.CAPTURE_PENDING; order.paymentReason = "capture intent recorded";
                changed(order, "capture intent"); return new Work(order.id, WorkKind.CAPTURE, charge, null);
            }
            if (order.money == Money.CAPTURE_PENDING || order.money == Money.CAPTURE_UNKNOWN)
                return new Work(order.id, WorkKind.LOOKUP_CHARGE, charge, null);
            RefundCommand refund = new RefundCommand("refund/" + order.id, order.chargeReference, order.quote.totalPaise());
            if (order.money == Money.REFUND_NEEDED) {
                order.money = Money.REFUND_PENDING; order.paymentReason = "full refund intent recorded";
                changed(order, "refund intent"); return new Work(order.id, WorkKind.REFUND, null, refund);
            }
            if (order.money == Money.REFUND_PENDING || order.money == Money.REFUND_UNKNOWN)
                return new Work(order.id, WorkKind.LOOKUP_REFUND, null, refund);
            return null;
        }
        private void recordCharge(Order order, ChargeCommand command, ChargeReport report) {
            if (report == null || !command.id().equals(report.id()) || command.amountPaise() != report.amountPaise()
                || report.outcome() == null || (report.outcome() == ChargeOutcome.PAID && blank(report.reference()))) {
                order.money = Money.CAPTURE_UNKNOWN; order.paymentReason = "charge evidence unavailable/inconsistent; query original operation";
            } else if (report.outcome() == ChargeOutcome.PAID) {
                order.chargeReference = report.reference();
                boolean closed = order.state == State.CANCELLED || order.state == State.REJECTED;
                order.money = closed ? Money.REFUND_NEEDED : Money.PAID;
                order.paymentReason = closed ? "late capture confirmed; full refund required" : "capture confirmed";
            } else if (report.outcome() == ChargeOutcome.DECLINED) {
                order.money = Money.DECLINED; order.paymentReason = "capture definitively declined";
                if (order.state == State.OPEN) { order.state = State.PAYMENT_FAILED; order.kitchen = Kitchen.CANCELLED; }
            } else {
                order.money = Money.CAPTURE_UNKNOWN; order.paymentReason = "capture unknown; do not capture again";
            }
            changed(order, "capture evidence recorded without reopening fulfilment");
        }
        private void recordRefund(Order order, RefundCommand command, RefundReport report) {
            if (report == null || !command.id().equals(report.id()) || !Objects.equals(command.chargeReference(), report.chargeReference())
                || command.amountPaise() != report.amountPaise() || report.outcome() == null
                || (report.outcome() == RefundOutcome.REFUNDED && blank(report.reference()))) {
                order.money = Money.REFUND_UNKNOWN; order.paymentReason = "refund evidence unavailable/inconsistent; query original operation";
            } else if (report.outcome() == RefundOutcome.REFUNDED) {
                order.money = Money.REFUNDED; order.refundReference = report.reference(); order.paymentReason = "full refund confirmed";
            } else if (report.outcome() == RefundOutcome.FAILED) {
                order.money = Money.REFUND_FAILED; order.paymentReason = "refund failed; operator resolution required";
            } else {
                order.money = Money.REFUND_UNKNOWN; order.paymentReason = "refund unknown; do not refund again";
            }
            changed(order, "refund evidence recorded");
        }
        // END payment

        // BEGIN restaurant
        public synchronized Result restaurantDecision(String orderId, String restaurantId, String decisionId, boolean accept) {
            Order order = restaurantOrder(orderId, restaurantId); key(decisionId);
            if (order.decisionId != null) {
                if (!order.decisionId.equals(decisionId) || order.accepted != accept) throw new IllegalArgumentException("Restaurant decision conflict");
                return result(Decision.REPLAYED, order);
            }
            if (order.state != State.OPEN) return result(Decision.IGNORED_CLOSED, order);
            if (order.money != Money.PAID || order.kitchen != Kitchen.WAITING) return result(Decision.DENIED_STAGE, order);
            order.decisionId = decisionId; order.accepted = accept;
            if (accept) order.kitchen = Kitchen.ACCEPTED;
            else { order.kitchen = Kitchen.REJECTED; order.state = State.REJECTED; order.money = Money.REFUND_NEEDED; }
            changed(order, accept ? "restaurant accepted; preparation not started" : "restaurant rejected; full refund required");
            return result(Decision.APPLIED, order);
        }
        public synchronized Result beginPreparation(String orderId, String restaurantId, String prepToken, int expectedVersion) {
            Order order = restaurantOrder(orderId, restaurantId); key(prepToken);
            if (order.prepToken != null) {
                if (!order.prepToken.equals(prepToken)) throw new IllegalArgumentException("Preparation identity conflict");
                return result(Decision.REPLAYED, order);
            }
            if (order.state != State.OPEN) return result(Decision.IGNORED_CLOSED, order);
            if (order.version != expectedVersion) return result(Decision.STALE_VERSION, order);
            if (order.money != Money.PAID || order.kitchen != Kitchen.ACCEPTED) return result(Decision.DENIED_STAGE, order);
            order.prepToken = prepToken; order.kitchen = Kitchen.PREPARING;
            changed(order, "preparation authorization committed; ordinary cancellation closes");
            return result(Decision.APPLIED, order);
        }
        public synchronized Result ready(String orderId, String restaurantId, String prepToken) {
            Order order = restaurantOrder(orderId, restaurantId); key(prepToken);
            if (order.state != State.OPEN) return result(Decision.IGNORED_CLOSED, order);
            if (!prepToken.equals(order.prepToken)) return result(Decision.NOT_CURRENT, order);
            if (order.kitchen == Kitchen.READY) return result(Decision.REPLAYED, order);
            if (order.kitchen != Kitchen.PREPARING) return result(Decision.DENIED_STAGE, order);
            order.kitchen = Kitchen.READY; changed(order, "food ready for custody handover");
            return result(Decision.APPLIED, order);
        }
        // END restaurant

        // BEGIN cancel
        public synchronized Result cancel(String orderId, String customerId, int expectedVersion) {
            Order order = customerOrder(orderId, customerId);
            if (order.state == State.CANCELLED) return result(Decision.REPLAYED, order);
            if (order.state != State.OPEN) return result(Decision.IGNORED_CLOSED, order);
            if (order.kitchen == Kitchen.PREPARING || order.kitchen == Kitchen.READY || order.deliveryId != null)
                return result(Decision.DENIED_STAGE, order);
            if (order.version != expectedVersion) return result(Decision.STALE_VERSION, order);
            order.state = State.CANCELLED; order.kitchen = Kitchen.CANCELLED;
            if (order.money == Money.NEW) order.money = Money.NOT_CHARGED;
            else if (order.money == Money.PAID) order.money = Money.REFUND_NEEDED;
            // Pending/unknown capture remains unresolved. Its eventual PAID fact requires compensation.
            changed(order, "customer cancelled before preparation; payment reconciliation remains independent");
            return result(Decision.APPLIED, order);
        }
        // END cancel

        // BEGIN delivery
        public synchronized DeliveryResult assign(String orderId, String courierId, String deliveryId) {
            key(deliveryId); Order order = order(orderId);
            Delivery previous = deliveries.get(deliveryId);
            if (previous != null) {
                if (!previous.orderId.equals(orderId) || !previous.courierId.equals(courierId)) throw new IllegalArgumentException("Delivery identity conflict");
                return deliveryResult(Decision.REPLAYED, previous);
            }
            if (!couriers.contains(courierId)) throw new IllegalArgumentException("Unknown courier");
            if (order.state != State.OPEN || order.kitchen != Kitchen.READY || order.money != Money.PAID
                || order.deliveryId != null || courierActive.containsKey(courierId)) throw new IllegalStateException("Order/courier cannot be assigned");
            Delivery delivery = new Delivery(deliveryId, orderId, courierId); deliveries.put(deliveryId, delivery);
            order.deliveryId = deliveryId; courierActive.put(courierId, deliveryId);
            changed(order, "courier and delivery assigned together");
            return deliveryResult(Decision.APPLIED, delivery);
        }
        /** Trusted dispatch operation: replace a courier only before custody pickup. */
        public synchronized DeliveryResult releaseCourier(String deliveryId, String courierId) {
            Delivery delivery = courierDelivery(deliveryId, courierId); Order order = order(delivery.orderId);
            if (delivery.state == DeliveryState.RELEASED) return deliveryResult(Decision.REPLAYED, delivery);
            if (delivery.state != DeliveryState.ASSIGNED || !current(delivery)) return deliveryResult(Decision.NOT_CURRENT, delivery);
            courierActive.remove(courierId, deliveryId); order.deliveryId = null; delivery.state = DeliveryState.RELEASED;
            changed(order, "pre-pickup courier assignment released; food/payment unchanged");
            return deliveryResult(Decision.APPLIED, delivery);
        }
        public synchronized DeliveryResult pickup(String deliveryId, String courierId) {
            Delivery delivery = courierDelivery(deliveryId, courierId); Order order = order(delivery.orderId);
            if (delivery.state == DeliveryState.PICKED_UP || delivery.state == DeliveryState.DELIVERED) return deliveryResult(Decision.REPLAYED, delivery);
            if (delivery.state != DeliveryState.ASSIGNED || !current(delivery) || order.state != State.OPEN
                || order.kitchen != Kitchen.READY) return deliveryResult(Decision.NOT_CURRENT, delivery);
            delivery.state = DeliveryState.PICKED_UP; changed(order, "courier took custody of ready food");
            return deliveryResult(Decision.APPLIED, delivery);
        }
        public synchronized DeliveryResult deliver(String deliveryId, String courierId, String trustedProofId) {
            Delivery delivery = courierDelivery(deliveryId, courierId); Order order = order(delivery.orderId); key(trustedProofId);
            if (delivery.state == DeliveryState.DELIVERED) {
                if (!delivery.proofId.equals(trustedProofId)) throw new IllegalArgumentException("Delivery proof conflict");
                return deliveryResult(Decision.REPLAYED, delivery);
            }
            if (delivery.state != DeliveryState.PICKED_UP || !current(delivery) || order.state != State.OPEN)
                return deliveryResult(Decision.NOT_CURRENT, delivery);
            delivery.proofId = trustedProofId; delivery.state = DeliveryState.DELIVERED; order.state = State.DELIVERED;
            courierActive.remove(courierId, deliveryId); changed(order, "delivery proof recorded; courier capacity released once");
            return deliveryResult(Decision.APPLIED, delivery);
        }
        // END delivery

        private boolean current(Delivery delivery) {
            return delivery.id.equals(order(delivery.orderId).deliveryId)
                && delivery.id.equals(courierActive.get(delivery.courierId));
        }
        private void changed(Order order, String description) { order.version++; events.add(new Event(order.id, order.version, description)); }
        private Result result(Decision decision, Order order) { return new Result(decision, order.view()); }
        private DeliveryResult deliveryResult(Decision decision, Delivery delivery) {
            return new DeliveryResult(decision, delivery.view(), order(delivery.orderId).view());
        }
        private Order restaurantOrder(String id, String restaurantId) {
            Order order = order(id); if (!order.quote.restaurantId().equals(restaurantId)) throw new IllegalArgumentException("Wrong restaurant"); return order;
        }
        private Order customerOrder(String id, String customerId) {
            Order order = order(id); if (!order.quote.customerId().equals(customerId)) throw new IllegalArgumentException("Wrong customer"); return order;
        }
        private Delivery courierDelivery(String id, String courierId) {
            Delivery delivery = delivery(id); if (!delivery.courierId.equals(courierId)) throw new IllegalArgumentException("Wrong courier"); return delivery;
        }
        private Restaurant restaurant(String id) { return Objects.requireNonNull(restaurants.get(id), "Unknown restaurant"); }
        private Order order(String id) { return Objects.requireNonNull(orders.get(id), "Unknown order"); }
        private Delivery delivery(String id) { return Objects.requireNonNull(deliveries.get(id), "Unknown delivery"); }
    }

    private static boolean blank(String value) { return value == null || value.isBlank(); }
    private static void key(String value) { if (blank(value)) throw new IllegalArgumentException("Missing identifier"); }
}

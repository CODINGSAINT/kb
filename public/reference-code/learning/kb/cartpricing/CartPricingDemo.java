package kb.cartpricing;

import java.time.Instant;
import java.util.*;

// region:cart
record Product(String sku, String name, long pricePaise, String category) {}

class Cart {
    private final Map<String, Integer> qty = new LinkedHashMap<>();
    private final Map<String, Product> products = new HashMap<>();

    void add(Product p, int n) {
        if (n <= 0) throw new IllegalArgumentException("Quantity must be positive");
        products.put(p.sku(), p);
        qty.merge(p.sku(), n, Integer::sum);
    }
    void setQuantity(String sku, int n) {
        if (n <= 0) { qty.remove(sku); products.remove(sku); } else qty.put(sku, n);
    }
    List<Line> lines() {
        return qty.entrySet().stream()
                .map(e -> new Line(products.get(e.getKey()), e.getValue())).toList();
    }
    record Line(Product product, int qty) {
        long totalPaise() { return product.pricePaise() * qty; }
    }
}
// endregion:cart

// region:rules
record Discount(String reason, long amountPaise) {}

/** One pricing rule. Each looks at the cart and the subtotal left after earlier rules. */
interface PricingRule {
    Optional<Discount> apply(List<Cart.Line> lines, long subtotalPaise);
}

/** Buy 2, get 1 free on one SKU: every third unit is free. */
record BuyTwoGetOne(String sku) implements PricingRule {
    public Optional<Discount> apply(List<Cart.Line> lines, long subtotal) {
        return lines.stream().filter(l -> l.product().sku().equals(sku)).findFirst()
                .filter(l -> l.qty() >= 3)
                .map(l -> new Discount("Buy 2 get 1: " + l.product().name(),
                        (l.qty() / 3) * l.product().pricePaise()));
    }
}

/** Percentage coupon with a cap, e.g. 10% off up to Rs 200 on orders from Rs 999. */
record PercentCoupon(String code, int percent, long minOrderPaise, long capPaise)
        implements PricingRule {
    public Optional<Discount> apply(List<Cart.Line> lines, long subtotal) {
        if (subtotal < minOrderPaise) return Optional.empty();
        long off = Math.min(subtotal * percent / 100, capPaise);
        return Optional.of(new Discount("Coupon " + code, off));
    }
}
// endregion:rules

// region:quote
record Quote(List<Cart.Line> lines, List<Discount> discounts, long subtotalPaise,
             long deliveryPaise, long totalPaise, Instant expiresAt) {}

class PricingEngine {
    private final List<PricingRule> rules;     // order matters: item deals, then coupons
    private final long freeDeliveryFromPaise = 49_900, deliveryFeePaise = 4_000;

    PricingEngine(List<PricingRule> rules) { this.rules = List.copyOf(rules); }

    Quote quote(Cart cart, Instant now) {
        List<Cart.Line> lines = cart.lines();
        long subtotal = lines.stream().mapToLong(Cart.Line::totalPaise).sum();
        List<Discount> applied = new ArrayList<>();
        for (PricingRule rule : rules) {
            Optional<Discount> d = rule.apply(lines, subtotal);
            if (d.isPresent()) {
                long off = Math.min(d.get().amountPaise(), subtotal);  // never below 0
                applied.add(new Discount(d.get().reason(), off));
                subtotal -= off;
            }
        }
        long delivery = subtotal >= freeDeliveryFromPaise ? 0 : deliveryFeePaise;
        return new Quote(lines, applied, subtotal, delivery, subtotal + delivery,
                now.plusSeconds(15 * 60));
    }
}
// endregion:quote

// region:checkout
class Checkout {
    private final PricingEngine engine;
    Checkout(PricingEngine engine) { this.engine = engine; }

    /** The customer pays the quote they saw – or sees a new one if it changed. */
    Quote confirm(Cart cart, Quote shown, Instant now) {
        Quote fresh = engine.quote(cart, now);
        if (now.isAfter(shown.expiresAt()) || fresh.totalPaise() != shown.totalPaise())
            throw new QuoteChangedException(fresh);
        return shown;
    }
}

class QuoteChangedException extends RuntimeException {
    final Quote newQuote;
    QuoteChangedException(Quote q) { super("Price changed: please review"); newQuote = q; }
}
// endregion:checkout

public class CartPricingDemo {
    public static void main(String[] args) {
        Product socks = new Product("SOCK-01", "Running socks", 29_900, "apparel");
        Product shoes = new Product("SHOE-07", "Trail shoes", 349_900, "footwear");
        var engine = new PricingEngine(List.of(
                new BuyTwoGetOne("SOCK-01"),
                new PercentCoupon("RUN10", 10, 99_900, 20_000)));
        Instant t0 = Instant.parse("2026-10-27T10:00:00Z");

        Cart cart = new Cart();
        cart.add(socks, 3);
        Quote q1 = engine.quote(cart, t0);
        check(q1.discounts().size() == 1, "only buy-2-get-1; Rs 598 is below Rs 999");
        check(q1.subtotalPaise() == 59_800, "Rs 897 - 299");
        check(q1.deliveryPaise() == 0, "free delivery from Rs 499");

        cart.add(shoes, 1);
        Quote q2 = engine.quote(cart, t0);
        check(q2.discounts().get(1).amountPaise() == 20_000, "10% of 4,097 capped at 200");
        check(q2.totalPaise() == 389_700, "Rs 4,396 - 299 - 200");

        Checkout checkout = new Checkout(engine);
        check(checkout.confirm(cart, q2, t0.plusSeconds(60)) == q2, "same price, in time");
        try { checkout.confirm(cart, q2, t0.plusSeconds(16 * 60)); check(false, "expired"); }
        catch (QuoteChangedException e) { check(e.newQuote.totalPaise() == 389_700, "new"); }

        cart.setQuantity("SOCK-01", 1);
        try { checkout.confirm(cart, q2, t0.plusSeconds(120)); check(false, "cart changed"); }
        catch (QuoteChangedException e) { check(e.newQuote.totalPaise() == 359_800, "new"); }
        System.out.println("All checks passed");
    }

    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}

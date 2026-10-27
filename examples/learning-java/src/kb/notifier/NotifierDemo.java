package kb.notifier;

import java.util.*;

// region:message
enum ChannelType { EMAIL, SMS, PUSH }

record Template(String name, String text) {
    String render(Map<String, String> data) {
        String out = text;
        for (var e : data.entrySet()) out = out.replace("{" + e.getKey() + "}", e.getValue());
        if (out.contains("{")) throw new IllegalArgumentException("Missing value in " + name);
        return out;
    }
}

record User(String id, String email, String phone, String deviceToken,
            Set<ChannelType> enabled) {}

record Message(String eventId, User to, ChannelType channel, String text) {}
// endregion:message

// region:channels
/** Thrown for failures worth retrying (timeouts, 5xx). Others are permanent. */
class TemporaryFailure extends RuntimeException {
    TemporaryFailure(String why) { super(why); }
}

interface Channel {
    ChannelType type();
    void send(Message m);              // throws TemporaryFailure or another exception
}

class EmailChannel implements Channel {
    final List<String> sent = new ArrayList<>();
    int failNextCalls;                 // lets the demo simulate an outage
    public ChannelType type() { return ChannelType.EMAIL; }
    public void send(Message m) {
        if (failNextCalls-- > 0) throw new TemporaryFailure("SMTP timeout");
        sent.add(m.to().email() + ": " + m.text());
    }
}

class SmsChannel implements Channel {
    final List<String> sent = new ArrayList<>();
    public ChannelType type() { return ChannelType.SMS; }
    public void send(Message m) {
        if (m.to().phone() == null) throw new IllegalArgumentException("No phone number");
        sent.add(m.to().phone() + ": " + m.text());
    }
}
// endregion:channels

// region:service
enum Status { SENT, FAILED, SKIPPED }

record Attempt(Message message, Status status, int tries, String note) {}

class NotificationService {
    private final Map<ChannelType, Channel> channels = new EnumMap<>(ChannelType.class);
    private final Map<String, Template> templates;
    private final Set<String> seenEvents = new HashSet<>();   // de-duplicates retries
    private final int maxTries;
    final List<Long> backoffsMillis = new ArrayList<>();      // recorded, not slept

    NotificationService(List<Channel> list, Map<String, Template> templates, int maxTries) {
        list.forEach(c -> channels.put(c.type(), c));
        this.templates = templates; this.maxTries = maxTries;
    }

    List<Attempt> notify(String eventId, User user, String template,
                         Map<String, String> data, Set<ChannelType> wanted) {
        String text = templates.get(template).render(data);    // fails before anything is sent
        if (!seenEvents.add(eventId)) return List.of();          // already handled
        List<Attempt> results = new ArrayList<>();
        for (ChannelType type : wanted) {
            Message m = new Message(eventId, user, type, text);
            if (!user.enabled().contains(type)) {
                results.add(new Attempt(m, Status.SKIPPED, 0, "user turned it off"));
                continue;
            }
            results.add(sendWithRetry(channels.get(type), m));
        }
        return results;
    }

    private Attempt sendWithRetry(Channel channel, Message m) {
        for (int attempt = 1; attempt <= maxTries; attempt++) {
            try {
                channel.send(m);
                return new Attempt(m, Status.SENT, attempt, "ok");
            } catch (TemporaryFailure e) {
                backoffsMillis.add(1000L << (2 * (attempt - 1)));  // 1 s, 4 s, 16 s
            } catch (RuntimeException e) {
                return new Attempt(m, Status.FAILED, attempt, e.getMessage());  // permanent
            }
        }
        return new Attempt(m, Status.FAILED, maxTries, "gave up after retries");
    }
}
// endregion:service

public class NotifierDemo {
    public static void main(String[] args) {
        EmailChannel email = new EmailChannel();
        SmsChannel sms = new SmsChannel();
        var templates = Map.of("order_shipped",
                new Template("order_shipped", "Hi {name}, order {orderId} ships today!"));
        var service = new NotificationService(List.of(email, sms), templates, 3);

        User asha = new User("u1", "asha@mail.in", "98450 12345", null,
                EnumSet.of(ChannelType.EMAIL, ChannelType.SMS));
        email.failNextCalls = 2;                                 // SMTP down for two tries
        var r = service.notify("order-847-shipped", asha, "order_shipped",
                Map.of("name", "Asha", "orderId", "847"),
                EnumSet.of(ChannelType.EMAIL, ChannelType.SMS, ChannelType.PUSH));

        check(r.get(0).status() == Status.SENT && r.get(0).tries() == 3, "email on 3rd try");
        check(service.backoffsMillis.equals(List.of(1000L, 4000L)), "waited 1 s then 4 s");
        check(sms.sent.equals(List.of("98450 12345: Hi Asha, order 847 ships today!")), "sms");
        check(r.get(2).status() == Status.SKIPPED, "push not enabled for Asha");

        var again = service.notify("order-847-shipped", asha, "order_shipped",
                Map.of("name", "Asha", "orderId", "847"), EnumSet.of(ChannelType.SMS));
        check(again.isEmpty() && sms.sent.size() == 1, "same event twice: sent once");

        User bilal = new User("u2", "bilal@mail.in", null, null, EnumSet.of(ChannelType.SMS));
        var b = service.notify("order-900-shipped", bilal, "order_shipped",
                Map.of("name", "Bilal", "orderId", "900"), EnumSet.of(ChannelType.SMS));
        check(b.get(0).status() == Status.FAILED && b.get(0).tries() == 1, "no phone: no retry");

        try {
            service.notify("x", asha, "order_shipped", Map.of("name", "Asha"),
                    EnumSet.of(ChannelType.EMAIL));
            check(false, "missing orderId");
        } catch (IllegalArgumentException expected) { }
        System.out.println("All checks passed");
    }

    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
}

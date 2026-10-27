package kb.splitwise;

import java.math.BigInteger;
import java.util.*;
import java.util.concurrent.*;

public final class SplitChecks {
    private static int checks;
    private static final Set<String> GROUP = Set.of("A","B","C","D");
    private static SplitLedger ledger() { return new SplitLedger(GROUP); }
    private static void ok(boolean value) { checks++; if (!value) throw new AssertionError("Check "+checks); }
    private static void rejects(Class<? extends Exception> type, Runnable action) {
        try { action.run(); throw new AssertionError("Expected "+type); }
        catch (Exception error) { ok(type.isInstance(error)); }
    }
    private static void invariant(SplitLedger ledger) {
        var view = ledger.snapshot("A");
        ok(view.balances().values().stream().map(BigInteger::valueOf).reduce(BigInteger.ZERO,BigInteger::add).signum()==0);
        ok(view.balances().equals(ledger.rebuild("A")));
        Map<String,Long> residual = new HashMap<>(view.balances());
        for (var transfer : ledger.plan("A").transfers()) {
            ok(transfer.amount()>0 && !transfer.from().equals(transfer.to()));
            residual.compute(transfer.from(),(key,n)->n+transfer.amount());
            residual.compute(transfer.to(),(key,n)->n-transfer.amount());
        }
        ok(residual.values().stream().allMatch(n->n==0));
    }
    private static void race(int count, Runnable action) throws Exception {
        var ready = new CountDownLatch(count); var go = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(count)) {
            var results = new ArrayList<Future<?>>();
            for(int i=0;i<count;i++) results.add(pool.submit(()->{ready.countDown();try{go.await();}catch(InterruptedException e){Thread.currentThread().interrupt();throw new RuntimeException(e);}action.run();}));
            if(!ready.await(10,TimeUnit.SECONDS))throw new AssertionError("Race did not start");go.countDown();
            for(var result:results)result.get(10,TimeUnit.SECONDS);
        }
    }
    public static void main(String[] args) throws Exception {
        ok(Splits.equal(10001,List.of("C","A","B")).equals(Map.of("A",3334L,"B",3334L,"C",3333L)));
        ok(Splits.equal(1,List.of("C","B","A")).equals(Map.of("A",1L,"B",0L,"C",0L)));
        ok(Splits.weighted(101,Map.of("A",1,"B",2)).equals(Map.of("A",34L,"B",67L)));
        ok(Splits.percent(101,Map.of("A",5000,"B",3000,"C",2000)).equals(Map.of("A",51L,"B",30L,"C",20L)));
        ok(Splits.percent(1,Map.of("A",0,"B",10000)).equals(Map.of("A",0L,"B",1L)));
        rejects(IllegalArgumentException.class,()->Splits.equal(10,List.of("A","A")));
        rejects(IllegalArgumentException.class,()->Splits.exact(100,Map.of("A",99L)));
        rejects(IllegalArgumentException.class,()->Splits.percent(100,Map.of("A",9999)));
        rejects(IllegalArgumentException.class,()->Splits.weighted(100,Map.of("A",0)));
        rejects(IllegalArgumentException.class,()->Splits.weighted(100,Map.of("A",-1)));
        var random = new Random(41);
        for(int i=0;i<300;i++) {
            long total=1+random.nextInt(100000);
            var weights=Map.of("A",1+random.nextInt(50),"B",1+random.nextInt(50),"C",1+random.nextInt(50));
            var shares=Splits.weighted(total,weights);
            ok(shares.values().stream().mapToLong(Long::longValue).sum()==total);
            ok(shares.values().stream().allMatch(n->n>=0));
        }
        var multiple=ledger();multiple.addExpense("E","A",1000,Map.of("C",600L,"D",400L),Map.of("A",400L,"B",600L));
        ok(multiple.plan("A").transfers().size()==3); // Two are possible: A->D 400, B->C 600. No minimum claim.
        invariant(multiple);
        var l=ledger();var paid=new HashMap<>(Map.of("A",10001L));var shares=Splits.equal(10001,List.of("A","B","C"));
        var expense=l.addExpense("E1","A",10001,paid,shares);paid.put("A",1L);
        ok(expense.paid().get("A")==10001);rejects(UnsupportedOperationException.class,()->expense.shares().put("A",1L));
        var before=l.snapshot("A");
        ok(before.expenses().size()==1 && before.expenses().getFirst().paid().get("A")==10001);
        ok(before.expenses().getFirst().shares().equals(shares));
        rejects(UnsupportedOperationException.class,()->l.snapshot("A").expenses().clear());
        l.addExpense("E1","A",10001,Map.of("A",10001L),shares);ok(l.snapshot("A").equals(before));
        rejects(IllegalArgumentException.class,()->l.addExpense("E1","A",10002,Map.of("A",10002L),Splits.equal(10002,List.of("A","B","C"))));
        rejects(IllegalArgumentException.class,()->l.addExpense("E2","X",1,Map.of("A",1L),Map.of("A",1L)));
        rejects(IllegalArgumentException.class,()->l.addExpense("E2","A",1,Map.of("X",1L),Map.of("A",1L)));
        ok(l.snapshot("A").equals(before));
        rejects(UnsupportedOperationException.class,()->l.snapshot("A").balances().clear());
        var oldPlan=l.plan("A");
        l.proposePayment("P","B","A",3334);ok(l.snapshot("A").balances().equals(before.balances()));
        rejects(IllegalArgumentException.class,()->l.confirmPayment("P","B"));
        rejects(IllegalArgumentException.class,()->l.proposePayment("P","B","A",3333));
        l.addExpense("E2","B",1200,Map.of("B",1200L),Map.of("A",1200L));
        ok(l.snapshot("A").balances().get("B")==-2134);
        l.confirmPayment("P","A");ok(l.snapshot("A").balances().get("B")==1200); // Actual payment may flip a balance.
        before=l.snapshot("A");l.confirmPayment("P","A");ok(l.snapshot("A").equals(before));
        ok(l.plan("A").revision()!=oldPlan.revision());invariant(l);
        var correction=ledger();correction.addExpense("dinner","A",9000,Map.of("A",9000L),Map.of("A",4500L,"B",4500L));
        correction.proposePayment("paid","B","A",4500);correction.confirmPayment("paid","A");
        ok(correction.snapshot("A").balances().values().stream().allMatch(n->n==0));
        correction.reverseExpense("fix","dinner","A");
        ok(correction.snapshot("A").balances().get("A")==-4500); // Correction does not undo cash already received.
        ok(correction.snapshot("A").reversals().getFirst().expenseId().equals("dinner"));
        ok(correction.snapshot("A").expenses().getFirst().total()==9000);
        before=correction.snapshot("A");correction.reverseExpense("fix","dinner","A");ok(correction.snapshot("A").equals(before));
        rejects(IllegalArgumentException.class,()->correction.reverseExpense("another","dinner","A"));
        rejects(IllegalArgumentException.class,()->correction.reverseExpense("fix","dinner","B"));invariant(correction);
        var overflow=ledger();overflow.addExpense("max","A",Long.MAX_VALUE,Map.of("A",Long.MAX_VALUE),Map.of("B",Long.MAX_VALUE));
        before=overflow.snapshot("A");
        rejects(ArithmeticException.class,()->overflow.addExpense("extra","A",1,Map.of("A",1L),Map.of("B",1L)));
        ok(overflow.snapshot("A").equals(before));invariant(overflow);
        var concurrent=ledger();race(32,()->concurrent.addExpense("one","A",200,Map.of("A",200L),Map.of("A",100L,"B",100L)));
        ok(concurrent.snapshot("A").entries().size()==1);ok(concurrent.snapshot("A").balances().get("A")==100);
        concurrent.proposePayment("one-payment","B","A",100);race(32,()->concurrent.confirmPayment("one-payment","A"));
        ok(concurrent.snapshot("A").entries().size()==2);ok(concurrent.snapshot("A").balances().values().stream().allMatch(n->n==0));invariant(concurrent);
        for(int i=0;i<100;i++) {
            long total=1+random.nextInt(100000);String id="R"+i;
            concurrent.addExpense(id,"A",total,Map.of("A",total),Splits.weighted(total,Map.of("A",1,"B",2,"C",3,"D",4)));invariant(concurrent);
            if(i%3==0){concurrent.reverseExpense("undo"+i,id,"A");invariant(concurrent);}
        }
        System.out.println("PASS SplitChecks: "+checks+" checks; four split modes, exact money/rebuild/plan conservation, retries, correction after payment, overflow rollback and two 32-caller races");
    }
}

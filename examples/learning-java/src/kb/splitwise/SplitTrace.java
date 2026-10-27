package kb.splitwise;

import java.util.*;
import java.util.stream.Collectors;

/** Offline frames recorded by running the actual ledger. No payment-provider calls. */
public final class SplitTrace {
    private static final List<String> cases=new ArrayList<>(),frames=new ArrayList<>();
    private static SplitLedger ledger;
    private static String q(String value){return "\""+value.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n")+"\"";}
    private static void start(){ledger=new SplitLedger(Set.of("A","B","C"));frames.clear();}
    private static void frame(String title,String note){
        var s=ledger.snapshot("A");var p=ledger.plan("A");
        String balances=new TreeMap<>(s.balances()).entrySet().stream().map(e->q(e.getKey())+":"+e.getValue()).collect(Collectors.joining(","));
        String transfers=p.transfers().stream().map(t->"{"+q("from")+":"+q(t.from())+","+q("to")+":"+q(t.to())+","+q("amount")+":"+t.amount()+"}").collect(Collectors.joining(","));
        String payments=s.payments().stream().map(t->"{"+q("id")+":"+q(t.id())+","+q("from")+":"+q(t.from())+","+q("to")+":"+q(t.to())+","+q("amount")+":"+t.amount()+","+q("state")+":"+q(t.state().name())+"}").collect(Collectors.joining(","));
        frames.add("{\"title\":"+q(title)+",\"note\":"+q(note)+",\"revision\":"+s.revision()+",\"balances\":{"+balances+"},\"entries\":"+s.entries().size()+",\"payments\":["+payments+"],\"transfers\":["+transfers+"]}");
    }
    private static void finish(String id,String label){cases.add("{\"id\":"+q(id)+",\"label\":"+q(label)+",\"steps\":["+String.join(",",frames)+"]}");}
    private static void first(){ledger.addExpense("taxi","A",10001,Map.of("A",10001L),Splits.equal(10001,List.of("A","B","C")));}
    public static void main(String[] args){
        start();frame("Before the trip","Positive means is owed; negative means owes. All amounts are INR paise.");
        first();frame("A pays INR 100.01 for three people","Shares are A 3334, B 3334, C 3333 paise. A's own share cancels inside A's balance.");
        ledger.addExpense("snack","B",3000,Map.of("B",3000L),Splits.equal(3000,List.of("B","C")));frame("B pays INR 30 for B and C","B is owed 1500 more; C owes 1500 more. The expense does not change A's balance.");
        ledger.proposePayment("B-payment","B","A",1834);frame("B reports a payment of INR 18.34","A has not confirmed receipt. The proposal does not reduce anyone's balance.");
        ledger.confirmPayment("B-payment","A");frame("A confirms B's payment","B's balance becomes zero. A's remaining credit equals C's remaining debt.");
        ledger.proposePayment("C-payment","C","A",4833);ledger.confirmPayment("C-payment","A");frame("A confirms C's INR 48.33","All three balances are zero; the two expenses remain in the journal.");finish("trip","Split the trip and confirm two payments");
        start();frame("Before recording the taxi","No expense or payment is recorded yet.");first();frame("Original taxi expense","There is one expense entry.");first();frame("Same expense identity, same data","The retry returns the original expense. It adds no second entry.");
        try{ledger.addExpense("taxi","A",10002,Map.of("A",10002L),Splits.equal(10002,List.of("A","B","C")));}catch(IllegalArgumentException expected){}
        frame("Same identity, changed amount is rejected","The prior expense and balances are preserved.");
        ledger.proposePayment("reported","B","A",3334);frame("B reports INR 33.34 from the old suggestion","A confirmation is still pending; a suggestion reserves nothing.");
        ledger.addExpense("ticket","B",1200,Map.of("B",1200L),Map.of("A",1200L));frame("Meanwhile B pays INR 12 for A","B now owes only INR 21.34, but the reported transfer amount remains INR 33.34.");
        ledger.confirmPayment("reported","A");frame("A confirms the actual INR 33.34 received","Record the actual confirmed payment once. B now has INR 12 credit; do not rewrite what was received to fit today's debt.");
        ledger.confirmPayment("reported","A");frame("A retries confirmation","The confirmed payment adds no second journal entry.");finish("retry","Retries and a suggestion that becomes stale");
        start();frame("Before recording dinner","No expense or payment is recorded yet.");ledger.addExpense("dinner","A",9000,Map.of("A",9000L),Map.of("A",4500L,"B",4500L));frame("A records dinner for A and B","B owes A INR 45.");
        ledger.proposePayment("dinner-payment","B","A",4500);ledger.confirmPayment("dinner-payment","A");frame("B's payment is confirmed","The balances are zero before the correction.");
        ledger.reverseExpense("wrong-dinner","dinner","A");frame("The dinner expense was a mistake","Append its opposite entry. A now owes B INR 45 because the cash already received was not undone.");
        ledger.reverseExpense("wrong-dinner","dinner","A");frame("Retry the same correction","There is still only one reversal. A suggested refund is advice, not an automatic bank transfer.");finish("correction","Correct an expense after money was received");
        System.out.println("{\"source\":\"Java 21 SplitLedger via SplitTrace; offline recorded execution\",\"scenarios\":["+String.join(",",cases)+"]}");
    }
}

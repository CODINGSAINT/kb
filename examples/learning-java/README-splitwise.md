# Splitwise mechanism

Java21; no dependencies. From the KB repository root, compile the four `examples/learning-java/src/kb/splitwise/*.java` files into a local classes directory. Run `kb.splitwise.SplitChecks` with assertions enabled. `kb.splitwise.SplitTrace` prints JSON histories used by the learning viewer.

Amounts are integer INR paise. The example records group expense statements and receiver-confirmed payment reports; it does not move money, authenticate HTTP users or persist across restarts. Four allocation modes conserve the total; the journal rebuilds net balances. Suggestions are deterministic snapshot advice and need not use the minimum number of transfers. See the topic answer for the database boundary and limitations.

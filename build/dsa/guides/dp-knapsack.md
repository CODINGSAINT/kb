# DP: Knapsack

Choose items under a capacity: each item is taken once (0/1) or any number of times (unbounded), and `dp[c]` holds the best value or number of ways for capacity c.

## Spot it when
- "Can a subset sum to X?" (Partition Equal Subset Sum, Subset Sum).
- "Assign + or − to reach a target" (Target Sum reduces to a subset count).
- Coin change (minimum coins: unbounded), number of ways to make an amount (combinations vs permutations), rod cutting.

## The idea
For a 0/1 knapsack with a 1-D array, loop the capacity **downwards** so each item is used at most once. For unbounded knapsack, loop **upwards** so an item can be reused. Counting combinations puts items in the outer loop; counting permutations (Combination Sum IV) puts capacity in the outer loop.

## Java template
```java
// 0/1: can we hit `target`?
boolean[] dp = new boolean[target + 1]; dp[0] = true;
for (int x : nums) for (int c = target; c >= x; c--) dp[c] |= dp[c - x];
// Unbounded: fewest coins for `amount`
int[] best = new int[amount + 1]; Arrays.fill(best, amount + 1); best[0] = 0;
for (int coin : coins) for (int c = coin; c <= amount; c++) best[c] = Math.min(best[c], best[c - coin] + 1);
return best[amount] > amount ? -1 : best[amount];
```
Target Sum: `subsetSum = (total + target) / 2`; if that's negative or the parity is wrong, the answer is 0.

## Complexity
O(n × capacity) time, O(capacity) space. That's pseudo-polynomial, so mention it when capacity is huge.

## Pitfalls
- Wrong loop direction silently turns 0/1 into unbounded, or the reverse.
- Using a sentinel like `Integer.MAX_VALUE` and then adding 1 to it.
- Partition Equal Subset Sum: an odd total means the answer is immediately false.

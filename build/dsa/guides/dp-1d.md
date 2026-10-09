# DP: 1-D Sequences

The answer at position i depends on a few earlier positions. Define `dp[i]`, write the recurrence, and usually shrink the table to a couple of variables.

## Spot it when
- Counting ways or optimising along a line: climbing stairs, decode ways, house robber.
- Best subarray ending at i: Kadane (max sum), max product (track both max and min).
- Subsequences: longest increasing subsequence (O(n²), or O(n log n) with patience sorting), word break (dp over prefixes).
- Choices with cooldowns or states (stock problems as a small state machine).

## The idea
1. **State**: what does `dp[i]` mean? ("best result using the first i items", or "...ending exactly at i").
2. **Transition**: how `dp[i]` is built from `dp[i-1]`, `dp[i-2]` or `dp[j < i]`.
3. **Base cases and answer**: `dp[n]` or `max(dp)`.
Write the recursion with memoisation first if that's easier, then convert it to a bottom-up loop.

## Java template
```java
// House Robber: dp[i] = max(dp[i-1], dp[i-2] + nums[i]) with O(1) space
int prev2 = 0, prev1 = 0;
for (int x : nums) { int cur = Math.max(prev1, prev2 + x); prev2 = prev1; prev1 = cur; }
return prev1;
// Kadane
int best = nums[0], cur = 0;
for (int x : nums) { cur = Math.max(x, cur + x); best = Math.max(best, cur); }
// LIS in O(n log n): tails[k] = smallest tail of an increasing subsequence of length k+1
int[] tails = new int[n]; int len = 0;
for (int x : nums) { int i = Arrays.binarySearch(tails, 0, len, x); if (i < 0) i = -i - 1; tails[i] = x; if (i == len) len++; }
```

## Complexity
Typically O(n) or O(n²) time; O(1) to O(n) space after rolling the array.

## Pitfalls
- Mixing "ending at i" and "within the first i" definitions halfway through.
- Max product subarray: a negative number swaps the running max and min.
- Weighted job scheduling: sort by end time, then binary-search the last compatible job: `dp[i] = max(dp[i-1], profit[i] + dp[prev])`.

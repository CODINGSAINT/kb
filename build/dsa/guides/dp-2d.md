# DP: Grids, Strings & Intervals

The state needs two indices: a grid cell, a position in each of two strings, or an interval [i, j]. Fill the table in an order where every dependency is already computed.

## Spot it when
- Grid paths: unique paths, minimum path sum, obstacles.
- Two strings: longest common subsequence, edit distance, interleaving, distinct subsequences.
- Palindromes: longest palindromic substring or subsequence, palindromic substrings, minimum cuts.
- Interval or partition DP: matrix-chain multiplication, burst balloons, egg dropping.

## The idea
- **Two strings**: `dp[i][j]` = answer for prefixes `a[0..i)` and `b[0..j)`. Matching characters extend `dp[i-1][j-1]`; otherwise take the best of dropping a character from either string.
- **Palindromes**: `isPal[i][j] = a[i]==a[j] && isPal[i+1][j-1]`, so fill by increasing length (or expand around centres for O(1) space).
- **Intervals**: `dp[i][j] = min over k (dp[i][k] + dp[k+1][j] + cost)`, filled by increasing length.

## Java template
```java
// Edit distance
int[][] dp = new int[m + 1][n + 1];
for (int i = 0; i <= m; i++) dp[i][0] = i;
for (int j = 0; j <= n; j++) dp[0][j] = j;
for (int i = 1; i <= m; i++)
    for (int j = 1; j <= n; j++)
        dp[i][j] = a.charAt(i - 1) == b.charAt(j - 1)
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j - 1], Math.min(dp[i - 1][j], dp[i][j - 1]));
return dp[m][n];
```
Expand around centre for palindromic substrings: for each centre `c` (2n-1 of them), grow while the ends match.

## Complexity
O(m × n) time and space; often reducible to O(n) space with one or two rows. Interval DP is O(n³).

## Pitfalls
- Off-by-one between string indices and dp indices (`dp` is one larger).
- Filling interval DP row by row instead of by increasing length.
- Super Egg Drop: flip the state to "with k eggs and m moves, how many floors can I cover?" to get O(k log n).

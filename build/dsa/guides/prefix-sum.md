# Prefix Sum

Precompute running totals so any range sum is one subtraction, and pair it with a hash map to count subarrays that hit a target.

## Spot it when
- Many range-sum queries on a fixed array.
- "Count/longest subarrays with sum (or XOR) equal to K", especially when values can be negative, where sliding window fails.
- "Product of array except self" style: combine a left pass and a right pass.

## The idea
`prefix[i]` is the sum of the first `i` elements, so `sum(i..j) = prefix[j+1] - prefix[i]`. A subarray ending at `j` sums to K exactly when some earlier prefix equals `prefix - K`. Keep a map of prefix value → count (or first index for "longest").

## Java template
```java
Map<Integer, Integer> seen = new HashMap<>();
seen.put(0, 1);                         // empty prefix
int sum = 0, count = 0;
for (int x : nums) {
    sum += x;                           // or sum ^= x for XOR problems
    count += seen.getOrDefault(sum - k, 0);
    seen.merge(sum, 1, Integer::sum);
}
```
Longest subarray with sum 0: store `seen.putIfAbsent(sum, i)` and take `i - seen.get(sum)`.

## Complexity
O(n) build; O(1) per range query; O(n) space for the map.

## Pitfalls
- Forgetting the empty-prefix seed (`0 → 1` or `0 → -1` as an index).
- Overflow on large sums; use `long`.
- For 2-D grids, the inclusion–exclusion formula is `P[r2][c2] - P[r1][c2] - P[r2][c1] + P[r1][c1]`.

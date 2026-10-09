# Modified Binary Search

Halve the search space each step, not just to find a value in a sorted array, but on any monotonic yes/no condition, including "binary search on the answer".

## Spot it when
- Sorted or rotated-sorted input, a peak or mountain, a sorted matrix.
- "Find the minimum X such that condition(X) is true": capacity, speed, pages, distance (Koko bananas, Aggressive Cows, Allocate Pages).
- The expected complexity contains log n.

## The idea
Keep the invariant "the answer is in `[lo, hi]`". Compare `mid` and throw away the half that can't contain it. Rotated arrays: one half is always sorted, so check whether the target lies inside that half. Answer-space search: write `feasible(x)`, which is monotonic, and find the first `x` where it becomes true.

## Java template
```java
// First index where condition is true (lower bound). Works for "search on answer" too.
int lo = 0, hi = n;                      // hi is exclusive / "not found"
while (lo < hi) {
    int mid = lo + (hi - lo) / 2;
    if (condition(mid)) hi = mid;        // answer is mid or to the left
    else lo = mid + 1;
}
return lo;
```
Rotated array: `if (nums[lo] <= nums[mid])` the left half is sorted, so go left when `nums[lo] <= target < nums[mid]`, otherwise go right; mirror that for the right half.

## Complexity
O(log n) comparisons, or O(log range × cost of feasible) for answer-space search.

## Pitfalls
- `(lo + hi) / 2` overflow; use `lo + (hi - lo) / 2`.
- Infinite loops from mixing `lo <= hi` with `hi = mid`. Pick one template and stick to it.
- Duplicates in rotated arrays break the "one half is sorted" test; shrink with `lo++` when `nums[lo] == nums[mid] == nums[hi]`.
- Median of Two Sorted Arrays: binary-search the partition of the smaller array, not the values.

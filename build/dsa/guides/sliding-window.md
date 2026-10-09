# Sliding Window

Keep a contiguous window `[left, right]` and its running state; grow on the right, shrink on the left, and never re-scan what's inside.

## Spot it when
- The question is about a contiguous subarray or substring: longest, shortest, count, or "contains all of".
- There's a constraint you can update incrementally: sum ≤ k, at most k distinct characters, no repeats, a character multiset.
- The brute force recomputes something for every (start, end) pair.

## The idea
Fixed-size windows add the new element and drop the old one. Variable windows expand `right` every step, then shrink `left` while the window is invalid (for "longest" answers) or while it's still valid (for "shortest" answers). Keep the state in a counter map or `int[128]`.

## Java template
```java
int[] count = new int[128];
int left = 0, best = 0;
for (int right = 0; right < s.length(); right++) {
    count[s.charAt(right)]++;                      // add right
    while (windowInvalid(count)) {                 // shrink until valid
        count[s.charAt(left)]--;
        left++;
    }
    best = Math.max(best, right - left + 1);       // longest valid window
}
```
For "minimum window", update the answer inside the shrink loop while the window is still valid.

## Complexity
O(n): each index enters and leaves the window once. Space is O(alphabet) or O(k).

## Pitfalls
- Shrinking with `if` instead of `while`.
- Negative numbers break the "sum only grows" assumption; use prefix sums + hash map instead.
- Sliding window maximum needs a monotonic deque of indices (front = max, pop smaller values from the back).
- "Longest repeating character replacement": the window is valid while `length - maxFreq ≤ k`, and `maxFreq` never needs to decrease.

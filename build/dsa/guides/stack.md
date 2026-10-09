# Stack & Monotonic Stack

Use a stack when the most recent unmatched item decides what happens next; keep it monotonic (always increasing or decreasing) to find the next greater or smaller element in one pass.

## Spot it when
- Matching or nesting: parentheses, tags, undo, evaluating expressions.
- "Next greater/smaller element", "previous smaller", "how many days until warmer", stock span.
- Histogram/rectangle areas, or anything where each element needs the nearest boundary on each side.

## The idea
A monotonic stack holds indices whose answer isn't known yet. When a new value breaks the order, it *is* the answer for everything it pops. For the largest rectangle, popping bar `h` means the current index is its right boundary and the new stack top is its left boundary.

## Java template
```java
int[] nextGreater = new int[n];
Arrays.fill(nextGreater, -1);
Deque<Integer> st = new ArrayDeque<>();            // indices, values decreasing
for (int i = 0; i < n; i++) {
    while (!st.isEmpty() && nums[st.peek()] < nums[i]) nextGreater[st.pop()] = nums[i];
    st.push(i);
}
```
Largest rectangle: iterate `i = 0..n` with height 0 at `i == n`. On pop, `width = st.isEmpty() ? i : i - st.peek() - 1`.

## Complexity
O(n) time: every index is pushed and popped once. O(n) space.

## Pitfalls
- Store **indices**, not values, when you need distances or widths.
- Strict vs non-strict comparison (`<` vs `<=`) changes how equal values are handled; decide deliberately.
- Use `ArrayDeque`, not the legacy `Stack` class (synchronised and slower).
- Circular arrays: iterate `2n` times with `i % n`.

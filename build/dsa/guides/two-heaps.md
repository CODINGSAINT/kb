# Two Heaps

Split the elements into a max-heap for the smaller half and a min-heap for the larger half, so the median (or any "middle" boundary) is always at the heap tops.

## Spot it when
- Running median of a stream, or the median of a sliding window.
- Scheduling problems where you need the best of "available" items and the cheapest "locked" item (IPO, maximise capital).

## The idea
Keep `low` (max-heap) and `high` (min-heap) with every value in `low` ≤ every value in `high`, and sizes differing by at most one. Insert into `low`, move its top to `high`, then rebalance if `high` grew larger. The median is `low.peek()` or the average of both tops. For sliding windows, delete lazily: remember the values to remove and discard them when they reach a top.

## Java template
```java
PriorityQueue<Integer> low = new PriorityQueue<>(Collections.reverseOrder());
PriorityQueue<Integer> high = new PriorityQueue<>();
void add(int x) {
    low.offer(x);
    high.offer(low.poll());
    if (high.size() > low.size()) low.offer(high.poll());
}
double median() {
    return low.size() > high.size() ? low.peek() : ((long) low.peek() + high.peek()) / 2.0;
}
```

## Complexity
O(log n) per insert, O(1) median. Sliding-window median is O(n log k) with lazy deletion (or a `TreeMap`-based multiset).

## Pitfalls
- Overflow when averaging two large ints; widen to `long` first.
- `PriorityQueue.remove(Object)` is O(k); fine for an interview, but name lazy deletion as the faster option.
- Follow-up: values in 0..100 means bucket counts make every operation O(1).

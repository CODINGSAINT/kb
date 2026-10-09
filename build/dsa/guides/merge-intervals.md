# Merge Intervals

Sort intervals by start, then sweep once, merging or counting overlaps as you go.

## Spot it when
- Input is a list of `[start, end]` pairs: meetings, bookings, ranges, balloons.
- You need to merge overlaps, insert a new range, find gaps (free time), count simultaneous events (rooms/platforms), or remove the fewest intervals to stop overlaps.

## The idea
After sorting by start, two intervals overlap exactly when `next.start <= current.end`. Merge by extending `current.end = max(current.end, next.end)`. For "minimum removals" or "arrows", sort by **end** and greedily keep the interval that finishes first. For "max concurrent", sweep start and end times separately, or keep a min-heap of end times.

## Java template
```java
Arrays.sort(iv, (a, b) -> Integer.compare(a[0], b[0]));
List<int[]> out = new ArrayList<>();
for (int[] cur : iv) {
    if (out.isEmpty() || out.get(out.size() - 1)[1] < cur[0]) out.add(cur);
    else out.get(out.size() - 1)[1] = Math.max(out.get(out.size() - 1)[1], cur[1]);
}
```
Rooms needed:
```java
PriorityQueue<Integer> ends = new PriorityQueue<>();
for (int[] m : sortedByStart) { if (!ends.isEmpty() && ends.peek() <= m[0]) ends.poll(); ends.add(m[1]); }
return ends.size();
```

## Complexity
O(n log n) for the sort; the sweep is O(n). Heap variants are O(n log n).

## Pitfalls
- Touching intervals (`[1,2]` and `[2,3]`): settle whether they overlap before coding.
- `a[0] - b[0]` comparators overflow on large values; use `Integer.compare`.
- Sorting by start vs by end matters: merging needs start; greedy "keep the most" needs end.

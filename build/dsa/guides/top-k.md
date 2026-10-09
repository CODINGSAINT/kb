# Top K Elements & Heaps

Keep a heap of size k: a **min**-heap for the k largest, a **max**-heap for the k smallest. Each new element costs O(log k) and the heap holds the answer.

## Spot it when
- "k largest / smallest / most frequent / closest", the k-th largest in an array or stream.
- Greedy scheduling that always takes the currently most frequent item (reorganise string, task scheduler).
- You need repeated access to the current max or min while items change.

## The idea
To keep the k largest, push each item into a min-heap and pop whenever its size exceeds k; the top is then the k-th largest. For frequencies, count with a map first. Quickselect averages O(n) for a single k-th element, and bucket sort by frequency is O(n) for "top k frequent".

## Java template
```java
PriorityQueue<Integer> heap = new PriorityQueue<>();      // min-heap
for (int x : nums) {
    heap.offer(x);
    if (heap.size() > k) heap.poll();                     // drop the smallest
}
return heap.peek();                                       // k-th largest
// By frequency:
Map<Integer, Integer> f = new HashMap<>();
for (int x : nums) f.merge(x, 1, Integer::sum);
PriorityQueue<Integer> h = new PriorityQueue<>(Comparator.comparingInt(f::get));
```

## Complexity
O(n log k) time, O(k) space. Quickselect: O(n) average, O(n²) worst. Bucket sort: O(n).

## Pitfalls
- Using a max-heap of everything (O(n log n)) when a size-k heap is enough.
- Comparator subtraction overflow (`(a, b) -> b - a`); use `Integer.compare` or `Collections.reverseOrder()`.
- Task scheduler has a closed-form answer: `max(n, (maxFreq - 1) * (gap + 1) + countOfMaxFreq)`.

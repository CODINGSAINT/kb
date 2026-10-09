# K-way Merge

Merge k sorted sources by keeping one "current head" per source in a min-heap: pop the smallest, then push the next element from the same source.

## Spot it when
- k sorted lists or arrays to merge, or the k-th smallest across them.
- A sorted matrix (rows sorted), or pairs from two sorted arrays with the smallest sums.
- The smallest range that covers an element from every list.

## The idea
The heap holds at most k entries `(value, source, index)`. Each pop yields the next element in global order, and you push that source's successor. For the "smallest range", also track the current max of the heap's members; the range is `[heap.peek(), max]`, and you stop when any list runs out.

## Java template
```java
PriorityQueue<ListNode> pq = new PriorityQueue<>(Comparator.comparingInt(n -> n.val));
for (ListNode head : lists) if (head != null) pq.offer(head);
ListNode dummy = new ListNode(0), tail = dummy;
while (!pq.isEmpty()) {
    ListNode n = pq.poll();
    tail.next = n; tail = n;
    if (n.next != null) pq.offer(n.next);
}
return dummy.next;
// Arrays: pq of int[]{value, listIndex, elementIndex}
```

## Complexity
O(N log k) for N total elements, with O(k) heap space. Divide-and-conquer pairwise merging is also O(N log k).

## Pitfalls
- Pushing every element up front: O(N log N) time and memory.
- K-th smallest in a sorted matrix can also be solved by binary search on the value range; mention both.
- Find K Pairs with Smallest Sums: seed with `(i, 0)` for the first k values of `i`, then push `(i, j+1)` to avoid duplicates.

# In-place Linked List Manipulation

Rewire `next` pointers as you walk, usually with a dummy head and the three-pointer reverse, instead of copying nodes into a list.

## Spot it when
- Reverse all of a list, a sublist (m..n), or every k-group; swap pairs; rotate; partition odd/even.
- Merge, remove, or add numbers stored in lists, with O(1) extra space expected.

## The idea
Reversal walks with `prev`, `curr` and `next`: save `next`, point `curr` back at `prev`, advance. A **dummy** node before the head removes every "what if the head changes?" special case. For sublist reversal, stop at the node before the segment, reverse the segment, then stitch both ends back.

## Java template
```java
ListNode reverse(ListNode head) {
    ListNode prev = null, cur = head;
    while (cur != null) {
        ListNode next = cur.next;
        cur.next = prev;
        prev = cur;
        cur = next;
    }
    return prev;
}
// Dummy head + "gap" pointers (remove N-th from end):
ListNode dummy = new ListNode(0, head), fast = dummy, slow = dummy;
for (int i = 0; i <= n; i++) fast = fast.next;
while (fast != null) { fast = fast.next; slow = slow.next; }
slow.next = slow.next.next;
return dummy.next;
```

## Complexity
O(n) time, O(1) extra space (recursive versions use O(n) stack).

## Pitfalls
- Losing the rest of the list by overwriting `next` before saving it.
- Off-by-one when stopping before a segment; draw three nodes on paper first.
- Copy List with Random Pointer: either a `HashMap<old,new>` or interleave copies (`A → A' → B → B'`) for O(1) space.

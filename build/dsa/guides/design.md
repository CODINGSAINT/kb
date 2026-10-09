# Design Data Structures

Combine basic structures so every operation hits a target complexity: a hash map for O(1) lookup, a linked list for O(1) ordering changes, and stacks/queues for LIFO/FIFO behaviour.

## Spot it when
- "Design a class with get/put/... in O(1)": LRU, LFU, Min Stack, Max Frequency Stack.
- Implement one structure with another: a queue from two stacks, a stack from queues, a heap from an array.

## The idea
- **LRU**: `HashMap<key, node>` plus a doubly linked list with dummy head and tail. `get` moves a node to the front; `put` evicts the tail. (Java's `LinkedHashMap(cap, 0.75f, true)` with `removeEldestEntry` does this in a few lines; say so, but be ready to build it by hand.)
- **LFU**: `key → node`, `freq → doubly linked list` and a running `minFreq`; on access, move the node to the `freq + 1` list.
- **Min Stack**: push `(value, currentMin)` pairs, or keep a second stack of minimums.
- **Queue with two stacks**: push onto `in`; pop from `out`, refilling it from `in` only when it's empty (amortised O(1)).

## Java template
```java
class LRUCache {
    class Node { int k, v; Node prev, next; Node(int k, int v) { this.k = k; this.v = v; } }
    final Map<Integer, Node> map = new HashMap<>();
    final Node head = new Node(0, 0), tail = new Node(0, 0);
    final int cap;
    LRUCache(int cap) { this.cap = cap; head.next = tail; tail.prev = head; }
    void unlink(Node n) { n.prev.next = n.next; n.next.prev = n.prev; }
    void addFront(Node n) { n.next = head.next; n.prev = head; head.next.prev = n; head.next = n; }
    public int get(int k) { Node n = map.get(k); if (n == null) return -1; unlink(n); addFront(n); return n.v; }
    public void put(int k, int v) {
        Node n = map.get(k);
        if (n != null) { n.v = v; unlink(n); addFront(n); return; }
        if (map.size() == cap) { Node lru = tail.prev; unlink(lru); map.remove(lru.k); }
        n = new Node(k, v); map.put(k, n); addFront(n);
    }
}
```

## Complexity
State the target per operation (here O(1) for both `get` and `put`) and O(capacity) space.

## Pitfalls
- Forgetting to remove the evicted key from the map.
- LFU ties: evict the **least recently used** node within the minimum frequency.
- Thread safety is a common follow-up: mention a lock or `ConcurrentHashMap` and what it does to the O(1) guarantees.

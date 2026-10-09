# Topological Sort

Order the nodes of a directed acyclic graph so every edge points forward. Kahn's algorithm repeatedly removes nodes with in-degree 0; if some never reach 0, there's a cycle.

## Spot it when
- Prerequisites or dependencies: course schedule, build order, task ordering.
- Deriving an order from comparisons (Alien Dictionary).
- Detecting a cycle in a **directed** graph.
- Minimum height trees: peel leaves layer by layer, which is topological sort on an undirected tree.

## The idea
Compute in-degrees and queue every node with in-degree 0. Pop a node, append it to the order, and decrement its neighbours, queueing any that hit 0. If the order contains fewer than V nodes, a cycle exists. The DFS version adds a node to the order after visiting all its descendants, and uses three colours (unvisited, visiting, done) to detect cycles.

## Java template
```java
List<List<Integer>> adj = new ArrayList<>();
for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
int[] indeg = new int[n];
for (int[] e : edges) { adj.get(e[1]).add(e[0]); indeg[e[0]]++; }   // e = [course, prereq]
Deque<Integer> q = new ArrayDeque<>();
for (int i = 0; i < n; i++) if (indeg[i] == 0) q.offer(i);
List<Integer> order = new ArrayList<>();
while (!q.isEmpty()) {
    int u = q.poll(); order.add(u);
    for (int v : adj.get(u)) if (--indeg[v] == 0) q.offer(v);
}
boolean hasCycle = order.size() < n;
```

## Complexity
O(V + E) time and space.

## Pitfalls
- Getting the edge direction backwards (`[a, b]` means "b before a" in Course Schedule).
- Alien Dictionary: compare adjacent words only up to the first differing character, and flag `"abc"` before `"ab"` as invalid.
- If the topological order must be unique, the queue must never hold more than one node at a time.

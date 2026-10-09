# Shortest Paths, MST & SCC

Weighted graphs need more than plain BFS. Dijkstra and Bellman-Ford find shortest paths, Floyd-Warshall finds all pairs, Prim and Kruskal build minimum spanning trees, and Kosaraju finds strongly connected components.

## Spot it when
- "Cheapest / fastest / minimum cost" path with weighted edges (network delay, flights within k stops).
- Connect all points or cities at minimum total cost.
- Negative edge weights, or detecting a negative cycle (Bellman-Ford).
- Groups where every node reaches every other in a directed graph (SCC).

## The idea
- **Dijkstra** (non-negative weights): a min-heap of `(dist, node)`; pop the closest node and relax its edges; skip stale heap entries.
- **Bellman-Ford**: relax every edge V-1 times; a relaxation on round V means a negative cycle. Running exactly k+1 rounds gives "at most k stops".
- **Floyd-Warshall**: `dist[i][j] = min(dist[i][j], dist[i][k] + dist[k][j])` for every intermediate `k`.
- **Prim** grows one tree from a min-heap of crossing edges; **Kruskal** sorts the edges and adds each one that joins two components (Union-Find).
- **Kosaraju**: DFS to get the finish order, reverse the graph, then DFS in reverse finish order; each tree is one SCC.

## Java template
```java
int[] dist = new int[n]; Arrays.fill(dist, Integer.MAX_VALUE); dist[src] = 0;
PriorityQueue<int[]> pq = new PriorityQueue<>(Comparator.comparingInt(a -> a[0]));
pq.offer(new int[]{0, src});
while (!pq.isEmpty()) {
    int[] top = pq.poll(); int d = top[0], u = top[1];
    if (d > dist[u]) continue;                         // stale entry
    for (int[] e : adj.get(u)) {                       // e = {v, w}
        if (d + e[1] < dist[e[0]]) { dist[e[0]] = d + e[1]; pq.offer(new int[]{dist[e[0]], e[0]}); }
    }
}
```

## Complexity
Dijkstra O((V + E) log V); Bellman-Ford O(V·E); Floyd-Warshall O(V³); Prim/Kruskal O(E log E); Kosaraju O(V + E).

## Pitfalls
- Dijkstra fails with negative weights; say so and switch to Bellman-Ford.
- Forgetting the stale-entry check makes Dijkstra slow, though still correct.
- Overflow when adding to `Integer.MAX_VALUE`; check for "unreached" before adding.
- On an unweighted graph BFS is enough; with 0/1 weights, use 0-1 BFS with a deque.

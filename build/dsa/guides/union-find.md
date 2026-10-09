# Union-Find

Track which elements are connected with a disjoint-set forest. `find` returns a set's root and `union` links two roots, both in near-constant time.

## Spot it when
- Count connected components, or check whether a graph is a valid tree (exactly n-1 edges and no cycle).
- Edges arrive one at a time and you must answer "are these connected yet?" (Kruskal's MST, redundant connection, accounts merge).
- Grouping equivalent items (synonyms, equations).

## The idea
Every node points to a parent, and a root points to itself. `find` follows parents up, compressing the path as it goes. `union` attaches the smaller tree under the larger one (by size or rank). If two endpoints of a new edge already share a root, that edge creates a cycle.

## Java template
```java
int[] parent, size;
int find(int x) { return parent[x] == x ? x : (parent[x] = find(parent[x])); }   // path compression
boolean union(int a, int b) {
    int ra = find(a), rb = find(b);
    if (ra == rb) return false;                    // already connected: cycle edge
    if (size[ra] < size[rb]) { int t = ra; ra = rb; rb = t; }
    parent[rb] = ra; size[ra] += size[rb];
    components--;
    return true;
}
```

## Complexity
O(α(n)) amortised per operation (effectively constant); O(n) space.

## Pitfalls
- Skipping union by size/rank: path compression alone is fine in practice, but give both for full marks.
- Graph Valid Tree: also check `edges.length == n - 1`.
- Union-Find handles undirected connectivity only, not directed reachability.

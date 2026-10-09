# Graph BFS / DFS

Model the problem as nodes and edges (grids count), then flood out with DFS or BFS while marking nodes visited. BFS gives the shortest path when every edge has weight 1.

## Spot it when
- Grid "islands", flood fill, connected regions, cells reachable from the borders.
- Shortest number of steps or minutes with equal-cost moves (rotting oranges: multi-source BFS).
- Cloning a graph, bipartite checks (2-colouring), cycle detection in an undirected graph.

## The idea
Build an adjacency list (or use 4-directional moves on a grid). For each unvisited node, start a traversal that marks everything it reaches; the number of starts is the number of components. Multi-source BFS pushes all sources at once, so the BFS "layer" equals the elapsed time.

## Java template
```java
int[][] DIRS = {{1,0},{-1,0},{0,1},{0,-1}};
int bfs(char[][] g, int sr, int sc) {
    Deque<int[]> q = new ArrayDeque<>();
    q.offer(new int[]{sr, sc}); g[sr][sc] = '0';            // mark when enqueued
    int steps = 0;
    while (!q.isEmpty()) {
        for (int s = q.size(); s > 0; s--) {
            int[] c = q.poll();
            for (int[] d : DIRS) {
                int r = c[0] + d[0], k = c[1] + d[1];
                if (r < 0 || k < 0 || r >= g.length || k >= g[0].length || g[r][k] != '1') continue;
                g[r][k] = '0'; q.offer(new int[]{r, k});
            }
        }
        steps++;
    }
    return steps;
}
```
Undirected cycle check: in DFS, a visited neighbour that isn't the parent means a cycle.

## Complexity
O(V + E) time (O(rows × cols) on a grid). O(V) space for the visited set and queue/stack.

## Pitfalls
- Marking visited when **dequeued** instead of when **enqueued**, which adds duplicates to the queue.
- Deep DFS recursion on large grids can overflow Java's stack; switch to BFS or an explicit stack.
- Pacific Atlantic: search from the oceans inwards (reverse the edge direction), not from every cell outwards.

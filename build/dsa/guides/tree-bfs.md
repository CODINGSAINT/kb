# Tree BFS

Visit a tree level by level with a queue; snapshot the queue size to know where each level ends.

## Spot it when
- Anything "per level": level order, zigzag, averages, right/left/top/bottom view, width.
- Minimum depth or nearest node: BFS finds the shallowest answer first.
- Connecting next-right pointers, distance-K from a node (after adding parent links), serialising a tree.

## The idea
Push the root. For each level, read `size = queue.size()`, then poll exactly that many nodes, pushing their children. Track a horizontal index for vertical/top/bottom views (left child `2i` / `col - 1`, right child `2i + 1` / `col + 1`) and the level for width.

## Java template
```java
List<List<Integer>> levels = new ArrayList<>();
Deque<TreeNode> q = new ArrayDeque<>();
if (root != null) q.offer(root);
while (!q.isEmpty()) {
    int size = q.size();
    List<Integer> level = new ArrayList<>(size);
    for (int i = 0; i < size; i++) {
        TreeNode node = q.poll();
        level.add(node.val);
        if (node.left != null) q.offer(node.left);
        if (node.right != null) q.offer(node.right);
    }
    levels.add(level);
}
```

## Complexity
O(n) time; O(w) space where w is the widest level (up to n/2).

## Pitfalls
- Reading `q.size()` inside the loop condition while the queue grows.
- Width of a binary tree: positional indices overflow on deep skewed trees; re-base each level (`index - firstIndexOfLevel`).
- Vertical order (LeetCode 987) breaks ties by value within the same row and column, so sort those groups.

# Tree DFS

Recurse into children and combine their results on the way back up (post-order), or pass state down (pre-order). Most tree problems are one of the two.

## Spot it when
- Height, diameter, balance, max path sum: compute something from both subtrees, then combine.
- Root-to-leaf paths and path sums: carry the running state down, and undo it on return.
- Construct a tree from traversals, LCA, flatten, invert, compare or mirror trees.

## The idea
Decide what each call **returns** to its parent versus what it **records** globally. Diameter: return height, record `left + right`. Max path sum: return the best single downward branch (`max(0, …)`), record `node + left + right`. For "any path summing to K" (Path Sum III), combine DFS with prefix sums.

## Java template
```java
int best = Integer.MIN_VALUE;
int gain(TreeNode node) {                 // returns best downward path starting here
    if (node == null) return 0;
    int l = Math.max(0, gain(node.left));
    int r = Math.max(0, gain(node.right));
    best = Math.max(best, node.val + l + r);   // path that bends here
    return node.val + Math.max(l, r);
}
```
Path state (pre-order with backtracking):
```java
void dfs(TreeNode n, int sum, List<Integer> path) {
    if (n == null) return;
    path.add(n.val); sum -= n.val;
    if (n.left == null && n.right == null && sum == 0) result.add(new ArrayList<>(path));
    dfs(n.left, sum, path); dfs(n.right, sum, path);
    path.remove(path.size() - 1);          // undo
}
```

## Complexity
O(n) time; O(h) recursion stack (O(log n) when balanced, O(n) when skewed).

## Pitfalls
- Mixing up "returned to the parent" with "best overall"; they differ in diameter and max path sum.
- Forgetting to copy the path list before adding it to the results.
- Build from preorder + inorder: keep a `value → inorder index` map so each lookup is O(1).
- Morris traversal gives O(1) space by temporarily threading right pointers; restore them.

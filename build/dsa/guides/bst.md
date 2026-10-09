# Binary Search Tree

Use the ordering (left < node < right) to discard half the tree at each step, and remember that an in-order traversal visits values in sorted order.

## Spot it when
- Search, insert, floor/ceil, predecessor/successor, LCA in a BST.
- k-th smallest/largest, validating a BST, a BST iterator, two-sum on a BST.
- Building a BST from preorder or a sorted array.

## The idea
Walk down: go left if the target is smaller, right if it's larger. That's O(h) instead of O(n). Validation passes a `(low, high)` window down rather than comparing only with the parent. k-th smallest is an in-order walk that stops at k. An iterator keeps a stack of the "left spine" so `next()` is amortised O(1).

## Java template
```java
boolean valid(TreeNode n, long lo, long hi) {
    if (n == null) return true;
    if (n.val <= lo || n.val >= hi) return false;
    return valid(n.left, lo, n.val) && valid(n.right, n.val, hi);
}
// Iterator: push the left spine, pop to visit, then push the left spine of the right child
Deque<TreeNode> st = new ArrayDeque<>();
void pushLeft(TreeNode n) { while (n != null) { st.push(n); n = n.left; } }
int next() { TreeNode n = st.pop(); pushLeft(n.right); return n.val; }
```

## Complexity
O(h) per search or insert, which degrades to O(n) on a skewed tree. In-order traversal is O(n).

## Pitfalls
- Validating only parent-child pairs misses a deep node that violates an ancestor's bound.
- Using `int` bounds when node values can equal `Integer.MIN_VALUE`/`MAX_VALUE`; use `long` or nullable bounds.
- LCA in a BST needs no recursion over both sides: walk down until the two targets split.

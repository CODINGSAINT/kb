# Backtracking

Explore a decision tree depth-first. Make a choice, recurse, undo it, and prune any branch that can no longer lead to a valid answer.

## Spot it when
- Constraint satisfaction: N-Queens, Sudoku, graph colouring, rat in a maze, word search on a grid.
- "All combinations that sum to target", generate valid parentheses, partition a string into palindromes, letter combinations.
- The search space is exponential but pruning cuts most of it.

## The idea
Every backtracking function has the same shape: **base case** (record a complete answer), **loop over choices**, **skip invalid choices early**, **choose → recurse → unchoose**. Good pruning (sorted candidates with `break` once the sum is exceeded, constant-time validity checks with boolean arrays or bitmasks) is what makes it pass.

## Java template
```java
void backtrack(int start, int remain, Deque<Integer> path) {
    if (remain == 0) { result.add(new ArrayList<>(path)); return; }
    for (int i = start; i < cand.length; i++) {
        if (cand[i] > remain) break;                       // pruning (cand sorted)
        if (i > start && cand[i] == cand[i - 1]) continue;  // no duplicate combos (Combination Sum II)
        path.addLast(cand[i]);
        backtrack(i + 1, remain - cand[i], path);           // i (not i+1) if reuse is allowed
        path.removeLast();
    }
}
```
N-Queens: track `cols`, `diag (r - c + n)` and `anti (r + c)` in boolean arrays for O(1) checks.

## Complexity
Exponential in the worst case; state it as roughly O(branching^depth) and explain how pruning helps.

## Pitfalls
- Forgetting to undo state (grid cells marked visited, used flags) after the recursive call.
- Word Search: mark the cell (`board[r][c] = '#'`) and restore it, instead of allocating a visited array each call.
- Word Search II: build a trie of the words and prune with it; searching each word separately times out.

# Subsets & Permutations

Build every combination by deciding, for each element, include or exclude (subsets), or which unused element goes next (permutations), using BFS-style growth or DFS with backtracking.

## Spot it when
- "All subsets / combinations / permutations / letter-case variants / abbreviations".
- The output size is exponential (2ⁿ or n!), so the algorithm can't beat it, only avoid waste.

## The idea
Subsets: start from `[[]]`; for each number, copy every existing subset and append the number. With duplicates, sort and only extend subsets created in the previous round. Permutations: DFS with a `used[]` array; with duplicates, skip `nums[i]` if it equals `nums[i-1]` and `nums[i-1]` isn't used at this depth.

## Java template
```java
void subsets(int start, int[] nums, Deque<Integer> cur, List<List<Integer>> out) {
    out.add(new ArrayList<>(cur));
    for (int i = start; i < nums.length; i++) {
        if (i > start && nums[i] == nums[i - 1]) continue;   // skip dup (nums sorted)
        cur.addLast(nums[i]);
        subsets(i + 1, nums, cur, out);
        cur.removeLast();
    }
}
void permute(int[] nums, boolean[] used, Deque<Integer> cur, List<List<Integer>> out) {
    if (cur.size() == nums.length) { out.add(new ArrayList<>(cur)); return; }
    for (int i = 0; i < nums.length; i++) {
        if (used[i] || (i > 0 && nums[i] == nums[i - 1] && !used[i - 1])) continue;
        used[i] = true; cur.addLast(nums[i]);
        permute(nums, used, cur, out);
        used[i] = false; cur.removeLast();
    }
}
```
Bitmask alternative for subsets: for `mask` in `0 .. 2ⁿ-1`, include `nums[i]` when bit `i` is set.

## Complexity
Subsets: O(n · 2ⁿ). Permutations: O(n · n!). Space is dominated by the output.

## Pitfalls
- Adding `cur` itself instead of a copy.
- Duplicate handling needs **sorted** input.
- k-th permutation sequence doesn't need generation: use factorials to choose each digit (O(n²)).

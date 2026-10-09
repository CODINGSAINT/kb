# Divide & Conquer (Merge Sort)

Split the input in half, solve each half recursively, and do the real work while merging. That's how inversion-style counts drop from O(n²) to O(n log n).

## Spot it when
- "Count pairs i < j with some relation" (inversions, reverse pairs, range sums).
- Sorting a linked list in O(n log n) with O(1) extra space.
- The answer for the whole can be built from answers for two halves plus a cross term.

## The idea
During merge sort, both halves are already sorted. Before merging, count cross pairs with two pointers: for each `i` in the left half, advance `j` in the right half while the condition holds. Each pair is counted exactly once, at the level where its two elements were split apart.

## Java template
```java
long sortCount(int[] a, int lo, int hi) {           // [lo, hi)
    if (hi - lo <= 1) return 0;
    int mid = (lo + hi) >>> 1;
    long cnt = sortCount(a, lo, mid) + sortCount(a, mid, hi);
    for (int i = lo, j = mid; i < mid; i++) {        // cross pairs (reverse pairs shown)
        while (j < hi && (long) a[i] > 2L * a[j]) j++;
        cnt += j - mid;
    }
    int[] tmp = new int[hi - lo];                     // standard merge
    for (int i = lo, j = mid, k = 0; k < tmp.length; k++)
        tmp[k] = (j >= hi || (i < mid && a[i] <= a[j])) ? a[i++] : a[j++];
    System.arraycopy(tmp, 0, a, lo, tmp.length);
    return cnt;
}
```

## Complexity
O(n log n) time, O(n) auxiliary space for arrays. Bottom-up merge sort on linked lists needs O(1).

## Pitfalls
- Counting during the merge instead of in a separate pass, when the counting condition differs from the sort order.
- Overflow: `a[i] > 2 * a[j]` must be computed in `long`.
- Alternatives worth mentioning: a Fenwick tree (BIT) over coordinate-compressed values.

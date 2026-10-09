# Two Pointers

Two indices move through a sorted array or string, usually from both ends toward each other, so a pair search costs O(n) instead of O(n²).

## Spot it when
- The input is sorted (or can be sorted) and you need a pair/triplet with a target sum or difference.
- You must compare or swap from both ends: palindromes, reversing, "container" and water-trapping problems.
- You're partitioning in place: move zeroes, Dutch national flag (sort 0/1/2), remove duplicates.

## The idea
Each step discards a candidate that can't be part of the answer. With `left` at the smallest and `right` at the largest, a sum that's too small can only be fixed by moving `left` right, and one that's too big by moving `right` left. For k-sum, fix one element and run two pointers on the rest.

## Java template
```java
Arrays.sort(nums);
int l = 0, r = nums.length - 1;
while (l < r) {
    int sum = nums[l] + nums[r];
    if (sum == target) { /* record */ l++; r--; while (l < r && nums[l] == nums[l - 1]) l++; }
    else if (sum < target) l++;
    else r--;
}
```
Read/write pointers for in-place filtering:
```java
int w = 0;
for (int x : nums) if (keep(x)) nums[w++] = x;   // w = new length
```

## Complexity
O(n) per pass after an O(n log n) sort; 3Sum is O(n²), 4Sum O(n³). O(1) extra space.

## Pitfalls
- Skipping duplicates at the wrong time, which loses valid answers or repeats them.
- Integer overflow in 4Sum; use `long` for the sum.
- Trapping rain water: move the side with the smaller max, because that side's water level is already decided.

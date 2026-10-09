# Greedy

Make the locally best choice at each step, and be ready to argue why it can never hurt (an exchange argument), because that proof is what interviewers probe.

## Spot it when
- Scheduling: fit the most meetings or activities (sort by end time), job sequencing by profit and deadline.
- Reachability and fuel: Jump Game (track the farthest reachable index), Gas Station (reset the start when the tank goes negative).
- Fractional knapsack (sort by value/weight), coin change with canonical denominations.

## The idea
Sort or prioritise by the key that makes the greedy choice safe, then take items in one pass. To justify it: assume an optimal solution that differs from yours, swap in your greedy choice, and show the result is no worse. If you can't make that argument, it's probably DP.

## Java template
```java
// Max non-overlapping activities: always keep the one that ends first.
Arrays.sort(acts, (a, b) -> Integer.compare(a[1], b[1]));
int count = 0, lastEnd = Integer.MIN_VALUE;
for (int[] a : acts) if (a[0] >= lastEnd) { count++; lastEnd = a[1]; }
// Jump Game
int far = 0;
for (int i = 0; i < nums.length && i <= far; i++) far = Math.max(far, i + nums[i]);
return far >= nums.length - 1;
```

## Complexity
Usually O(n log n) for the sort plus O(n) for the pass.

## Pitfalls
- Greedy coin change fails for arbitrary denominations (e.g. {1, 3, 4} for 6); use DP.
- 0/1 knapsack is **not** greedy; fractional knapsack is.
- Sorting by start time when the proof needs end time.

# Cyclic Sort

When values lie in a known range like 1..n, place each value at its "home" index by swapping; then any index holding the wrong value reveals a missing or duplicate number.

## Spot it when
- Array of n numbers in the range 1..n or 0..n, and you need the missing, duplicate, or first missing positive number.
- You're asked for O(n) time and O(1) extra space.

## The idea
For each index, keep swapping `nums[i]` into position `nums[i] - 1` until the current slot holds its correct value or a duplicate of it. One more pass finds every index `i` where `nums[i] != i + 1`.

## Java template
```java
int i = 0;
while (i < nums.length) {
    int home = nums[i] - 1;                        // value v belongs at v-1
    if (nums[i] > 0 && nums[i] <= nums.length && nums[i] != nums[home]) {
        int t = nums[i]; nums[i] = nums[home]; nums[home] = t;
    } else i++;
}
for (i = 0; i < nums.length; i++) if (nums[i] != i + 1) return i + 1;  // first missing
return nums.length + 1;
```

## Complexity
O(n) time (each swap fixes one value for good), O(1) space.

## Pitfalls
- Comparing `nums[i] != i + 1` instead of `nums[i] != nums[home]`, which loops forever on duplicates.
- Ignoring out-of-range values (≤ 0 or > n) in First Missing Positive.
- Alternatives worth naming: XOR or sum formulas for a single missing number; sign-marking (`nums[|v|-1] *= -1`) for duplicates.

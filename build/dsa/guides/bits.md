# Bitwise XOR & Bit Manipulation

Use bit tricks for O(1)-space answers. `x ^ x = 0` cancels pairs, `x & (x - 1)` clears the lowest set bit, and masks represent small sets.

## Spot it when
- Every element appears twice except one (or two): XOR everything.
- Count set bits, reverse bits, powers of two, add without `+`.
- Small sets (n ≤ 20) as bitmasks for subsets and DP over subsets.
- Maximum XOR pair: greedy bit by bit with a binary trie, or prefix masks.

## The idea
XOR is its own inverse and order doesn't matter, so pairs vanish. To split two unique numbers, XOR everything, take the lowest set bit (`diff & -diff`), and partition the numbers by that bit. Counting bits: `bits[i] = bits[i >> 1] + (i & 1)`.

## Java template
```java
int single = 0; for (int x : nums) single ^= x;            // Single Number
int count = 0; while (n != 0) { n &= n - 1; count++; }     // set bits (Kernighan)
boolean powerOfTwo = n > 0 && (n & (n - 1)) == 0;
int add(int a, int b) { while (b != 0) { int carry = (a & b) << 1; a ^= b; b = carry; } return a; }
for (int mask = 0; mask < (1 << n); mask++) { /* subset: bit i set => include i */ }
```

## Complexity
O(n) or O(number of bits); O(1) extra space.

## Pitfalls
- Java has no unsigned int: use `>>>` (logical shift) for Reverse Bits and Number of 1 Bits, and `Integer.bitCount` is fine to mention.
- Operator precedence: `(x & 1) == 0`, not `x & 1 == 0`.
- `1 << 31` is negative in Java; use `1L <<` when you need 32 or more bits.

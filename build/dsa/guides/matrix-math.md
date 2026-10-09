# Matrix, Math & Simulation

Some problems are mostly careful index bookkeeping: rotate or spiral a matrix, mark rows and columns in place, build Pascal's triangle, fast exponentiation, or combinatorics.

## Spot it when
- In-place matrix transforms: rotate 90°, set zeroes, spiral order, reshape 1-D ↔ 2-D.
- Number tricks: fast power, k-th permutation via factorials, Pascal's rows.

## The idea
- **Rotate 90° clockwise** = transpose, then reverse each row.
- **Set Matrix Zeroes in O(1) space**: use the first row and column as markers, plus one flag for whether the first column itself should be zeroed.
- **Spiral**: shrink four boundaries (`top`, `bottom`, `left`, `right`) after each side.
- **Fast power**: square the base and halve the exponent; handle negative `n` by inverting.

## Java template
```java
// Rotate in place
for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) { int t = m[i][j]; m[i][j] = m[j][i]; m[j][i] = t; }
for (int[] row : m) for (int l = 0, r = n - 1; l < r; l++, r--) { int t = row[l]; row[l] = row[r]; row[r] = t; }
// Fast power
double pow(double x, long n) {
    if (n < 0) { x = 1 / x; n = -n; }
    double res = 1;
    while (n > 0) { if ((n & 1) == 1) res *= x; x *= x; n >>= 1; }
    return res;
}
```

## Complexity
Matrix walks are O(rows × cols); fast power is O(log n).

## Pitfalls
- `Math.abs(Integer.MIN_VALUE)` is still negative; convert `n` to `long` first.
- Spiral order: guard against revisiting the last row or column when `top == bottom` or `left == right`.
- Set Matrix Zeroes: process the first row and column last, or you'll wipe out the markers.

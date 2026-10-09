# Strings & String Matching

Parse and transform strings carefully with `StringBuilder`. For substring search, use linear-time matching (KMP's prefix function, Z-function, or Rabin-Karp rolling hashes) instead of re-comparing from every position.

## Spot it when
- Find a pattern in text (strStr), repeated patterns, or the shortest palindrome by adding characters in front.
- Parsing and simulation: atoi, Roman numerals, version compare, count-and-say, reverse words.
- Encode/decode a list of strings, or count characters' contributions across all substrings.

## The idea
- **KMP**: `lps[i]` is the length of the longest proper prefix of the pattern that's also a suffix ending at `i`. On a mismatch, jump to `lps[j-1]` instead of restarting.
- **Z-function**: `z[i]` is the length of the longest substring starting at `i` that matches a prefix. Search `pattern + '$' + text`.
- **Rabin-Karp**: compare rolling hashes, and verify on a match to rule out collisions.
- **Shortest palindrome**: `lps` of `s + '#' + reverse(s)` gives the longest palindromic prefix.

## Java template
```java
int[] lps(String p) {
    int[] lps = new int[p.length()];
    for (int i = 1, len = 0; i < p.length(); ) {
        if (p.charAt(i) == p.charAt(len)) lps[i++] = ++len;
        else if (len > 0) len = lps[len - 1];
        else lps[i++] = 0;
    }
    return lps;
}
int strStr(String text, String p) {
    int[] lps = lps(p);
    for (int i = 0, j = 0; i < text.length(); ) {
        if (text.charAt(i) == p.charAt(j)) { i++; j++; if (j == p.length()) return i - j; }
        else if (j > 0) j = lps[j - 1];
        else i++;
    }
    return -1;
}
```
Encode/decode: length-prefix each string (`5#hello`), so any character, including the delimiter, is safe.

## Complexity
KMP and Z are O(n + m). Rabin-Karp is O(n + m) expected. Parsing problems are O(n).

## Pitfalls
- String concatenation in a loop (`+=`) is O(n²); use `StringBuilder`.
- atoi: skip leading spaces, read an optional sign, stop at the first non-digit, and clamp on overflow **before** it happens.
- Compare Version: split on `"\\."` (it's a regex) and treat missing parts as 0.

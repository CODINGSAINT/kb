# Trie

A prefix tree: each node has children per character plus an end-of-word flag, so prefix lookups cost O(word length) regardless of how many words are stored.

## Spot it when
- Prefix queries: autocomplete, "starts with", word dictionary with wildcards.
- Searching many words at once on a grid (Word Search II) or in a text (index pairs).
- Building words letter by letter (longest word with all prefixes, word squares).
- Bitwise tries for maximum XOR problems (0/1 children per bit, from the most significant bit down).

## The idea
Insert walks down, creating children as needed, and marks the last node. Search walks down and checks the flag; `startsWith` only needs the path to exist. For a grid, DFS from each cell while following trie children, and prune the moment the current prefix isn't in the trie. Store the word at the end node so you don't have to rebuild strings.

## Java template
```java
class Trie {
    Trie[] next = new Trie[26];
    String word;                                   // non-null at the end of a word
    void insert(String w) {
        Trie t = this;
        for (char c : w.toCharArray()) t = t.next[c - 'a'] == null ? (t.next[c - 'a'] = new Trie()) : t.next[c - 'a'];
        t.word = w;
    }
    Trie find(String prefix) {
        Trie t = this;
        for (char c : prefix.toCharArray()) if ((t = t.next[c - 'a']) == null) return null;
        return t;
    }
}
```
Max XOR: insert each number bit by bit (31 → 0); for each query, prefer the opposite bit at every level.

## Complexity
O(L) per insert/search; O(total characters × alphabet) space worst case. Word Search II is roughly O(cells × 4 × 3^(L-1)) with pruning.

## Pitfalls
- Using `HashMap` children when a fixed `[26]` array is simpler and faster (and vice versa for large alphabets).
- Word Search II: remove found words (set `word = null`) to avoid duplicates, and prune empty branches.
- Wildcard `.` search needs DFS over all children at that level.

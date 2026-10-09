#!/usr/bin/env node
// Builds content/dsa.json: the DSA track organised by coding-interview PATTERNS.
//
// Inputs (in build/dsa/):
//   problems.json       the master problem list (key, title, LeetCode slug, difficulty)
//   guides/<id>.md      one guide per pattern (how to spot it, Java template, pitfalls)
//
// Every problem is assigned to exactly one primary pattern below. Your saved data (answers, verdicts, notes,
// chats) is carried over by a stable `key`, so re-running this never loses work.
//   node build/make-dsa-patterns.js
const fs = require("fs");
// Personal fields belong in the data folder; keep empty ones out of content/ (legacy values are kept
// until the app moves them).
const { FIELDS: PERSONAL } = require("../lib/userdata");
const prune = (o) => { for (const k of PERSONAL) if (o[k] == null || o[k] === "" || (Array.isArray(o[k]) && !o[k].length)) delete o[k]; return o; };
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(__dirname, "dsa");
const OUT = path.join(ROOT, "content", "dsa.json");

// Learning order: earlier patterns are building blocks for later ones.
const PATTERNS = [
  ["arrays-hashing", "Arrays & Hashing"],
  ["two-pointers", "Two Pointers"],
  ["sliding-window", "Sliding Window"],
  ["prefix-sum", "Prefix Sum"],
  ["fast-slow", "Fast & Slow Pointers"],
  ["merge-intervals", "Merge Intervals"],
  ["cyclic-sort", "Cyclic Sort"],
  ["linked-list", "In-place Linked List Manipulation"],
  ["stack", "Stack & Monotonic Stack"],
  ["binary-search", "Modified Binary Search"],
  ["divide-conquer", "Divide & Conquer (Merge Sort)"],
  ["tree-bfs", "Tree BFS"],
  ["tree-dfs", "Tree DFS"],
  ["bst", "Binary Search Tree"],
  ["two-heaps", "Two Heaps"],
  ["top-k", "Top K Elements & Heaps"],
  ["k-way-merge", "K-way Merge"],
  ["subsets", "Subsets & Permutations"],
  ["backtracking", "Backtracking"],
  ["graphs", "Graph BFS / DFS"],
  ["topo-sort", "Topological Sort"],
  ["union-find", "Union-Find"],
  ["advanced-graphs", "Shortest Paths, MST & SCC"],
  ["greedy", "Greedy"],
  ["dp-1d", "DP: 1-D Sequences"],
  ["dp-knapsack", "DP: Knapsack"],
  ["dp-2d", "DP: Grids, Strings & Intervals"],
  ["bits", "Bitwise XOR & Bit Manipulation"],
  ["trie", "Trie"],
  ["strings", "Strings & String Matching"],
  ["matrix-math", "Matrix, Math & Simulation"],
  ["design", "Design Data Structures"],
];

// Primary pattern per problem. Key = LeetCode slug, or "classic-<name>" for problems with no exact LeetCode match.
const MAP = {
  // Arrays & Hashing
  "two-sum": "arrays-hashing", "contains-duplicate": "arrays-hashing", "group-anagrams": "arrays-hashing",
  "valid-anagram": "arrays-hashing", "majority-element": "arrays-hashing", "majority-element-ii": "arrays-hashing",
  "longest-consecutive-sequence": "arrays-hashing", "max-consecutive-ones": "arrays-hashing",
  "best-time-to-buy-and-sell-stock": "arrays-hashing",
  // Two pointers
  "3sum": "two-pointers", "4sum": "two-pointers", "3sum-closest": "two-pointers", "container-with-most-water": "two-pointers",
  "trapping-rain-water": "two-pointers", "remove-duplicates-from-sorted-array": "two-pointers", "sort-colors": "two-pointers",
  "next-permutation": "two-pointers", "move-zeroes": "two-pointers", "is-subsequence": "two-pointers",
  "backspace-string-compare": "two-pointers", "squares-of-a-sorted-array": "two-pointers", "valid-palindrome": "two-pointers",
  "rotate-array": "two-pointers", "find-the-celebrity": "two-pointers", "classic-merge-two-sorted-arrays-without-extra-space": "two-pointers",
  // Sliding window
  "longest-substring-without-repeating-characters": "sliding-window", "minimum-window-substring": "sliding-window",
  "substring-with-concatenation-of-all-words": "sliding-window", "minimum-size-subarray-sum": "sliding-window",
  "longest-repeating-character-replacement": "sliding-window", "permutation-in-string": "sliding-window",
  "maximum-average-subarray-i": "sliding-window", "subarray-product-less-than-k": "sliding-window",
  "fruit-into-baskets": "sliding-window", "sliding-window-maximum": "sliding-window", "classic-distinct-numbers-in-every-window": "sliding-window",
  // Prefix sum
  "product-of-array-except-self": "prefix-sum", "range-sum-query-immutable": "prefix-sum",
  "classic-largest-subarray-with-0-sum": "prefix-sum", "classic-count-subarrays-with-given-xor-k": "prefix-sum",
  // Fast & slow
  "linked-list-cycle": "fast-slow", "linked-list-cycle-ii": "fast-slow", "middle-of-the-linked-list": "fast-slow",
  "palindrome-linked-list": "fast-slow", "reorder-list": "fast-slow", "find-the-duplicate-number": "fast-slow",
  // Merge intervals
  "merge-intervals": "merge-intervals", "insert-interval": "merge-intervals", "non-overlapping-intervals": "merge-intervals",
  "meeting-rooms": "merge-intervals", "meeting-rooms-ii": "merge-intervals", "minimum-number-of-arrows-to-burst-balloons": "merge-intervals",
  "interval-list-intersections": "merge-intervals", "employee-free-time": "merge-intervals", "classic-minimum-number-of-platforms": "merge-intervals",
  // Cyclic sort
  "first-missing-positive": "cyclic-sort", "missing-number": "cyclic-sort", "find-all-duplicates-in-an-array": "cyclic-sort",
  "find-all-numbers-disappeared-in-an-array": "cyclic-sort", "set-mismatch": "cyclic-sort",
  // Linked list
  "reverse-linked-list": "linked-list", "reverse-linked-list-ii": "linked-list", "reverse-nodes-in-k-group": "linked-list",
  "swap-nodes-in-pairs": "linked-list", "rotate-list": "linked-list", "odd-even-linked-list": "linked-list",
  "remove-duplicates-from-sorted-list": "linked-list", "remove-linked-list-elements": "linked-list",
  "merge-two-sorted-lists": "linked-list", "remove-nth-node-from-end-of-list": "linked-list", "add-two-numbers": "linked-list",
  "delete-node-in-a-linked-list": "linked-list", "intersection-of-two-linked-lists": "linked-list",
  "copy-list-with-random-pointer": "linked-list",
  // Stack
  "valid-parentheses": "stack", "next-greater-element-i": "stack", "largest-rectangle-in-histogram": "stack",
  "online-stock-span": "stack", "classic-sort-a-stack": "stack", "classic-next-smaller-element": "stack", "classic-maximum-of-minimums-of-every-window-size": "stack",
  // Binary search
  "binary-search": "binary-search", "search-in-rotated-sorted-array": "binary-search", "search-in-rotated-sorted-array-ii": "binary-search",
  "find-minimum-in-rotated-sorted-array": "binary-search", "find-peak-element": "binary-search", "peak-index-in-a-mountain-array": "binary-search",
  "search-a-2d-matrix": "binary-search", "search-a-2d-matrix-ii": "binary-search", "single-element-in-a-sorted-array": "binary-search",
  "median-of-two-sorted-arrays": "binary-search", "find-k-closest-elements": "binary-search", "find-smallest-letter-greater-than-target": "binary-search",
  "classic-n-th-root-of-an-integer": "binary-search", "classic-matrix-median": "binary-search", "classic-k-th-element-of-two-sorted-arrays": "binary-search", "classic-allocate-minimum-number-of-pages": "binary-search", "classic-aggressive-cows": "binary-search",
  // Divide & conquer
  "sort-list": "divide-conquer", "reverse-pairs": "divide-conquer", "count-of-range-sum": "divide-conquer", "classic-count-inversions": "divide-conquer",
  // Tree BFS
  "binary-tree-level-order-traversal": "tree-bfs", "binary-tree-level-order-traversal-ii": "tree-bfs", "binary-tree-zigzag-level-order-traversal": "tree-bfs",
  "average-of-levels-in-binary-tree": "tree-bfs", "minimum-depth-of-binary-tree": "tree-bfs", "binary-tree-right-side-view": "tree-bfs",
  "populating-next-right-pointers-in-each-node": "tree-bfs", "maximum-width-of-binary-tree": "tree-bfs",
  "vertical-order-traversal-of-a-binary-tree": "tree-bfs", "all-nodes-distance-k-in-binary-tree": "tree-bfs",
  "serialize-and-deserialize-binary-tree": "tree-bfs", "classic-left-view-of-a-binary-tree": "tree-bfs", "classic-bottom-view-of-a-binary-tree": "tree-bfs", "classic-top-view-of-a-binary-tree": "tree-bfs",
  // Tree DFS
  "binary-tree-inorder-traversal": "tree-dfs", "binary-tree-preorder-traversal": "tree-dfs", "binary-tree-postorder-traversal": "tree-dfs",
  "maximum-depth-of-binary-tree": "tree-dfs", "diameter-of-binary-tree": "tree-dfs", "balanced-binary-tree": "tree-dfs",
  "lowest-common-ancestor-of-a-binary-tree": "tree-dfs", "same-tree": "tree-dfs", "symmetric-tree": "tree-dfs", "invert-binary-tree": "tree-dfs",
  "boundary-of-binary-tree": "tree-dfs", "binary-tree-maximum-path-sum": "tree-dfs", "flatten-binary-tree-to-linked-list": "tree-dfs",
  "construct-binary-tree-from-preorder-and-inorder-traversal": "tree-dfs", "construct-binary-tree-from-inorder-and-postorder-traversal": "tree-dfs",
  "path-sum": "tree-dfs", "path-sum-ii": "tree-dfs", "path-sum-iii": "tree-dfs", "binary-tree-paths": "tree-dfs",
  "subtree-of-another-tree": "tree-dfs", "merge-two-binary-trees": "tree-dfs", "maximum-binary-tree": "tree-dfs",
  "classic-morris-inorder-traversal": "tree-dfs", "classic-morris-preorder-traversal": "tree-dfs", "classic-pre-in-and-post-order-in-one-traversal": "tree-dfs", "classic-root-to-node-path": "tree-dfs", "classic-children-sum-property": "tree-dfs", "classic-binary-tree-to-doubly-linked-list": "tree-dfs",
  // BST
  "search-in-a-binary-search-tree": "bst", "construct-binary-search-tree-from-preorder-traversal": "bst", "validate-binary-search-tree": "bst",
  "lowest-common-ancestor-of-a-binary-search-tree": "bst", "kth-smallest-element-in-a-bst": "bst", "two-sum-iv-input-is-a-bst": "bst",
  "binary-search-tree-iterator": "bst", "largest-bst-subtree": "bst",
  "classic-inorder-predecessor-and-successor-in-bst": "bst", "classic-floor-in-a-bst": "bst", "classic-ceil-in-a-bst": "bst", "classic-k-th-largest-element-in-a-bst": "bst",
  // Two heaps
  "find-median-from-data-stream": "two-heaps", "sliding-window-median": "two-heaps",
  // Top K
  "kth-largest-element-in-an-array": "top-k", "kth-largest-element-in-a-stream": "top-k", "top-k-frequent-elements": "top-k",
  "k-closest-points-to-origin": "top-k", "sort-characters-by-frequency": "top-k", "reorganize-string": "top-k",
  "rearrange-string-k-distance-apart": "top-k", "task-scheduler": "top-k", "classic-implement-max-heap-min-heap": "top-k",
  // K-way merge
  "merge-k-sorted-lists": "k-way-merge", "find-k-pairs-with-smallest-sums": "k-way-merge", "kth-smallest-element-in-a-sorted-matrix": "k-way-merge",
  "smallest-range-covering-elements-from-k-lists": "k-way-merge", "classic-flattening-a-linked-list": "k-way-merge", "classic-maximum-sum-combination": "k-way-merge", "classic-merge-k-sorted-arrays": "k-way-merge",
  // Subsets & permutations
  "subsets": "subsets", "subsets-ii": "subsets", "permutations": "subsets", "permutations-ii": "subsets", "combinations": "subsets",
  "letter-case-permutation": "subsets", "generalized-abbreviation": "subsets", "classic-subset-sums": "subsets",
  // Backtracking
  "combination-sum": "backtracking", "combination-sum-ii": "backtracking", "combination-sum-iii": "backtracking",
  "palindrome-partitioning": "backtracking", "n-queens": "backtracking", "sudoku-solver": "backtracking", "word-break-ii": "backtracking",
  "letter-combinations-of-a-phone-number": "backtracking", "generate-parentheses": "backtracking", "word-search": "backtracking",
  "factor-combinations": "backtracking", "partition-to-k-equal-sum-subsets": "backtracking", "classic-m-coloring-problem": "backtracking", "classic-rat-in-a-maze": "backtracking",
  // Graphs
  "clone-graph": "graphs", "number-of-islands": "graphs", "is-graph-bipartite": "graphs", "flood-fill": "graphs", "rotting-oranges": "graphs",
  "pacific-atlantic-water-flow": "graphs", "classic-depth-first-search": "graphs", "classic-breadth-first-search": "graphs", "classic-detect-cycle-in-undirected-graph-bfs": "graphs", "classic-detect-cycle-in-undirected-graph-dfs": "graphs",
  // Topological sort
  "course-schedule": "topo-sort", "course-schedule-ii": "topo-sort", "alien-dictionary": "topo-sort", "minimum-height-trees": "topo-sort",
  "classic-detect-cycle-in-directed-graph-dfs": "topo-sort", "classic-detect-cycle-in-directed-graph-bfs": "topo-sort", "classic-topological-sort-bfs-kahn-s": "topo-sort", "classic-topological-sort-dfs": "topo-sort",
  // Union-Find
  "graph-valid-tree": "union-find", "number-of-connected-components-in-an-undirected-graph": "union-find",
  // Advanced graphs
  "classic-strongly-connected-components-kosaraju": "advanced-graphs", "classic-dijkstra-s-algorithm": "advanced-graphs", "classic-bellman-ford-algorithm": "advanced-graphs", "classic-floyd-warshall-algorithm": "advanced-graphs",
  "classic-mst-using-prim-s-algorithm": "advanced-graphs", "classic-mst-using-kruskal-s-algorithm": "advanced-graphs",
  // Greedy
  "jump-game": "greedy", "gas-station": "greedy", "classic-n-meetings-in-one-room": "greedy", "classic-job-sequencing-problem": "greedy", "classic-fractional-knapsack": "greedy",
  "classic-minimum-coins-greedy": "greedy", "classic-activity-selection": "greedy",
  // DP 1-D
  "climbing-stairs": "dp-1d", "house-robber": "dp-1d", "house-robber-ii": "dp-1d", "decode-ways": "dp-1d", "maximum-subarray": "dp-1d",
  "maximum-product-subarray": "dp-1d", "longest-increasing-subsequence": "dp-1d", "number-of-longest-increasing-subsequence": "dp-1d",
  "word-break": "dp-1d", "concatenated-words": "dp-1d", "best-time-to-buy-and-sell-stock-with-cooldown": "dp-1d",
  "maximum-profit-in-job-scheduling": "dp-1d", "classic-maximum-sum-increasing-subsequence": "dp-1d",
  // DP knapsack
  "partition-equal-subset-sum": "dp-knapsack", "target-sum": "dp-knapsack", "coin-change": "dp-knapsack", "combination-sum-iv": "dp-knapsack",
  "classic-0-1-knapsack": "dp-knapsack", "classic-subset-sum-problem": "dp-knapsack", "classic-rod-cutting": "dp-knapsack",
  // DP 2-D
  "unique-paths": "dp-2d", "minimum-path-sum": "dp-2d", "longest-common-subsequence": "dp-2d", "edit-distance": "dp-2d",
  "longest-palindromic-substring": "dp-2d", "palindromic-substrings": "dp-2d", "palindrome-partitioning-ii": "dp-2d",
  "super-egg-drop": "dp-2d", "classic-matrix-chain-multiplication": "dp-2d",
  // Bits
  "single-number": "bits", "counting-bits": "bits", "number-of-1-bits": "bits", "reverse-bits": "bits", "sum-of-two-integers": "bits",
  // Trie
  "implement-trie-prefix-tree": "trie", "implement-trie-ii-prefix-tree": "trie", "word-search-ii": "trie", "design-add-and-search-words-data-structure": "trie",
  "longest-word-in-dictionary": "trie", "prefix-and-suffix-search": "trie", "word-squares": "trie", "design-search-autocomplete-system": "trie",
  "index-pairs-of-a-string": "trie", "maximum-xor-of-two-numbers-in-an-array": "trie", "maximum-xor-with-an-element-from-array": "trie",
  "classic-longest-word-with-all-prefixes": "trie", "classic-number-of-distinct-substrings": "trie",
  // Strings
  "reverse-words-in-a-string": "strings", "roman-to-integer": "strings", "string-to-integer-atoi": "strings",
  "find-the-index-of-the-first-occurrence-in-a-string": "strings", "longest-common-prefix": "strings", "count-and-say": "strings",
  "compare-version-numbers": "strings", "encode-and-decode-strings": "strings", "count-unique-characters-of-all-substrings-of-a-given-string": "strings",
  "classic-rabin-karp-string-matching": "strings", "classic-z-function": "strings", "classic-kmp-algorithm-lps-array": "strings", "classic-min-characters-to-insert-at-front-to-make-palindrome": "strings",
  // Matrix, math & simulation
  "set-matrix-zeroes": "matrix-math", "pascals-triangle": "matrix-math", "rotate-image": "matrix-math", "spiral-matrix": "matrix-math",
  "convert-1d-array-into-2d-array": "matrix-math", "powx-n": "matrix-math", "permutation-sequence": "matrix-math",
  // Design
  "lru-cache": "design", "lfu-cache": "design", "min-stack": "design", "implement-queue-using-stacks": "design",
  "implement-stack-using-queues": "design", "maximum-frequency-stack": "design", "classic-implement-stack-using-arrays": "design", "classic-implement-queue-using-arrays": "design",
};

const RANK = { Easy: 0, Medium: 1, Hard: 2 };

// ---------- load ----------
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const master = read(path.join(SRC, "problems.json")).problems;
const old = fs.existsSync(OUT) ? read(OUT) : { topics: [] };

// Saved user data from the current dsa.json, by key (or by LeetCode slug for very old files).
const USER_FIELDS = ["notes", "userAnswer", "answerEvaluation", "answerEvaluatedAt", "chat"];
const saved = new Map();
for (const tp of old.topics || []) for (const p of tp.problems || []) {
  const has = USER_FIELDS.some((f) => (Array.isArray(p[f]) ? p[f].length : p[f]));
  if (!has) continue;
  const slug = /problems\/([^/]+)/.exec(p.leetcodeUrl || "")?.[1];
  const key = p.key || slug || `n-${p.number}`;
  if (saved.has(key)) {
    // Two old entries for one problem (e.g. both bipartite variants): keep both answers.
    const a = saved.get(key);
    for (const f of ["notes", "userAnswer"]) if (p[f] && p[f] !== a[f]) a[f] = [a[f], p[f]].filter(Boolean).join("\n\n---\n\n");
    if (Array.isArray(p.chat)) a.chat = [...(a.chat || []), ...p.chat];
    if (!a.answerEvaluation && p.answerEvaluation) { a.answerEvaluation = p.answerEvaluation; a.answerEvaluatedAt = p.answerEvaluatedAt; }
  } else saved.set(key, Object.fromEntries(USER_FIELDS.map((f) => [f, p[f]])));
}

// ---------- merge ----------
const items = new Map(); // key -> problem
for (const q of master) items.set(q.key, { ...q });

const unmapped = [...items.keys()].filter((k) => !MAP[k]);
if (unmapped.length) { console.error("No pattern for:", unmapped.join(", ")); process.exit(1); }
const ids = new Set(PATTERNS.map((p) => p[0]));
const bad = Object.entries(MAP).filter(([, v]) => !ids.has(v));
if (bad.length) { console.error("Unknown pattern ids:", bad.map((b) => b.join(" -> ")).join(", ")); process.exit(1); }

// ---------- guides ----------
function guideFor(id) {
  const f = path.join(SRC, "guides", `${id}.md`);
  if (!fs.existsSync(f)) return { summary: "", guide: "" };
  const md = fs.readFileSync(f, "utf8").trim() + "\n";
  // First non-heading paragraph = one-line summary for the sidebar and pattern list.
  const summary = (md.split(/\n\s*\n/).find((b) => b.trim() && !b.trim().startsWith("#")) || "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  return { summary, guide: md };
}

// ---------- assemble ----------
let n = 0;
const topics = PATTERNS.map(([id, name]) => {
  const probs = [...items.values()].filter((it) => MAP[it.key] === id)
    .sort((a, b) => (RANK[a.difficulty] ?? 1.5) - (RANK[b.difficulty] ?? 1.5) || a.title.localeCompare(b.title));
  return {
    id, name, ...guideFor(id),
    problems: probs.map((it) => {
      const u = saved.get(it.key) || {};
      const p = {
        number: ++n, key: it.key, title: it.title,
        leetcodeUrl: it.slug ? `https://leetcode.com/problems/${it.slug}/` : null,
        difficulty: it.difficulty, premium: it.premium || undefined,
        notes: u.notes || "", userAnswer: u.userAnswer || "",
        answerEvaluation: u.answerEvaluation ?? null, answerEvaluatedAt: u.answerEvaluatedAt ?? null,
      };
      if (Array.isArray(u.chat) && u.chat.length) p.chat = u.chat;
      if (!p.premium) delete p.premium;
      saved.delete(it.key);
      return prune(p);
    }),
  };
});

if (saved.size) { console.error("Saved work with no matching problem (not written):", [...saved.keys()].join(", ")); process.exit(1); }

const out = {
  source: "Coding-interview patterns with a guide per pattern.",
  topics,
};
const tmp = OUT + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n");
fs.renameSync(tmp, OUT);
const kept = topics.reduce((s, t) => s + t.problems.filter((p) => p.userAnswer || p.notes || p.chat).length, 0);
console.log(`wrote ${path.relative(ROOT, OUT)}: ${n} problems in ${topics.length} patterns; carried over saved work on ${kept} problem(s)`);
const noGuide = topics.filter((t) => !t.guide).map((t) => t.id);
if (noGuide.length) console.log("patterns without a guide yet:", noGuide.join(", "));

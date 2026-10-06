# Generates content/dsa.json from Striver's SDE Sheet, regrouped by topic.
# Slug = LeetCode problem slug when a confident 1:1 match exists, else None.
import json, sys, os
T = {
"Arrays": [
 ("Set Matrix Zeroes","set-matrix-zeroes"),("Pascal's Triangle","pascals-triangle"),("Next Permutation","next-permutation"),
 ("Maximum Subarray (Kadane's Algorithm)","maximum-subarray"),("Sort an Array of 0s, 1s and 2s","sort-colors"),
 ("Best Time to Buy and Sell Stock","best-time-to-buy-and-sell-stock"),("Rotate Matrix","rotate-image"),
 ("Merge Overlapping Subintervals","merge-intervals"),("Merge Two Sorted Arrays Without Extra Space",None),
 ("Find the Duplicate Number","find-the-duplicate-number"),("Repeat and Missing Number","set-mismatch"),
 ("Count Inversions",None),("Search in a 2D Matrix","search-a-2d-matrix"),("Pow(x, n)","powx-n"),
 ("Majority Element (> n/2 times)","majority-element"),("Majority Element (> n/3 times)","majority-element-ii"),
 ("Grid Unique Paths","unique-paths"),("Reverse Pairs","reverse-pairs"),
],
"Hashing & Two Pointers": [
 ("Two Sum","two-sum"),("4Sum","4sum"),("Longest Consecutive Sequence","longest-consecutive-sequence"),
 ("Largest Subarray with 0 Sum",None),("Count Subarrays with Given XOR K",None),
 ("Longest Substring Without Repeating Characters","longest-substring-without-repeating-characters"),
 ("3Sum","3sum"),("Trapping Rain Water","trapping-rain-water"),
 ("Remove Duplicates from Sorted Array","remove-duplicates-from-sorted-array"),("Max Consecutive Ones","max-consecutive-ones"),
],
"Linked List": [
 ("Reverse a Linked List","reverse-linked-list"),("Middle of the Linked List","middle-of-the-linked-list"),
 ("Merge Two Sorted Lists","merge-two-sorted-lists"),("Remove N-th Node from End of List","remove-nth-node-from-end-of-list"),
 ("Add Two Numbers as Linked Lists","add-two-numbers"),("Delete a Node When Only the Node Is Given","delete-node-in-a-linked-list"),
 ("Intersection of Two Linked Lists","intersection-of-two-linked-lists"),("Detect a Cycle in a Linked List","linked-list-cycle"),
 ("Reverse Nodes in k-Group","reverse-nodes-in-k-group"),("Palindrome Linked List","palindrome-linked-list"),
 ("Starting Point of the Loop","linked-list-cycle-ii"),("Flattening a Linked List",None),("Rotate a Linked List","rotate-list"),
 ("Clone a Linked List with Random Pointers","copy-list-with-random-pointer"),
],
"Greedy": [
 ("N Meetings in One Room",None),("Minimum Number of Platforms",None),("Job Sequencing Problem",None),
 ("Fractional Knapsack",None),("Minimum Coins (Greedy)",None),("Activity Selection",None),
],
"Recursion & Backtracking": [
 ("Subset Sums",None),("Subsets II","subsets-ii"),("Combination Sum","combination-sum"),("Combination Sum II","combination-sum-ii"),
 ("Palindrome Partitioning","palindrome-partitioning"),("K-th Permutation Sequence","permutation-sequence"),
 ("Print All Permutations","permutations"),("N-Queens","n-queens"),("Sudoku Solver","sudoku-solver"),
 ("M-Coloring Problem",None),("Rat in a Maze",None),("Word Break II (Print All Ways)","word-break-ii"),
],
"Binary Search": [
 ("N-th Root of an Integer",None),("Matrix Median",None),("Single Element in a Sorted Array","single-element-in-a-sorted-array"),
 ("Search in Rotated Sorted Array","search-in-rotated-sorted-array"),("Median of Two Sorted Arrays","median-of-two-sorted-arrays"),
 ("K-th Element of Two Sorted Arrays",None),("Allocate Minimum Number of Pages",None),("Aggressive Cows",None),
],
"Heaps": [
 ("Implement Max-Heap / Min-Heap",None),("K-th Largest Element in an Array","kth-largest-element-in-an-array"),
 ("Maximum Sum Combination",None),("Find Median from Data Stream","find-median-from-data-stream"),
 ("Merge K Sorted Arrays",None),("Top K Frequent Elements","top-k-frequent-elements"),
 ("K-th Largest Element in a Stream","kth-largest-element-in-a-stream"),("Distinct Numbers in Every Window",None),
],
"Stack & Queue": [
 ("Implement Stack Using Arrays",None),("Implement Queue Using Arrays",None),
 ("Implement Stack Using Queues","implement-stack-using-queues"),("Implement Queue Using Stacks","implement-queue-using-stacks"),
 ("Valid Parentheses","valid-parentheses"),("Next Greater Element","next-greater-element-i"),("Sort a Stack",None),
 ("Next Smaller Element",None),("LRU Cache","lru-cache"),("LFU Cache","lfu-cache"),
 ("Largest Rectangle in Histogram","largest-rectangle-in-histogram"),("Sliding Window Maximum","sliding-window-maximum"),
 ("Min Stack","min-stack"),("Rotting Oranges","rotting-oranges"),("Stock Span Problem","online-stock-span"),
 ("Maximum of Minimums of Every Window Size",None),("The Celebrity Problem","find-the-celebrity"),
],
"Strings": [
 ("Reverse Words in a String","reverse-words-in-a-string"),("Longest Palindromic Substring","longest-palindromic-substring"),
 ("Roman to Integer (and vice versa)","roman-to-integer"),("Implement atoi","string-to-integer-atoi"),
 ("Implement strStr","find-the-index-of-the-first-occurrence-in-a-string"),
 ("Longest Common Prefix","longest-common-prefix"),("Rabin-Karp String Matching",None),("Z-Function",None),
 ("KMP Algorithm / LPS Array",None),("Min Characters to Insert at Front to Make Palindrome",None),
 ("Valid Anagram","valid-anagram"),("Count and Say","count-and-say"),("Compare Version Numbers","compare-version-numbers"),
],
"Binary Tree": [
 ("Inorder Traversal","binary-tree-inorder-traversal"),("Preorder Traversal","binary-tree-preorder-traversal"),
 ("Postorder Traversal","binary-tree-postorder-traversal"),("Morris Inorder Traversal",None),("Morris Preorder Traversal",None),
 ("Left View of a Binary Tree",None),("Bottom View of a Binary Tree",None),("Top View of a Binary Tree",None),
 ("Pre, In and Post Order in One Traversal",None),("Vertical Order Traversal","vertical-order-traversal-of-a-binary-tree"),
 ("Root to Node Path",None),("Maximum Width of Binary Tree","maximum-width-of-binary-tree"),
 ("Level Order Traversal","binary-tree-level-order-traversal"),("Height of a Binary Tree","maximum-depth-of-binary-tree"),
 ("Diameter of Binary Tree","diameter-of-binary-tree"),("Check if a Binary Tree Is Balanced","balanced-binary-tree"),
 ("Lowest Common Ancestor of a Binary Tree","lowest-common-ancestor-of-a-binary-tree"),
 ("Check if Two Trees Are Identical","same-tree"),("Zigzag Level Order Traversal","binary-tree-zigzag-level-order-traversal"),
 ("Boundary Traversal","boundary-of-binary-tree"),("Binary Tree Maximum Path Sum","binary-tree-maximum-path-sum"),
 ("Construct Tree from Preorder and Inorder","construct-binary-tree-from-preorder-and-inorder-traversal"),
 ("Construct Tree from Inorder and Postorder","construct-binary-tree-from-inorder-and-postorder-traversal"),
 ("Symmetric Tree","symmetric-tree"),("Flatten Binary Tree to Linked List","flatten-binary-tree-to-linked-list"),
 ("Mirror of a Binary Tree","invert-binary-tree"),("Children Sum Property",None),
 ("Populating Next Right Pointers","populating-next-right-pointers-in-each-node"),
 ("Serialize and Deserialize Binary Tree","serialize-and-deserialize-binary-tree"),("Binary Tree to Doubly Linked List",None),
],
"Binary Search Tree": [
 ("Search in a BST","search-in-a-binary-search-tree"),("Construct BST from Preorder","construct-binary-search-tree-from-preorder-traversal"),
 ("Validate Binary Search Tree","validate-binary-search-tree"),("LCA in a BST","lowest-common-ancestor-of-a-binary-search-tree"),
 ("Inorder Predecessor and Successor in BST",None),("Floor in a BST",None),("Ceil in a BST",None),
 ("K-th Smallest Element in a BST","kth-smallest-element-in-a-bst"),("K-th Largest Element in a BST",None),
 ("Two Sum in a BST","two-sum-iv-input-is-a-bst"),("BST Iterator","binary-search-tree-iterator"),
 ("Largest BST in a Binary Tree","largest-bst-subtree"),
],
"Graphs": [
 ("Clone Graph","clone-graph"),("Depth-First Search",None),("Breadth-First Search",None),
 ("Detect Cycle in Undirected Graph (BFS)",None),("Detect Cycle in Undirected Graph (DFS)",None),
 ("Detect Cycle in Directed Graph (DFS)",None),("Detect Cycle in Directed Graph (BFS)",None),
 ("Topological Sort (BFS / Kahn's)",None),("Topological Sort (DFS)",None),("Number of Islands","number-of-islands"),
 ("Bipartite Check (BFS)","is-graph-bipartite"),("Bipartite Check (DFS)","is-graph-bipartite"),("Flood Fill","flood-fill"),
 ("Strongly Connected Components (Kosaraju)",None),("Dijkstra's Algorithm",None),("Bellman-Ford Algorithm",None),
 ("Floyd-Warshall Algorithm",None),("MST using Prim's Algorithm",None),("MST using Kruskal's Algorithm",None),
],
"Dynamic Programming": [
 ("Maximum Product Subarray","maximum-product-subarray"),("Longest Increasing Subsequence","longest-increasing-subsequence"),
 ("Longest Common Subsequence","longest-common-subsequence"),("0/1 Knapsack",None),("Edit Distance","edit-distance"),
 ("Maximum Sum Increasing Subsequence",None),("Matrix Chain Multiplication",None),("Minimum Path Sum","minimum-path-sum"),
 ("Coin Change","coin-change"),("Subset Sum Problem",None),("Rod Cutting",None),("Egg Dropping","super-egg-drop"),
 ("Word Break","word-break"),("Palindrome Partitioning II","palindrome-partitioning-ii"),
 ("Maximum Profit in Job Scheduling","maximum-profit-in-job-scheduling"),
],
"Trie": [
 ("Implement Trie (Prefix Tree)","implement-trie-prefix-tree"),("Implement Trie II","implement-trie-ii-prefix-tree"),
 ("Longest Word with All Prefixes",None),("Number of Distinct Substrings",None),("Power Set (Bit Manipulation)","subsets"),
 ("Maximum XOR of Two Numbers in an Array","maximum-xor-of-two-numbers-in-an-array"),
 ("Maximum XOR With an Element From Array","maximum-xor-with-an-element-from-array"),
],
}
out = {"source": "Striver's SDE Sheet, regrouped by topic. Reconstructed from knowledge; LeetCode links only where a confident 1:1 match exists, otherwise null.", "topics": []}
n = 0
for name, probs in T.items():
    ps = []
    for title, slug in probs:
        n += 1
        ps.append({"number": n, "title": title, "leetcodeUrl": f"https://leetcode.com/problems/{slug}/" if slug else None,
                   "notes": "", "userAnswer": "", "answerEvaluation": None, "answerEvaluatedAt": None})
    out["topics"].append({"name": name, "problems": ps})
json.dump(out, open(sys.argv[1], "w"), indent=2); open(sys.argv[1], "a").write("\n")
print(n, "problems,", sum(1 for t in out["topics"] for p in t["problems"] if p["leetcodeUrl"]), "linked")
print("\n".join(sorted({p["leetcodeUrl"] for t in out["topics"] for p in t["problems"] if p["leetcodeUrl"]})), file=open(sys.argv[1]+".urls","w"))

# Arrays & Hashing

Trade memory for time: remember what you've already seen in a hash map or set, so each new element is answered in O(1) instead of another scan.

## Spot it when
- The brute force is a nested loop asking "have I seen X before?" or "how many times does X appear?"
- You need complements (`target - x`), duplicates, frequencies or groupings (anagrams share a sorted key).
- Order doesn't matter, but membership or counts do.

## The idea
Walk the array once. For each element, ask the map the question the inner loop used to answer, then record the element. Choose the key carefully: the value itself, a sorted string, a character-count signature, or `value → index`.

## Java template
```java
Map<Integer, Integer> seen = new HashMap<>();      // value -> index (or count)
for (int i = 0; i < nums.length; i++) {
    int need = target - nums[i];
    if (seen.containsKey(need)) return new int[]{seen.get(need), i};
    seen.put(nums[i], i);                           // record AFTER checking
}
```
Frequency count: `freq.merge(x, 1, Integer::sum);`. For lowercase letters, an `int[26]` is faster than a map.

## Complexity
O(n) time, O(n) extra space. Sorting first is the O(n log n), O(1)-space alternative; say both in an interview.

## Pitfalls
- Checking after inserting, so an element pairs with itself.
- Boxing overhead: `Map<Integer,Integer>` on large inputs; arrays win when the key range is small.
- Boyer–Moore voting (majority element) and "start of a run" tricks (longest consecutive sequence: only start counting when `x - 1` is absent) keep space at O(1) or time at O(n).

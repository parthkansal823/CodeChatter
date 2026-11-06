import assert from "node:assert/strict";
import { test } from "node:test";

import { fingerprints, shapeOf, similarPairs, type CodeEntry } from "./similarity";

const SOLUTION = `
def merge(left, right):
    result = []
    i = 0
    j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            result.append(left[i])
            i += 1
        else:
            result.append(right[j])
            j += 1
    result.extend(left[i:])
    result.extend(right[j:])
    return result

def merge_sort(items):
    if len(items) <= 1:
        return items
    middle = len(items) // 2
    return merge(merge_sort(items[:middle]), merge_sort(items[middle:]))
`;
const RENAMED = `
# My own work, honest
def combine(a, b):
    out = []
    x = 0
    y = 0
    while x < len(a) and y < len(b):
        if a[x] <= b[y]:
            out.append(a[x])
            x += 1
        else:
            out.append(b[y])
            y += 1
    out.extend(a[x:])
    out.extend(b[y:])
    return out

def sort_it(values):
    if len(values) <= 1:
        return values
    half = len(values) // 2
    return combine(sort_it(values[:half]), sort_it(values[half:]))
`;
const DIFFERENT = `
import heapq

def smallest(numbers, k):
    heap = list(numbers)
    heapq.heapify(heap)
    answer = []
    for _ in range(k):
        if not heap:
            break
        answer.append(heapq.heappop(heap))
    total = sum(answer)
    average = total / max(1, len(answer))
    text = ", ".join(str(value) for value in answer)
    print(f"{text} ({average})")
    return answer
`;
const entry = (id: string, code: string, starter = ""): CodeEntry => ({ id, name: id.toUpperCase(), code, starter });

test("the shape ignores names, numbers, strings, comments and spacing", () => {
  assert.deepEqual(shapeOf('total = 1 + count  # adds\nprint("hi")'), shapeOf("sum=99+n\nprint('bye')"));
});

test("a keyword stays itself, so different code keeps a different shape", () => {
  assert.notDeepEqual(shapeOf("if a: return b"), shapeOf("for a: return b"));
});

test("the same code has the same fingerprints", () => {
  assert.deepEqual(fingerprints(SOLUTION), fingerprints(SOLUTION));
  assert.ok(fingerprints(SOLUTION).size > 12);
});

test("renaming everything doesn't hide a copy", () => {
  const [pair] = similarPairs([entry("ana", SOLUTION), entry("ben", RENAMED)]);
  assert.ok(pair, "they should match");
  assert.ok(pair.overlap > 0.9, `overlap ${pair.overlap}`);
  assert.deepEqual(pair.names, ["ANA", "BEN"]);
});

test("different solutions don't match", () => {
  assert.deepEqual(similarPairs([entry("ana", SOLUTION), entry("cy", DIFFERENT)]), []);
});

test("sharing only the starter code isn't copying", () => {
  assert.deepEqual(similarPairs([entry("ana", SOLUTION, SOLUTION), entry("ben", RENAMED, RENAMED)]), []);
  assert.deepEqual(similarPairs([entry("ana", `${SOLUTION}\n${DIFFERENT}`, SOLUTION), entry("ben", SOLUTION, SOLUTION)]), []);
});

test("too little code proves nothing", () => {
  assert.deepEqual(similarPairs([entry("ana", "print(1)"), entry("ben", "print(1)")]), []);
});

test("what most of the group has is boilerplate", () => {
  const group = ["a", "b", "c", "d", "e"].map((id) => entry(id, SOLUTION));
  assert.deepEqual(similarPairs(group), []);
});

test("the most alike come first", () => {
  const partial = `${SOLUTION.slice(0, SOLUTION.length / 2)}\n${DIFFERENT}`;
  const pairs = similarPairs([entry("ana", SOLUTION), entry("ben", RENAMED), entry("cy", partial)], 0.1);
  assert.equal(pairs[0]!.a, "ana");
  assert.equal(pairs[0]!.b, "ben");
  for (let i = 1; i < pairs.length; i++) assert.ok(pairs[i - 1]!.overlap >= pairs[i]!.overlap);
});

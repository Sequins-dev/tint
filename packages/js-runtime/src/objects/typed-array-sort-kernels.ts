/** Default TypedArray SortCompare on Number values: NaN sorts last and -0
 * precedes +0. No user code runs, so these kernels may use any algorithm. */
export function compareTypedArrayNumbers(left: number, right: number): number {
  if (left !== left) return right !== right ? 0 : 1;
  if (right !== right) return -1;
  if (left < right) return -1;
  if (left > right) return 1;
  if (left === 0 && right === 0) {
    const leftSign = 1 / left,
      rightSign = 1 / right;
    return leftSign < rightSign ? -1 : leftSign > rightSign ? 1 : 0;
  }
  return 0;
}
const insertionRun = 16;
/** Sort numbers in place by compareTypedArrayNumbers: insertion-sorted runs,
 * then bottom-up merges through one scratch copy. */
export function sortTypedArrayNumbers(values: number[]): void {
  const length = values.length;
  for (let start = 0; start < length; start += insertionRun) {
    const end = Math.min(start + insertionRun, length);
    for (let i = start + 1; i < end; i++) {
      const value = values[i];
      if (value === undefined) throw "TYPED_ARRAY_SORT_RUN_INVARIANT";
      let j = i - 1;
      while (j >= start) {
        const previous = values[j];
        if (previous === undefined) throw "TYPED_ARRAY_SORT_RUN_INVARIANT";
        if (compareTypedArrayNumbers(previous, value) <= 0) break;
        values[j + 1] = previous;
        j--;
      }
      values[j + 1] = value;
    }
  }
  if (length <= insertionRun) return;
  let source: number[] = values,
    target: number[] = values.slice();
  for (let width: number = insertionRun; width < length; width *= 2) {
    for (let lower = 0; lower < length; lower += 2 * width) {
      const middle = Math.min(lower + width, length),
        upper = Math.min(lower + 2 * width, length);
      let left = lower,
        right = middle,
        out = lower;
      while (left < middle && right < upper) {
        const a = source[left],
          b = source[right];
        if (a === undefined || b === undefined)
          throw "TYPED_ARRAY_SORT_MERGE_INVARIANT";
        if (compareTypedArrayNumbers(b, a) < 0) {
          target[out] = b;
          right++;
        } else {
          target[out] = a;
          left++;
        }
        out++;
      }
      while (left < middle) {
        const a = source[left];
        if (a === undefined) throw "TYPED_ARRAY_SORT_MERGE_INVARIANT";
        target[out] = a;
        left++;
        out++;
      }
      while (right < upper) {
        const b = source[right];
        if (b === undefined) throw "TYPED_ARRAY_SORT_MERGE_INVARIANT";
        target[out] = b;
        right++;
        out++;
      }
    }
    const merged = target;
    target = source;
    source = merged;
  }
  if (source !== values)
    for (let i = 0; i < length; i++) {
      const value = source[i];
      if (value === undefined) throw "TYPED_ARRAY_SORT_COPY_INVARIANT";
      values[i] = value;
    }
}
/** Sort integers known to lie in [minimum, minimum + range) by counting. */
export function countingSortIntegers(
  values: number[],
  minimum: number,
  range: number,
): void {
  const counts: number[] = [];
  for (let slot = 0; slot < range; slot++) counts.push(0);
  for (const value of values) {
    if (value === undefined) throw "TYPED_ARRAY_COUNT_INVARIANT";
    const slot = value - minimum,
      count = counts[slot];
    if (count === undefined) throw "TYPED_ARRAY_COUNT_RANGE_INVARIANT";
    counts[slot] = count + 1;
  }
  let index = 0;
  for (let slot = 0; slot < range; slot++) {
    const stored = counts[slot];
    if (stored === undefined) throw "TYPED_ARRAY_COUNT_INVARIANT";
    const value = slot + minimum;
    let count: number = stored;
    while (count > 0) {
      values[index] = value;
      index++;
      count--;
    }
  }
}

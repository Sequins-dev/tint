export interface IndexedAccess<T> {
  readonly length: () => number;
  readonly has: (index: number) => boolean;
  readonly read: (index: number) => T | undefined;
  readonly write: (index: number, value: T | undefined) => void;
  readonly remove: (index: number) => void;
}
interface Entry<T> {
  readonly value: T;
  next: Entry<T> | undefined;
}
/** Stable comparator sort over an indexed collection. No writes until comparisons finish. */
export function sortIndexed<T>(
  access: IndexedAccess<T>,
  compare: (a: T, b: T) => number,
): void {
  const length = access.length();
  if (!Number.isInteger(length) || length < 0 || length > 9007199254740991)
    throw "INVALID_LENGTH";
  let head: Entry<T> | undefined;
  let tail: Entry<T> | undefined;
  let count = 0,
    absent = 0;
  for (let i = 0; i < length; i++) {
    if (!access.has(i)) continue;
    const value = access.read(i);
    if (value === undefined) {
      absent++;
      continue;
    }
    const entry: Entry<T> = { value, next: undefined };
    if (tail === undefined) head = entry;
    else tail.next = entry;
    tail = entry;
    count++;
  }
  for (let width = 1; width < count; width *= 2) {
    let source = head;
    head = undefined;
    tail = undefined;
    while (source !== undefined) {
      let left: Entry<T> | undefined = source,
        right: Entry<T> | undefined = source;
      let leftCount = 0,
        rightCount = width;
      for (let i = 0; i < width && right !== undefined; i++) {
        leftCount++;
        right = right.next;
      }
      while (leftCount > 0 || (rightCount > 0 && right !== undefined)) {
        let chosen: Entry<T>;
        if (leftCount === 0) {
          if (right === undefined) throw "right run invariant";
          chosen = right;
          right = right.next;
          rightCount--;
        } else if (rightCount === 0 || right === undefined) {
          if (left === undefined) throw "left run invariant";
          chosen = left;
          left = left.next;
          leftCount--;
        } else {
          if (left === undefined) throw "left run invariant";
          if (compare(right.value, left.value) < 0) {
            chosen = right;
            right = right.next;
            rightCount--;
          } else {
            chosen = left;
            left = left.next;
            leftCount--;
          }
        }
        if (tail === undefined) head = chosen;
        else tail.next = chosen;
        tail = chosen;
      }
      source = right;
    }
    if (tail !== undefined) tail.next = undefined;
  }
  let current = head,
    index = 0;
  while (current !== undefined) {
    access.write(index, current.value);
    index++;
    current = current.next;
  }
  for (let i = 0; i < absent; i++) {
    access.write(index, undefined);
    index++;
  }
  while (index < length) {
    access.remove(index);
    index++;
  }
}

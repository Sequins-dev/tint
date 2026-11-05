/** An AVL tree stores only present indexed properties, including undefined values. */
interface ListEntry<T> {
  index: number;
  value: T;
  height: number;
  left: ListEntry<T> | undefined;
  right: ListEntry<T> | undefined;
}
/** Implementation state; callers mutate through the exported operations. */
export interface SparseList<T> {
  length: number;
  root: ListEntry<T> | undefined;
}
function validIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff;
}
function height<T>(node: ListEntry<T> | undefined): number {
  return node === undefined ? 0 : node.height;
}
function updateHeight<T>(node: ListEntry<T>): void {
  const left = height<T>(node.left),
    right = height<T>(node.right);
  node.height = 1 + (left > right ? left : right);
}
function rotateLeft<T>(node: ListEntry<T>): ListEntry<T> {
  const next = node.right;
  if (next === undefined) throw "LIST_TREE_INVARIANT";
  node.right = next.left;
  next.left = node;
  updateHeight<T>(node);
  updateHeight<T>(next);
  return next;
}
function rotateRight<T>(node: ListEntry<T>): ListEntry<T> {
  const next = node.left;
  if (next === undefined) throw "LIST_TREE_INVARIANT";
  node.left = next.right;
  next.right = node;
  updateHeight<T>(node);
  updateHeight<T>(next);
  return next;
}
function balance<T>(node: ListEntry<T>): ListEntry<T> {
  updateHeight<T>(node);
  const left = node.left,
    right = node.right;
  if (left !== undefined && height<T>(left) - height<T>(right) > 1) {
    if (height<T>(left.right) > height<T>(left.left))
      node.left = rotateLeft<T>(left);
    return rotateRight<T>(node);
  }
  if (right !== undefined && height<T>(right) - height<T>(left) > 1) {
    if (height<T>(right.left) > height<T>(right.right))
      node.right = rotateRight<T>(right);
    return rotateLeft<T>(node);
  }
  return node;
}
function findEntry<T>(
  node: ListEntry<T> | undefined,
  index: number,
): ListEntry<T> | undefined {
  while (node !== undefined) {
    if (node.index === index) return node;
    node = index < node.index ? node.left : node.right;
  }
  return undefined;
}
function insertEntry<T>(
  node: ListEntry<T> | undefined,
  index: number,
  value: T,
): ListEntry<T> {
  if (node === undefined)
    return { index, value, height: 1, left: undefined, right: undefined };
  if (index === node.index) {
    node.value = value;
    return node;
  }
  if (index < node.index) node.left = insertEntry<T>(node.left, index, value);
  else node.right = insertEntry<T>(node.right, index, value);
  return balance<T>(node);
}
function removeEntry<T>(
  node: ListEntry<T> | undefined,
  index: number,
): ListEntry<T> | undefined {
  if (node === undefined) return undefined;
  return removePresent<T>(node, index);
}
function removePresent<T>(
  node: ListEntry<T>,
  index: number,
): ListEntry<T> | undefined {
  if (index < node.index) node.left = removeEntry<T>(node.left, index);
  else if (index > node.index) node.right = removeEntry<T>(node.right, index);
  else {
    const left = node.left,
      right = node.right;
    if (left === undefined) return right;
    if (right === undefined) return left;
    let successor: ListEntry<T> = right;
    let next = successor.left;
    while (next !== undefined) {
      successor = next;
      next = successor.left;
    }
    node.index = successor.index;
    node.value = successor.value;
    node.right = removeEntry<T>(node.right, successor.index);
  }
  return balance<T>(node);
}
/** Capacity is a validated hint; sparse storage allocates only written elements. */
export function createList<T>(capacity: number): SparseList<T> {
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > 0xffffffff)
    throw "INVALID_CAPACITY";
  return { length: 0, root: undefined };
}
export function readList<T>(list: SparseList<T>, index: number): T | undefined {
  if (!validIndex(index) || index >= list.length) return undefined;
  const node = findEntry<T>(list.root, index);
  return node === undefined ? undefined : node.value;
}
export function writeList<T>(
  list: SparseList<T>,
  index: number,
  value: T,
): void {
  if (!validIndex(index)) throw "INVALID_INDEX";
  list.root = insertEntry<T>(list.root, index, value);
  if (index >= list.length) list.length = index + 1;
}
export function pushList<T>(list: SparseList<T>, value: T): number {
  writeList<T>(list, list.length, value);
  return list.length;
}
export function popList<T>(list: SparseList<T>): T | undefined {
  if (list.length === 0) return undefined;
  const index = list.length - 1;
  const value = readList<T>(list, index);
  list.root = removeEntry<T>(list.root, index);
  list.length = index;
  return value;
}
export function lengthList<T>(list: SparseList<T>): number {
  return list.length;
}
/** Presence is independent of the stored value, including undefined. */
export function hasList<T>(list: SparseList<T>, index: number): boolean {
  return (
    validIndex(index) &&
    index < list.length &&
    findEntry<T>(list.root, index) !== undefined
  );
}
/** Remove an indexed property without changing logical length. */
export function deleteList<T>(list: SparseList<T>, index: number): boolean {
  if (!hasList<T>(list, index)) return false;
  list.root = removeEntry<T>(list.root, index);
  return true;
}
function lastEntry<T>(node: ListEntry<T>): ListEntry<T> {
  let next = node.right;
  while (next !== undefined) {
    node = next;
    next = node.right;
  }
  return node;
}
export function resizeList<T>(list: SparseList<T>, length: number): void {
  if (!Number.isInteger(length) || length < 0 || length > 0xffffffff)
    throw "INVALID_LENGTH";
  if (length === 0) list.root = undefined;
  else if (length < list.length) {
    // Remove populated indices, never walk a potentially huge range of holes.
    let last = list.root;
    while (last !== undefined) {
      const maximum = lastEntry<T>(last);
      if (maximum.index < length) break;
      list.root = removeEntry<T>(list.root, maximum.index);
      last = list.root;
    }
  }
  list.length = length === 0 ? 0 : length;
}

/** Present indexed properties live in an 8-way radix trie keyed by index bits.
 * Leaves hold eight consecutive elements and a presence mask, so stored
 * undefined stays distinct from a hole. Branches hold eight children; only
 * nodes on paths to present elements exist, and emptied nodes are pruned.
 * A root's own shift bounds the indices it can contain. */
interface ListLeaf<T> {
  readonly leaf: true;
  present: number;
  e0: T | undefined;
  e1: T | undefined;
  e2: T | undefined;
  e3: T | undefined;
  e4: T | undefined;
  e5: T | undefined;
  e6: T | undefined;
  e7: T | undefined;
}
interface ListBranch<T> {
  readonly leaf: false;
  /** Each child spans 2 ** shift indices; shift is a positive multiple of 3. */
  readonly shift: number;
  /** Number of defined children. */
  count: number;
  c0: ListNode<T> | undefined;
  c1: ListNode<T> | undefined;
  c2: ListNode<T> | undefined;
  c3: ListNode<T> | undefined;
  c4: ListNode<T> | undefined;
  c5: ListNode<T> | undefined;
  c6: ListNode<T> | undefined;
  c7: ListNode<T> | undefined;
}
type ListNode<T> = ListLeaf<T> | ListBranch<T>;
/** Implementation state; callers mutate through the exported operations. */
export interface SparseList<T> {
  length: number;
  root: ListNode<T> | undefined;
}
function validIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff;
}
function createLeaf<T>(): ListLeaf<T> {
  return {
    leaf: true,
    present: 0,
    e0: undefined,
    e1: undefined,
    e2: undefined,
    e3: undefined,
    e4: undefined,
    e5: undefined,
    e6: undefined,
    e7: undefined,
  };
}
function createBranch<T>(shift: number): ListBranch<T> {
  return {
    leaf: false,
    shift,
    count: 0,
    c0: undefined,
    c1: undefined,
    c2: undefined,
    c3: undefined,
    c4: undefined,
    c5: undefined,
    c6: undefined,
    c7: undefined,
  };
}
function leafValue<T>(leaf: ListLeaf<T>, slot: number): T | undefined {
  if (slot < 4) {
    if (slot < 2) return slot === 0 ? leaf.e0 : leaf.e1;
    return slot === 2 ? leaf.e2 : leaf.e3;
  }
  if (slot < 6) return slot === 4 ? leaf.e4 : leaf.e5;
  return slot === 6 ? leaf.e6 : leaf.e7;
}
function setLeafValue<T>(
  leaf: ListLeaf<T>,
  slot: number,
  value: T | undefined,
): void {
  if (slot < 4) {
    if (slot < 2) {
      if (slot === 0) leaf.e0 = value;
      else leaf.e1 = value;
    } else if (slot === 2) leaf.e2 = value;
    else leaf.e3 = value;
  } else if (slot < 6) {
    if (slot === 4) leaf.e4 = value;
    else leaf.e5 = value;
  } else if (slot === 6) leaf.e6 = value;
  else leaf.e7 = value;
}
function child<T>(
  branch: ListBranch<T>,
  slot: number,
): ListNode<T> | undefined {
  if (slot < 4) {
    if (slot < 2) return slot === 0 ? branch.c0 : branch.c1;
    return slot === 2 ? branch.c2 : branch.c3;
  }
  if (slot < 6) return slot === 4 ? branch.c4 : branch.c5;
  return slot === 6 ? branch.c6 : branch.c7;
}
function setChild<T>(
  branch: ListBranch<T>,
  slot: number,
  node: ListNode<T> | undefined,
): void {
  if (slot < 4) {
    if (slot < 2) {
      if (slot === 0) branch.c0 = node;
      else branch.c1 = node;
    } else if (slot === 2) branch.c2 = node;
    else branch.c3 = node;
  } else if (slot < 6) {
    if (slot === 4) branch.c4 = node;
    else branch.c5 = node;
  } else if (slot === 6) branch.c6 = node;
  else branch.c7 = node;
}
/** Whether a node rooted at the top of the trie can contain index. Indices are
 * below 2 ** 32, so `>>>` keeps every bit. */
function covers<T>(node: ListNode<T>, index: number): boolean {
  return node.leaf ? index < 8 : index >>> node.shift < 8;
}
/** The leaf that would hold index, without allocating. */
function findLeaf<T>(
  root: ListNode<T> | undefined,
  index: number,
): ListLeaf<T> | undefined {
  if (root === undefined || !covers<T>(root, index)) return undefined;
  let node: ListNode<T> | undefined = root;
  while (node !== undefined) {
    if (node.leaf) return node;
    node = child<T>(node, (index >>> node.shift) & 7);
  }
  return undefined;
}
/** The smallest root that covers index. */
function rootFor<T>(index: number): ListNode<T> {
  let shift = 0;
  while (shift < 30 && index >>> (shift + 3) !== 0) shift += 3;
  return shift === 0 ? createLeaf<T>() : createBranch<T>(shift);
}
/** A root one level taller whose first child is root. */
function grow<T>(root: ListNode<T>): ListBranch<T> {
  const grown: ListBranch<T> = createBranch<T>(root.leaf ? 3 : root.shift + 3);
  grown.c0 = root;
  grown.count = 1;
  return grown;
}
/** The leaf for index below a root that covers it, creating the path. Only
 * list methods touch the list header. */
function ensureLeaf<T>(root: ListNode<T>, index: number): ListLeaf<T> {
  let node: ListNode<T> = root;
  while (true) {
    if (node.leaf) return node;
    const slot = (index >>> node.shift) & 7;
    const next = child<T>(node, slot);
    if (next === undefined) {
      const created: ListNode<T> =
        node.shift === 3 ? createLeaf<T>() : createBranch<T>(node.shift - 3);
      setChild<T>(node, slot, created);
      node.count = node.count + 1;
      node = created;
    } else node = next;
  }
}
/** Remove index from the subtree; returns whether the subtree became empty. */
function removeIndex<T>(node: ListNode<T>, index: number): boolean {
  if (node.leaf) {
    const slot = index & 7,
      bit = 1 << slot;
    if ((node.present & bit) === 0) return false;
    node.present = node.present & ~bit;
    setLeafValue<T>(node, slot, undefined);
    return node.present === 0;
  }
  const slot = (index >>> node.shift) & 7,
    next = child<T>(node, slot);
  if (next === undefined || !removeIndex<T>(next, index)) return false;
  setChild<T>(node, slot, undefined);
  node.count = node.count - 1;
  return node.count === 0;
}
/** Remove every present index at or above length from the subtree whose first
 * index is base; returns whether it became empty. Only existing nodes are
 * visited, never ranges of holes. */
function truncate<T>(node: ListNode<T>, base: number, length: number): boolean {
  if (node.leaf) {
    for (let slot = 0; slot < 8; slot++)
      if (base + slot >= length && (node.present & (1 << slot)) !== 0) {
        node.present = node.present & ~(1 << slot);
        setLeafValue<T>(node, slot, undefined);
      }
    return node.present === 0;
  }
  const span = 1 << node.shift;
  for (let slot = 0; slot < 8; slot++) {
    const next = child<T>(node, slot);
    if (next === undefined) continue;
    const start = base + slot * span;
    if (
      start >= length ||
      (start + span > length && truncate<T>(next, start, length))
    ) {
      setChild<T>(node, slot, undefined);
      node.count = node.count - 1;
    }
  }
  return node.count === 0;
}
/** Capacity is a validated hint; sparse storage allocates only written elements. */
export function createList<T>(capacity: number): SparseList<T> {
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > 0xffffffff)
    throw "INVALID_CAPACITY";
  return { length: 0, root: undefined };
}
export function readList<T>(list: SparseList<T>, index: number): T | undefined {
  if (!validIndex(index) || index >= list.length) return undefined;
  const leaf = findLeaf<T>(list.root, index);
  return leaf === undefined ? undefined : leafValue<T>(leaf, index & 7);
}
export function writeList<T>(
  list: SparseList<T>,
  index: number,
  value: T,
): void {
  if (!validIndex(index)) throw "INVALID_INDEX";
  const current = list.root;
  let root: ListNode<T> = current === undefined ? rootFor<T>(index) : current;
  if (current === undefined) list.root = root;
  while (!covers<T>(root, index)) {
    root = grow<T>(root);
    list.root = root;
  }
  const leaf = ensureLeaf<T>(root, index),
    slot = index & 7;
  leaf.present = leaf.present | (1 << slot);
  setLeafValue<T>(leaf, slot, value);
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
  const root = list.root;
  if (
    root !== undefined &&
    covers<T>(root, index) &&
    removeIndex<T>(root, index)
  )
    list.root = undefined;
  list.length = index;
  return value;
}
export function lengthList<T>(list: SparseList<T>): number {
  return list.length;
}
/** Presence is independent of the stored value, including undefined. */
export function hasList<T>(list: SparseList<T>, index: number): boolean {
  if (!validIndex(index) || index >= list.length) return false;
  const leaf = findLeaf<T>(list.root, index);
  return leaf !== undefined && (leaf.present & (1 << (index & 7))) !== 0;
}
/** Remove an indexed property without changing logical length. */
export function deleteList<T>(list: SparseList<T>, index: number): boolean {
  if (!hasList<T>(list, index)) return false;
  const root = list.root;
  if (root !== undefined && removeIndex<T>(root, index)) list.root = undefined;
  return true;
}
export function resizeList<T>(list: SparseList<T>, length: number): void {
  if (!Number.isInteger(length) || length < 0 || length > 0xffffffff)
    throw "INVALID_LENGTH";
  const root = list.root;
  if (length === 0) list.root = undefined;
  else if (
    length < list.length &&
    root !== undefined &&
    truncate<T>(root, 0, length)
  )
    list.root = undefined;
  list.length = length === 0 ? 0 : length;
}

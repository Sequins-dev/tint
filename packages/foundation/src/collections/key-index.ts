export interface ReadonlyKeyIndex<K, V> {
  readonly get: (key: K) => V | undefined;
  readonly has: (key: K) => boolean;
  readonly forEach: (visit: (value: V, key: K) => void) => void;
}
export interface KeyIndex<K, V> extends ReadonlyKeyIndex<K, V> {
  readonly set: (key: K, value: V) => void;
  readonly delete: (key: K) => boolean;
  readonly clear: () => void;
  /** Replace every value in insertion order without looking keys up again;
   * the transform must not change the index's structure. */
  readonly replaceValues: (transform: (value: V, key: K) => V) => void;
}
interface Entry<K, V> {
  readonly hash: number;
  readonly key: K;
  value: V;
  previous: Entry<K, V> | undefined;
  next: Entry<K, V> | undefined;
}
/** Pure, stable key operations. Equivalent keys must have identical hashes. */
export interface KeyEquivalence<K> {
  readonly hash: (key: K) => number;
  readonly equals: (left: K, right: K) => boolean;
}
/** Hashes must be stable uint32 values; equal keys must have equal hashes.
 * Equality defaults to identity/SameValueZero even when hashes collide.
 * A custom comparator must be pure and stable for stored keys.
 * Traversal permits value replacement but rejects structural changes. */
export function createKeyIndex<K, V>(
  hash: (key: K) => number,
  equals?: (left: K, right: K) => boolean,
): KeyIndex<K, V> {
  // `slots` maps a probe position to entry index + 1 (0 empty, 0xffffffff
  // deleted); `hashes` holds the stored entry's hash at the same position so a
  // probe reads `entries` only for a full-hash match. List reads are costly in
  // images whose lists are sparse trees.
  let entries: (Entry<K, V> | undefined)[] = [],
    slots: Uint32Array = new Uint32Array(16),
    hashes: Uint32Array = new Uint32Array(16),
    count = 0,
    used = 0,
    head: Entry<K, V> | undefined = undefined,
    tail: Entry<K, V> | undefined = undefined,
    traversals = 0,
    // The entry matched by the latest `position`, assigned after any custom
    // equality call returns, so callers need not read `entries` again.
    found: Entry<K, V> | undefined = undefined;
  function index(key: K): number {
    const value = hash(key);
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw "INVALID_KEY_HASH";
    // Mix small or patterned hashes before selecting power-of-two buckets
    // (the Murmur3 finalizer): one multiply and fold left sequential and
    // span-derived keys clustered under linear probing.
    let mixed = value === 0xffffffff ? 0 : value;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b);
    mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
    return (mixed ^ (mixed >>> 16)) >>> 0;
  }
  function position(key: K, hashValue: number): number {
    // Custom equality must be pure: probing retains the current storage.
    const table = slots,
      stored = hashes,
      values = entries,
      mask = table.length - 1;
    let at = hashValue & mask,
      deleted = -1;
    let state = table[at];
    while (state !== 0) {
      if (state === 0xffffffff) {
        if (deleted < 0) deleted = at;
      } else if (stored[at] === hashValue) {
        const entry = values[(state ?? 0) - 1];
        if (entry === undefined) throw "index bucket invariant";
        if (
          equals === undefined
            ? entry.key === key || (entry.key !== entry.key && key !== key)
            : equals(entry.key, key)
        ) {
          found = entry;
          return at;
        }
      }
      at = (at + 1) & mask;
      state = table[at];
    }
    found = undefined;
    return deleted < 0 ? at : deleted;
  }
  function rebuild(capacity: number): void {
    if (capacity > 0x40000000) throw "INDEX_CAPACITY";
    const next: (Entry<K, V> | undefined)[] = [],
      nextSlots = new Uint32Array(capacity),
      nextHashes = new Uint32Array(capacity);
    let entry = head;
    const mask = capacity - 1;
    while (entry !== undefined) {
      const current: Entry<K, V> = entry;
      let at = current.hash & mask;
      while (nextSlots[at] !== 0) at = (at + 1) & mask;
      next.push(current);
      nextSlots[at] = next.length;
      nextHashes[at] = current.hash;
      entry = current.next;
    }
    entries = next;
    slots = nextSlots;
    hashes = nextHashes;
    used = count;
  }
  return {
    get(key) {
      position(key, index(key));
      const entry = found;
      return entry === undefined ? undefined : entry.value;
    },
    has(key) {
      position(key, index(key));
      return found !== undefined;
    },
    set(key, value) {
      const hashValue = index(key);
      let at = position(key, hashValue);
      const existing = found;
      if (existing !== undefined) {
        existing.value = value;
        return;
      }
      if (traversals !== 0) throw "INDEX_ITERATION_MUTATION";
      if (
        // Linear probing past half load clusters badly: at the former
        // three-quarters bound a bootstrap compile averaged 10.8 probes per
        // lookup, since every insert first searches for an absent key.
        (used + 1) * 2 > slots.length ||
        entries.length >= slots.length * 2
      ) {
        rebuild(count * 2 >= slots.length ? slots.length * 2 : slots.length);
        at = position(key, hashValue);
      }
      const entry: Entry<K, V> = {
        hash: hashValue,
        key,
        value,
        previous: tail,
        next: undefined,
      };
      if (slots[at] === 0) used++;
      entries.push(entry);
      slots[at] = entries.length;
      hashes[at] = hashValue;
      count++;
      if (tail === undefined) head = entry;
      else tail.next = entry;
      tail = entry;
    },
    delete(key) {
      const at = position(key, index(key)),
        entry = found;
      if (entry === undefined) return false;
      if (traversals !== 0) throw "INDEX_ITERATION_MUTATION";
      entries[(slots[at] ?? 0) - 1] = undefined;
      slots[at] = 0xffffffff;
      count--;
      const previous = entry.previous,
        next = entry.next;
      if (previous === undefined) head = next;
      else previous.next = next;
      if (next === undefined) tail = previous;
      else next.previous = previous;
      found = undefined;
      return true;
    },
    clear() {
      if (traversals !== 0) throw "INDEX_ITERATION_MUTATION";
      entries = [];
      slots = new Uint32Array(16);
      hashes = new Uint32Array(16);
      count = 0;
      used = 0;
      head = undefined;
      tail = undefined;
      found = undefined;
    },
    replaceValues(transform) {
      traversals++;
      try {
        let entry = head;
        while (entry !== undefined) {
          entry.value = transform(entry.value, entry.key);
          entry = entry.next;
        }
      } finally {
        traversals--;
      }
    },
    forEach(visit) {
      traversals++;
      try {
        let entry = head;
        while (entry !== undefined) {
          visit(entry.value, entry.key);
          entry = entry.next;
        }
      } finally {
        traversals--;
      }
    },
  };
}

/** Stable hash of JavaScript UTF-16 code units; equality still resolves collisions. */
export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++)
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

/** String-keyed indexes keep hashing and its callback within the owning module. */
export function createStringIndex<V>(): KeyIndex<string, V> {
  return createKeyIndex<string, V>((key: string): number => hashString(key));
}

/** Reusable dense IDs for nonnegative safe-integer keys. clear invalidates IDs
 * without releasing numeric scratch capacity; no managed keys are retained. */
export interface NumberIndex {
  readonly intern: (key: number) => number;
  readonly clear: () => void;
}
function numberHash(key: number): number {
  const mixed = (key >>> 0) ^ (Math.floor(key / 4294967296) * 65599);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}
export function createNumberIndex(): NumberIndex {
  let keys = new Float64Array(16),
    slots = new Uint32Array(32),
    stamps = new Uint32Array(32),
    count = 0,
    epoch = 1;
  function grow(): void {
    if (slots.length >= 0x40000000) throw "NUMBER_INDEX_CAPACITY";
    const nextKeys = new Float64Array(keys.length * 2),
      nextSlots = new Uint32Array(slots.length * 2),
      nextStamps = new Uint32Array(stamps.length * 2);
    nextKeys.set(keys);
    const mask = nextSlots.length - 1;
    for (let id = 0; id < count; id++) {
      const key = keys[id];
      if (key === undefined) throw "number index key invariant";
      let position = numberHash(key) & mask;
      while (nextStamps[position] === epoch) position = (position + 1) & mask;
      nextSlots[position] = id;
      nextStamps[position] = epoch;
    }
    keys = nextKeys;
    slots = nextSlots;
    stamps = nextStamps;
  }
  return {
    intern(key) {
      if (!Number.isSafeInteger(key) || key < 0) throw "INVALID_NUMBER_KEY";
      let mask = slots.length - 1,
        position = numberHash(key) & mask;
      while (stamps[position] === epoch) {
        const id = slots[position];
        if (id === undefined) throw "number index slot invariant";
        if (keys[id] === key) return id;
        position = (position + 1) & mask;
      }
      if (count === keys.length) {
        grow();
        mask = slots.length - 1;
        position = numberHash(key) & mask;
        while (stamps[position] === epoch) position = (position + 1) & mask;
      }
      const id = count++;
      keys[id] = key;
      slots[position] = id;
      stamps[position] = epoch;
      return id;
    },
    clear() {
      count = 0;
      if (epoch === 0xffffffff) {
        stamps.fill(0);
        epoch = 1;
      } else epoch++;
    },
  };
}

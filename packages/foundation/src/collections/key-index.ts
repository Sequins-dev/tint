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
// Compact insertion-ordered storage (CPython's compact dict): entries live in
// dense parallel arrays in insertion order, and the open-addressed `slots`
// table maps a probe position to entry index + 1 (0 empty, 0xffffffff
// deleted). An entry costs its key and value slots plus one stored hash, with
// no per-entry record or links; traversal walks the arrays.
interface IndexState<K, V> {
  keys: K[];
  values: V[];
  /** The mixed hash of each entry; `removedHash` marks a deleted entry. */
  hashes: Uint32Array;
  slots: Uint32Array;
  /** Entries written, including deleted ones (compacted on rebuild). */
  length: number;
  count: number;
  /** Occupied slots, including deleted markers. */
  used: number;
  traversals: number;
  // The entry index matched by the latest `position` (-1 when absent),
  // assigned after any custom equality call returns.
  found: number;
}
// Mixed hashes never take this value (see `index`), so it marks deletion.
const removedHash = 0xffffffff;
const initialSlots = 16;
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
  // Mutable state lives in one record the methods capture by value: field
  // reads, not cell reads.
  const state: IndexState<K, V> = {
    keys: [],
    values: [],
    hashes: new Uint32Array(initialSlots / 2),
    slots: new Uint32Array(initialSlots),
    length: 0,
    count: 0,
    used: 0,
    traversals: 0,
    found: -1,
  };
  function index(key: K): number {
    const value = hash(key);
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw "INVALID_KEY_HASH";
    // Mix small or patterned hashes before selecting power-of-two buckets
    // (the Murmur3 finalizer): one multiply and fold left sequential and
    // span-derived keys clustered under linear probing.
    let mixed = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
    mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
    mixed = (mixed ^ (mixed >>> 16)) >>> 0;
    // Reserve the deletion marker; only probe order depends on the fold.
    return mixed === removedHash ? 0 : mixed;
  }
  function position(key: K, hashValue: number): number {
    // Custom equality must be pure: probing retains the current storage.
    const table = state.slots,
      stored = state.hashes,
      keys = state.keys,
      mask = table.length - 1;
    let at = hashValue & mask,
      deleted = -1;
    let probe = table[at] ?? 0;
    while (probe !== 0) {
      if (probe === 0xffffffff) {
        if (deleted < 0) deleted = at;
      } else if (stored[probe - 1] === hashValue) {
        const candidate = keys[probe - 1];
        if (candidate === undefined) throw "index entry invariant";
        if (
          equals === undefined
            ? candidate === key || (candidate !== candidate && key !== key)
            : equals(candidate, key)
        ) {
          state.found = probe - 1;
          return at;
        }
      }
      at = (at + 1) & mask;
      probe = table[at] ?? 0;
    }
    state.found = -1;
    return deleted < 0 ? at : deleted;
  }
  /** Compact the live entries in order and re-index them in `capacity` slots. */
  function rebuild(capacity: number): void {
    if (capacity > 0x40000000) throw "INDEX_CAPACITY";
    const keys = state.keys,
      values = state.values,
      hashes = state.hashes,
      nextKeys: K[] = [],
      nextValues: V[] = [],
      nextHashes = new Uint32Array(capacity / 2),
      nextSlots = new Uint32Array(capacity),
      mask = capacity - 1;
    let count = 0;
    values.forEach((value: V, entry: number): void => {
      const entryHash = hashes[entry] ?? removedHash;
      if (entryHash === removedHash) return;
      const key = keys[entry];
      if (key === undefined) throw "index entry invariant";
      let at = entryHash & mask;
      while (nextSlots[at] !== 0) at = (at + 1) & mask;
      nextKeys.push(key);
      nextValues.push(value);
      nextHashes[count] = entryHash;
      count++;
      nextSlots[at] = count;
    });
    state.keys = nextKeys;
    state.values = nextValues;
    state.hashes = nextHashes;
    state.slots = nextSlots;
    state.length = count;
    state.used = count;
  }
  /** Visit live entries in insertion order; the visitor may replace values. */
  function traverse(visit: (value: V, key: K, entry: number) => void): void {
    state.traversals++;
    try {
      const keys = state.keys,
        hashes = state.hashes;
      // The arrays grow in step, and traversal forbids structural changes.
      state.values.forEach((value: V, entry: number): void => {
        if (hashes[entry] === removedHash) return;
        const key = keys[entry];
        if (key === undefined) throw "index entry invariant";
        visit(value, key, entry);
      });
    } finally {
      state.traversals--;
    }
  }
  return {
    get(key) {
      position(key, index(key));
      const entry = state.found;
      return entry < 0 ? undefined : state.values[entry];
    },
    has(key) {
      position(key, index(key));
      return state.found >= 0;
    },
    set(key, value) {
      const hashValue = index(key);
      let at = position(key, hashValue);
      const existing = state.found;
      if (existing >= 0) {
        state.values[existing] = value;
        return;
      }
      if (state.traversals !== 0) throw "INDEX_ITERATION_MUTATION";
      if (
        // Linear probing past half load clusters badly: at the former
        // three-quarters bound a bootstrap compile averaged 10.8 probes per
        // lookup, since every insert first searches for an absent key.
        // Entries are bounded by half the slots, so the hash array (sized
        // to that bound) never overflows.
        (state.used + 1) * 2 > state.slots.length ||
        state.length * 2 >= state.slots.length
      ) {
        rebuild(
          state.count * 4 >= state.slots.length
            ? state.slots.length * 2
            : state.slots.length,
        );
        at = position(key, hashValue);
      }
      if (state.slots[at] === 0) state.used++;
      const entry = state.length;
      state.keys.push(key);
      state.values.push(value);
      state.hashes[entry] = hashValue;
      state.length = entry + 1;
      state.slots[at] = entry + 1;
      state.count++;
    },
    delete(key) {
      const at = position(key, index(key)),
        entry = state.found;
      if (entry < 0) return false;
      if (state.traversals !== 0) throw "INDEX_ITERATION_MUTATION";
      // The key and value stay referenced until the next rebuild compacts.
      state.hashes[entry] = removedHash;
      state.slots[at] = 0xffffffff;
      state.count--;
      state.found = -1;
      return true;
    },
    clear() {
      if (state.traversals !== 0) throw "INDEX_ITERATION_MUTATION";
      state.keys = [];
      state.values = [];
      state.hashes = new Uint32Array(initialSlots / 2);
      state.slots = new Uint32Array(initialSlots);
      state.length = 0;
      state.count = 0;
      state.used = 0;
      state.found = -1;
    },
    replaceValues(transform) {
      const values = state.values;
      traverse((value: V, key: K, entry: number): void => {
        values[entry] = transform(value, key);
      });
    },
    forEach(visit) {
      traverse((value: V, key: K, _entry: number): void => visit(value, key));
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
/** Mixes a nonnegative safe integer: the low and high uint32 halves (the
 * high half by an exact multiply by 2^-32, not a division). Only the probe
 * order depends on it; interned IDs follow insertion order. */
function numberHash(key: number): number {
  const mixed =
    (key >>> 0) ^ (Math.floor(key * 2.3283064365386963e-10) * 65599);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}
interface NumberIndexState {
  keys: Float64Array;
  slots: Uint32Array;
  stamps: Uint32Array;
  count: number;
  epoch: number;
}
function growNumberIndex(state: NumberIndexState): void {
  const keys = state.keys,
    count = state.count,
    epoch = state.epoch;
  if (state.slots.length >= 0x40000000) throw "NUMBER_INDEX_CAPACITY";
  const nextKeys = new Float64Array(keys.length * 2),
    nextSlots = new Uint32Array(state.slots.length * 2),
    nextStamps = new Uint32Array(state.stamps.length * 2);
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
  state.keys = nextKeys;
  state.slots = nextSlots;
  state.stamps = nextStamps;
}
export function createNumberIndex(): NumberIndex {
  // Mutable state is one record the methods capture by value, so a probe
  // reads fields once into locals rather than captured cells per iteration.
  // A slot is occupied when its stamp equals the current epoch.
  const state: NumberIndexState = {
    keys: new Float64Array(16),
    slots: new Uint32Array(32),
    stamps: new Uint32Array(32),
    count: 0,
    epoch: 1,
  };
  return {
    intern(key) {
      if (!Number.isSafeInteger(key) || key < 0) throw "INVALID_NUMBER_KEY";
      const hash = numberHash(key),
        epoch = state.epoch;
      let keys = state.keys,
        slots = state.slots,
        stamps = state.stamps,
        mask = slots.length - 1,
        position = hash & mask;
      while (stamps[position] === epoch) {
        const id = slots[position];
        if (id === undefined) throw "number index slot invariant";
        if (keys[id] === key) return id;
        position = (position + 1) & mask;
      }
      const id = state.count;
      if (id === keys.length) {
        growNumberIndex(state);
        keys = state.keys;
        slots = state.slots;
        stamps = state.stamps;
        mask = slots.length - 1;
        position = hash & mask;
        while (stamps[position] === epoch) position = (position + 1) & mask;
      }
      state.count = id + 1;
      keys[id] = key;
      slots[position] = id;
      stamps[position] = epoch;
      return id;
    },
    clear() {
      state.count = 0;
      if (state.epoch === 0xffffffff) {
        state.stamps.fill(0);
        state.epoch = 1;
      } else state.epoch++;
    },
  };
}

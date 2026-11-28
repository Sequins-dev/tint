/** Node comparison modes share the same traversal and pair memoization. */
export type ComparisonMode = "strict" | "loose" | "partial";

const objectTag = Object.prototype.toString;
const enumerable = Object.prototype.propertyIsEnumerable;
const own = Object.prototype.hasOwnProperty;

function keys(value: object, loose: boolean): PropertyKey[] {
  if (loose) return Object.keys(value);
  return Reflect.ownKeys(value).filter((key: PropertyKey) =>
    enumerable.call(value, key),
  );
}

function wrapper(tag: string): boolean {
  return (
    tag === "[object Number]" ||
    tag === "[object String]" ||
    tag === "[object Boolean]" ||
    tag === "[object BigInt]" ||
    tag === "[object Symbol]"
  );
}

interface SeenPair {
  readonly left: object;
  readonly right: object;
}
interface Comparison {
  readonly mode: ComparisonMode;
  readonly skipPrototype: boolean;
  readonly seen: SeenPair[];
}

export function deepCompare(
  left: unknown,
  right: unknown,
  mode: ComparisonMode,
  skipPrototype: boolean = false,
): boolean {
  return compare(left, right, { mode, skipPrototype, seen: [] });
}

function compare(left: unknown, right: unknown, state: Comparison): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    if (state.mode !== "loose") return false;
    // Legacy deep equality only coerces primitive leaves. Functions and
    // objects are matched by identity or compared structurally above.
    if (
      (left !== null && typeof left === "object") ||
      (right !== null && typeof right === "object") ||
      typeof left === "function" ||
      typeof right === "function"
    )
      return false;
    return left == right;
  }

  const partial = state.mode === "partial",
    loose = state.mode === "loose";
  if (
    !partial &&
    !loose &&
    !state.skipPrototype &&
    Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)
  )
    return false;
  for (const pair of state.seen) {
    if (pair === undefined) continue;
    if (pair.left === left || pair.right === right)
      return pair.left === left && pair.right === right;
  }

  const tag: string = objectTag.call(left);
  if (tag !== objectTag.call(right)) return false;
  state.seen.push({ left, right });
  try {
    if (!compareContents(left, right, tag, state)) return false;
    const skipIndices =
      (partial && Array.isArray(left)) || ArrayBuffer.isView(left);
    return compareProperties(left, right, state, skipIndices);
  } finally {
    state.seen.pop();
  }
}

function valueAt(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key);
}

function isArrayIndex(key: PropertyKey): boolean {
  if (typeof key !== "string" || key === "") return false;
  const index = Number(key);
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    index < 4294967295 &&
    String(index) === key
  );
}

function compareProperties(
  left: object,
  right: object,
  state: Comparison,
  skipIndices: boolean,
): boolean {
  const partial = state.mode === "partial",
    loose = state.mode === "loose";
  const relevantKeys = (value: object): PropertyKey[] => {
    const list = keys(value, loose);
    return skipIndices
      ? list.filter((key: PropertyKey) => !isArrayIndex(key))
      : list;
  };
  const rightKeys = relevantKeys(right);
  if (!partial && relevantKeys(left).length !== rightKeys.length) return false;
  for (const key of rightKeys) {
    if (key === undefined) continue;
    if (
      !enumerable.call(left, key) ||
      !compare(valueAt(left, key), valueAt(right, key), state)
    )
      return false;
  }
  return true;
}

function compareContents(
  left: object,
  right: object,
  tag: string,
  state: Comparison,
): boolean {
  const partial = state.mode === "partial";
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (!partial) return left.length === right.length;
    let index = 0;
    for (let i = 0; i < right.length; i++) {
      if (!own.call(right, i)) continue;
      while (
        index < left.length &&
        (!own.call(left, index) || !compare(left[index], right[i], state))
      )
        index++;
      if (index === left.length) return false;
      index++;
    }
    return true;
  }
  if (left instanceof Date && right instanceof Date) {
    // Invalid Dates compare equal in Node 25 and later.
    return Object.is(left.getTime(), right.getTime());
  }
  if (left instanceof RegExp && right instanceof RegExp)
    return (
      left.source === right.source &&
      left.flags === right.flags &&
      left.lastIndex === right.lastIndex
    );
  if (left instanceof Error && right instanceof Error) {
    if (left.name !== right.name || left.message !== right.message)
      return false;
    for (const key of ["cause", "errors"]) {
      if (key === undefined) continue;
      if (!partial && own.call(left, key) !== own.call(right, key))
        return false;
      if (
        (!partial || own.call(right, key)) &&
        !compare(valueAt(left, key), valueAt(right, key), state)
      )
        return false;
    }
  }
  if (wrapper(tag)) {
    const valueOfLeft = valueAt(left, "valueOf");
    const valueOfRight = valueAt(right, "valueOf");
    if (
      typeof valueOfLeft !== "function" ||
      typeof valueOfRight !== "function" ||
      !Object.is(
        Reflect.apply(valueOfLeft, left, []),
        Reflect.apply(valueOfRight, right, []),
      )
    )
      return false;
  }
  if (
    tag === "[object Promise]" ||
    tag === "[object WeakMap]" ||
    tag === "[object WeakSet]"
  )
    return false;
  if (left instanceof Map && right instanceof Map)
    return compareMaps(left, right, state);
  if (left instanceof Set && right instanceof Set)
    return compareSets(left, right, state);
  if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
    if (!ArrayBuffer.isView(left) || !ArrayBuffer.isView(right)) return false;
    return compareBytes(
      new Uint8Array(left.buffer, left.byteOffset, left.byteLength),
      new Uint8Array(right.buffer, right.byteOffset, right.byteLength),
      partial,
    );
  }
  if (left instanceof ArrayBuffer && right instanceof ArrayBuffer)
    return compareBytes(new Uint8Array(left), new Uint8Array(right), partial);
  if (left instanceof SharedArrayBuffer && right instanceof SharedArrayBuffer)
    return compareBytes(new Uint8Array(left), new Uint8Array(right), partial);
  return true;
}

function compareBytes(
  left: Uint8Array,
  right: Uint8Array,
  partial: boolean,
): boolean {
  if (left.length < right.length || (!partial && left.length !== right.length))
    return false;
  let index = 0;
  for (let i = 0; i < right.length; i++) {
    if (partial)
      while (index < left.length && left[index] !== right[i]) index++;
    if (index === left.length || left[index++] !== right[i]) return false;
  }
  return true;
}

function compareMaps(
  left: Map<unknown, unknown>,
  right: Map<unknown, unknown>,
  state: Comparison,
): boolean {
  if (
    left.size < right.size ||
    (state.mode !== "partial" && left.size !== right.size)
  )
    return false;
  const pending = Array.from(left);
  for (const wanted of right) {
    let matched = false;
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      if (item === undefined) continue;
      if (
        compare(item[0], wanted[0], state) &&
        compare(item[1], wanted[1], state)
      ) {
        pending.splice(i, 1);
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

function compareSets(
  left: Set<unknown>,
  right: Set<unknown>,
  state: Comparison,
): boolean {
  if (
    left.size < right.size ||
    (state.mode !== "partial" && left.size !== right.size)
  )
    return false;
  const pending = Array.from(left);
  for (const wanted of right) {
    let matched = false;
    for (let i = 0; i < pending.length; i++) {
      if (!compare(pending[i], wanted, state)) continue;
      pending.splice(i, 1);
      matched = true;
      break;
    }
    if (!matched) return false;
  }
  return true;
}

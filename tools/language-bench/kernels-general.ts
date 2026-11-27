// Comprehensive general-path (realm) language & builtin benchmark kernels.
// These cover ECMAScript constructs and standard builtins that currently lower
// through Tint's general/realm path (generators, custom iterators, tagged
// templates, RegExp, Date, WeakMap/WeakSet, Object.assign/fromEntries/create,
// full Array HOFs including reduce/flat/splice, Symbol, Proxy/Reflect).
// Written in erasable TypeScript so Node and Tint run identical source text.
// Each exported kernel takes `scale: number` and returns a deterministic 32-bit
// signed integer checksum.

function mix32(acc: number, value: number): number {
  return (Math.imul(acc, 31) + (value | 0)) | 0;
}

// --- Tagged templates ---
function formatTag(strings: TemplateStringsArray, ...values: number[]): string {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    out +=
      "[" +
      String((values[i] ?? 0) * 2) +
      "]" +
      (strings.raw[i + 1] ?? strings[i + 1] ?? "");
  }
  return out;
}

export function taggedTemplates(scale: number): number {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const a = round & 31;
    const b = (round * 3) & 63;
    const c = (round * 7) & 15;
    const rendered = formatTag`row\\n:${a}=${b}+${c}`;
    checksum = mix32(
      checksum,
      rendered.length + rendered.charCodeAt(round % rendered.length),
    );
  }
  return checksum;
}

// --- Generators & yield / yield* ---
function* rangeGen(start: number, count: number): Generator<number> {
  for (let i = 0; i < count; i++) yield start + i;
}

function* delegatedGen(seed: number): Generator<number> {
  yield* rangeGen(seed, 12);
  yield (seed * 3) | 0;
  yield* rangeGen(seed + 100, 12);
}

function* transformGen(
  source: Iterable<number>,
  factor: number,
): Generator<number> {
  for (const value of source) {
    if ((value & 1) === 0) yield (value * factor + 1) | 0;
  }
}

export function generatorsYield(scale: number): number {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    let sum = 0;
    for (const v of transformGen(delegatedGen(round & 63), (round & 7) + 1)) {
      sum = (sum + v) | 0;
    }
    checksum = mix32(checksum, sum);
  }
  return checksum;
}

// --- Custom iterators ([Symbol.iterator] + return() close protocol) ---
export function customIterators(scale: number): number {
  let closed = 0;
  function makeRange(start: number, limit: number): Iterable<number> {
    return {
      [Symbol.iterator](): Iterator<number> {
        let cur = start;
        return {
          next(): IteratorResult<number> {
            if (cur >= limit) return { done: true, value: undefined };
            return { done: false, value: cur++ };
          },
          return(): IteratorResult<number> {
            closed++;
            return { done: true, value: undefined };
          },
        };
      },
    };
  }
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    let sum = 0;
    for (const v of makeRange(round & 15, (round & 15) + 24)) {
      sum = (sum + v) | 0;
    }
    for (const v of makeRange(0, 32)) {
      sum = (sum + v) | 0;
      if (v === (round & 7)) break;
    }
    checksum = mix32(checksum, sum + closed);
  }
  return checksum;
}

// --- WeakMap & WeakSet ---
export function weakMapSet(scale: number): number {
  const wm = new WeakMap<object, number>();
  const ws = new WeakSet<object>();
  const live: { id: number }[] = [];
  for (let i = 0; i < 64; i++) {
    const obj = { id: i };
    live.push(obj);
    wm.set(obj, i * 11);
    ws.add(obj);
  }
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    let sum = 0;
    for (let i = 0; i < 32; i++) {
      const k = live[(round + i) & 63]!;
      const prev = wm.get(k) ?? 0;
      wm.set(k, (prev + 1) | 0);
      if (ws.has(k)) sum = (sum + prev) | 0;
    }
    const transient = { id: round };
    wm.set(transient, round & 255);
    ws.add(transient);
    sum = (sum + (wm.get(transient) ?? 0) + (ws.has(transient) ? 1 : 0)) | 0;
    wm.delete(transient);
    ws.delete(transient);
    checksum = mix32(checksum, sum);
  }
  return checksum;
}

// --- Object.assign / Object.fromEntries / Object.create / Object.freeze ---
export function objectAssignFromEntries(scale: number): number {
  const proto = { base: 7 };
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const entries: [string, number][] = [
      ["a", round & 31],
      ["b", (round * 3) & 31],
      ["c", (round * 5) & 31],
      ["d", (round * 7) & 31],
    ];
    const fromE = Object.fromEntries(entries) as Record<string, number>;
    const merged = Object.assign({ x: 1, y: 2 }, fromE, { z: round & 15 });
    const created = Object.create(proto) as { base: number; own: number };
    created.own = (merged.a ?? 0) + (merged.z ?? 0);
    const frozen = Object.freeze({ k: created.own, b: created.base });
    const names = Object.getOwnPropertyNames(merged);
    checksum = mix32(
      checksum,
      frozen.k + frozen.b + names.length + (Object.isFrozen(frozen) ? 1 : 0),
    );
  }
  return checksum;
}

// --- Array.prototype HOFs (map, filter, reduce, sort, flat, flatMap, find, some, every, splice, concat) ---
export function arrayHofsFull(scale: number): number {
  const base: number[] = [];
  for (let i = 0; i < 64; i++) base.push(((i * 37) % 53) - 10);
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const mapped = base.filter((x) => x > 0).map((x) => (x + (round & 7)) | 0);
    const reduced = mapped.reduce((acc, x) => (acc + x) | 0, 0);
    const sorted = mapped.slice().sort((a, b) => a - b);
    const nested: number[][] = [sorted.slice(0, 8), sorted.slice(8, 16)];
    const flattened = nested.flat(1);
    const flatMapped = flattened.flatMap((x) => [x, x + 1]);
    const spliced = flatMapped.slice();
    spliced.splice(2, 3, round & 15, (round + 1) & 15);
    const joined = spliced.concat([1, 2, 3]);
    const found = joined.find((x) => x > 20) ?? 0;
    const anyBig = joined.some((x) => x > 40) ? 1 : 0;
    const allNum = joined.every((x) => x > -100) ? 2 : 0;
    checksum = mix32(
      checksum,
      reduced + joined.length + found + anyBig + allNum,
    );
  }
  return checksum;
}

// --- RegExp (test, exec with /g + captures, match, replace) ---
export function regexpMatchExecReplace(scale: number): number {
  const text = "user_12=400; item_99=1250; order_7=89; user_34=510; item_0=17;";
  const testRe = /\b(?:user|item)_\d+=\d+/;
  const globalRe = /([a-z]+)_(\d+)=(\d+)/g;
  const replaceRe = /(\d+)/g;
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const matched = testRe.test(text) ? 1 : 0;
    globalRe.lastIndex = 0;
    let groupSum = 0;
    let m: RegExpExecArray | null = globalRe.exec(text);
    while (m !== null) {
      groupSum =
        (groupSum + (m[1]?.length ?? 0) + Number(m[2]) + Number(m[3])) | 0;
      m = globalRe.exec(text);
    }
    const all = text.match(replaceRe);
    const replaced = text.replace(replaceRe, "[$1]");
    checksum = mix32(
      checksum,
      matched + groupSum + (all?.length ?? 0) + replaced.length,
    );
  }
  return checksum;
}

// --- Date ---
export function dateOperations(scale: number): number {
  const baseMs = Date.UTC(2026, 4, 15, 10, 30, 45, 123);
  const parsed = Date.parse("2026-05-15T10:30:45.123Z");
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const d = new Date(baseMs + round * 61000);
    const iso = d.toISOString();
    const parts =
      d.getUTCFullYear() +
      d.getUTCMonth() +
      d.getUTCDate() +
      d.getUTCHours() +
      d.getUTCMinutes() +
      d.getUTCSeconds();
    const utc = Date.UTC(2026, round % 12, (round % 28) + 1, round % 24);
    checksum = mix32(
      checksum,
      parts + iso.length + iso.charCodeAt(17) + ((utc - parsed) & 0xffff),
    );
  }
  return checksum;
}

// --- Symbol & Registry ---
export function symbolKeysRegistry(scale: number): number {
  const s1 = Symbol("alpha");
  const s2 = Symbol("beta");
  const g1 = Symbol.for("tint.bench.shared");
  const primitiveTarget = {
    value: 7,
    [Symbol.toPrimitive](hint: string): number | string {
      return hint === "string" ? "prim" : this.value * 3;
    },
  };
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const obj: Record<symbol, number> = {
      [s1]: round & 31,
      [s2]: (round * 3) & 63,
      [g1]: 19,
    };
    const syms = Object.getOwnPropertySymbols(obj);
    const keyName = Symbol.keyFor(g1) ?? "";
    const coerced = Number(primitiveTarget) + (round & 7);
    checksum = mix32(
      checksum,
      (obj[s1] ?? 0) +
        (obj[s2] ?? 0) +
        (obj[g1] ?? 0) +
        syms.length +
        keyName.length +
        coerced,
    );
  }
  return checksum;
}

// --- Proxy & Reflect ---
export function proxyReflect(scale: number): number {
  const target: { a: number; b: number; count: number } = {
    a: 1,
    b: 2,
    count: 0,
  };
  const objProxy = new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver) as number;
      return prop === "a" ? value + 1 : value;
    },
    set(t, prop, value, receiver) {
      t.count++;
      return Reflect.set(t, prop, value, receiver);
    },
    has(t, prop) {
      return Reflect.has(t, prop);
    },
  });
  function addFn(x: number, y: number): number {
    return (x * 3 + y) | 0;
  }
  const fnProxy = new Proxy(addFn, {
    apply(fn, thisArg, argList: number[]) {
      return (Reflect.apply(fn, thisArg, argList) + 1) | 0;
    },
  });
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    objProxy.a = round & 31;
    objProxy.b = (round * 5) & 63;
    const present = "a" in objProxy && "b" in objProxy ? 1 : 0;
    const called = fnProxy(objProxy.a, objProxy.b);
    checksum = mix32(checksum, called + present + target.count);
  }
  return checksum;
}

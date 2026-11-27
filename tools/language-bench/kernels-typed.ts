// Comprehensive typed language & builtin benchmark kernels.
// Written in erasable TypeScript:
//   - Node runs the stripped text directly.
//   - Tint compiles the typed text with TINT_GENERAL_FALLBACK=0 (zero fallback).
//   - Tint also compiles the stripped text with a realm guard to measure the
//     untyped/JS twin on the exact same workload.
// Every exported kernel takes `scale: number` and returns a deterministic 32-bit
// signed integer checksum.

function mix32(acc: number, value: number): number {
  return (Math.imul(acc, 31) + (value | 0)) | 0;
}

// ============================================================================
// 1. Serialization & Binary Data
// ============================================================================

interface JsonRecordItem {
  id: number;
  name: string;
  active: boolean;
  score: number;
  tags: number[];
}

export function jsonRoundtrip(scale: number): number {
  const payload: {
    version: number;
    label: string;
    items: JsonRecordItem[];
  } = {
    version: 3,
    label: "tint-bench-payload",
    items: [
      { id: 1, name: "alpha", active: true, score: 12.5, tags: [1, 2, 3, 4] },
      { id: 2, name: "beta", active: false, score: -7.25, tags: [5, 6] },
      { id: 3, name: "gamma", active: true, score: 0.125, tags: [7, 8, 9] },
      { id: 4, name: "delta", active: true, score: 1024, tags: [10] },
    ],
  };
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const compact = JSON.stringify(payload);
    const parsed = JSON.parse(compact) as {
      version: number;
      label: string;
      items: JsonRecordItem[];
    };
    const item = parsed.items[round & 3];
    const pretty = JSON.stringify(
      { id: round, name: item?.name ?? "", ok: item?.active ?? false },
      null,
      2,
    );
    const filtered = JSON.stringify({ a: round & 15, b: 99, c: round & 7 }, [
      "c",
      "a",
    ]);
    checksum = mix32(
      checksum,
      compact.length +
        pretty.length +
        filtered.length +
        parsed.version +
        (item?.id ?? 0) +
        (item?.tags[0] ?? 0),
    );
  }
  return checksum;
}

export function jsonEscapeStrings(scale: number): number {
  const samples: readonly string[] = [
    'line "quoted" \\ path\\to\\file\n\t\r',
    "plain ascii identifier 0123456789",
    "caf\u00e9 \u96ea \ud83d\ude00 control:\u0007\u001b\b\f",
    '{"nested":"value","slashes":"\\\\\\\\"}',
  ];
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const text = samples[round & 3] ?? "";
    const encoded = JSON.stringify(text);
    const decoded = JSON.parse(encoded) as string;
    checksum = mix32(
      checksum,
      encoded.length +
        decoded.length +
        decoded.charCodeAt(round % decoded.length),
    );
  }
  return checksum;
}

export function dataViewEndian(scale: number): number {
  const buffer = new ArrayBuffer(64);
  const view = new DataView(buffer);
  const sub = new DataView(buffer, 16, 32);
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const le = (round & 1) === 0;
    view.setInt8(0, (round & 127) - 64);
    view.setUint8(1, round & 255);
    view.setInt16(2, (round * 13) & 0x7fff, le);
    view.setUint16(4, (round * 29) & 0xffff, !le);
    view.setInt32(8, (round * 2654435761) | 0, le);
    view.setUint32(12, (round * 1103515245) >>> 0, !le);
    sub.setFloat16(0, (round & 63) * 0.25 + 0.5, le);
    sub.setFloat32(4, (round & 255) * 0.125 - 4.5, !le);
    sub.setFloat64(8, (round & 511) * 0.0625 + 1.5, le);
    const big = (BigInt(round) << 20n) ^ 0x123456789abcn;
    sub.setBigInt64(16, big, le);
    sub.setBigUint64(24, big & 0xffffffffffffffffn, !le);

    const a = view.getInt8(0) + view.getUint8(1);
    const b = view.getInt16(2, le) ^ view.getUint16(4, !le);
    const c = view.getInt32(8, le) + (view.getUint32(12, !le) | 0);
    const f = Math.floor(
      sub.getFloat16(0, le) * 4 +
        sub.getFloat32(4, !le) * 8 +
        sub.getFloat64(8, le) * 16,
    );
    const bi = Number(
      (sub.getBigInt64(16, le) ^ sub.getBigUint64(24, !le)) & 0x7fffffffn,
    );
    checksum = mix32(checksum, a + b + c + f + bi);
  }
  return checksum;
}

export function sharedArrayBufferViews(scale: number): number {
  const sab = new SharedArrayBuffer(128);
  const bytes = new Uint8Array(sab, 0, 32);
  const words = new Int32Array(sab, 32, 8);
  const floats = new Float64Array(sab, 64, 4);
  const bigs = new BigInt64Array(sab, 96, 4);
  const dv = new DataView(sab, 0, 128);
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const idx = round & 3;
    bytes[round & 31] = (round * 7) & 255;
    words[round & 7] = (round * 31 + 17) | 0;
    floats[idx] = (round & 63) * 0.5 + 1.25;
    bigs[idx] = BigInt(round) * 1000003n - 7n;

    const w = dv.getInt32(32 + (round & 7) * 4, true);
    const f = Math.floor(dv.getFloat64(64 + idx * 8, true) * 4);
    const b = Number(dv.getBigInt64(96 + idx * 8, true) & 0x7fffffffn);
    checksum = mix32(checksum, (bytes[round & 31] ?? 0) + w + f + b);
  }
  return checksum;
}

export function bigintArithmetic(scale: number): number {
  let acc = 0x123456789abcdef1n;
  let wide = (1n << 128n) + 0xfeedfacecafebeefn;
  const mod = 0x7fffffffn;
  for (let round = 0; round < scale; round++) {
    const step = BigInt(round + 1);
    acc = (acc * 6364136223846793005n + step) & ((1n << 96n) - 1n);
    const shifted = (acc >> 17n) ^ (step << 9n);
    wide = wide + shifted * 3n - wide / 17n + (acc % 97n);
    if (wide > 1n << 160n) wide = wide & ((1n << 140n) - 1n);
  }
  return Number((acc ^ wide) & mod) | 0;
}

export function bigintParse(scale: number): number {
  const inputs: readonly string[] = [
    "42",
    "  -987654321098765432109876543210  ",
    "0xdeadbeefcafe1234",
    "0o777666555444333",
    "0b110101101001101101011010",
    "+123456789012345678901234567890",
    "   ",
    "0X123456789ABCDEF0123456789ABCDEF",
  ];
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const raw = inputs[round & 7] ?? "0";
    const value = BigInt(raw);
    const folded = Number((value ^ (value >> 32n)) & 0x7fffffffn);
    checksum = mix32(checksum, folded);
  }
  return checksum;
}

export function bigintTypedArrays(scale: number): number {
  const size = 256;
  const signed = new BigInt64Array(size);
  const unsigned = new BigUint64Array(size);
  for (let i = 0; i < size; i++) {
    signed[i] = BigInt(i * 17 - 2000) << 12n;
    unsigned[i] = (BigInt(i) * 0x9e3779b9n) & 0xffffffffffffffffn;
  }
  let acc = 0n;
  for (let round = 0; round < scale; round++) {
    const delta = BigInt(round);
    for (let i = 0; i < size; i++) {
      const s = (signed[i] ?? 0n) + delta;
      signed[i] = s;
      const u = ((unsigned[i] ?? 0n) ^ (delta << 3n)) + 7n;
      unsigned[i] = u;
      acc = (acc + s + u) & 0xffffffffn;
    }
  }
  return Number(acc & 0x7fffffffn) | 0;
}

export function float16Array(scale: number): number {
  const size = 512;
  const a = new Float16Array(size);
  const b = new Float16Array(size);
  for (let i = 0; i < size; i++) {
    a[i] = (i % 29) * 0.25 - 3.5;
    b[i] = (i % 19) * 0.125 + 0.5;
  }
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    let dot = 0;
    for (let i = 1; i < size - 1; i++) {
      const next = Math.f16round(
        ((a[i - 1] ?? 0) + (a[i] ?? 0) * 2 + (a[i + 1] ?? 0)) * 0.25,
      );
      a[i] = next;
      dot += next * (b[i] ?? 0);
    }
    checksum = mix32(checksum, Math.floor(dot * 8));
  }
  return checksum;
}

export function atomicsOps(scale: number): number {
  const sab = new SharedArrayBuffer(64);
  const u32 = new Uint32Array(sab, 0, 8);
  const u16 = new Uint16Array(sab, 32, 8);
  const u8 = new Uint8Array(sab, 48, 16);
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const i = round & 7;
    Atomics.store(u32, i, round & 0xffff);
    const oldAdd = Atomics.add(u32, i, 7);
    const oldSub = Atomics.sub(u32, i, 3);
    const oldXor = Atomics.xor(u32, i, 0x55);
    const cur = Atomics.load(u32, i);
    const cas = Atomics.compareExchange(u32, i, cur, cur + 1);

    const hOld = Atomics.exchange(u16, i, (round * 3) & 0xffff);
    const bOld = Atomics.or(u8, round & 15, 0x0f);
    const bAnd = Atomics.and(u8, round & 15, 0x3c);

    checksum = mix32(
      checksum,
      (oldAdd + oldSub + oldXor + cas + hOld + bOld + bAnd) | 0,
    );
  }
  return checksum;
}

// ============================================================================
// 2. Classes & Modern OOP
// ============================================================================

class Vault {
  #balance: number;
  readonly #id: number;
  static #ops: number = 0;

  constructor(id: number, initial: number) {
    this.#id = id;
    this.#balance = initial;
  }

  #adjust(delta: number): number {
    this.#balance = (this.#balance + delta) | 0;
    return this.#balance;
  }

  get #scaled(): number {
    return this.#balance * 3 + this.#id;
  }

  set #scaled(v: number) {
    this.#balance = (v - this.#id) | 0;
  }

  static #bump(n: number): number {
    Vault.#ops = (Vault.#ops + n) | 0;
    return Vault.#ops;
  }

  static resetOps(): void {
    Vault.#ops = 0;
  }

  step(other: Vault, delta: number): number {
    const next = this.#adjust(delta);
    this.#scaled = this.#scaled + (other.#balance & 7);
    return (next + this.#balance + Vault.#bump(1)) | 0;
  }

  static hasBrand(value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      #balance in value &&
      #adjust in value
    );
  }

  static readBalance(value: unknown): number {
    if (typeof value === "object" && value !== null && #balance in value) {
      return value.#balance;
    }
    return -1;
  }
}

class DecoyVault {
  #balance: number;
  constructor(v: number) {
    this.#balance = v;
  }
  read(): number {
    return this.#balance;
  }
}

export function privateFieldsMethods(scale: number): number {
  Vault.resetOps();
  const vaults: Vault[] = [];
  for (let i = 0; i < 64; i++) vaults.push(new Vault(i, i * 11));
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const a = vaults[round & 63];
    const b = vaults[(round * 7 + 3) & 63];
    if (a === undefined || b === undefined) throw new Error("vault");
    checksum = mix32(checksum, a.step(b, (round & 15) - 7));
  }
  return checksum;
}

function checkBrandValue(candidate: unknown): number {
  if (Vault.hasBrand(candidate)) return Vault.readBalance(candidate);
  return 1;
}

export function privateBrandChecks(scale: number): number {
  const vaults: Vault[] = [];
  const decoys: DecoyVault[] = [];
  const plains: { balance: number }[] = [];
  for (let i = 0; i < 32; i++) {
    vaults.push(new Vault(i, i * 5));
    decoys.push(new DecoyVault(i));
    plains.push({ balance: i });
  }
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < 16; i++) {
      const idx = (round + i) & 31;
      const lane = (round + i) % 3;
      const score =
        lane === 0
          ? checkBrandValue(vaults[idx])
          : lane === 1
            ? checkBrandValue(decoys[idx])
            : checkBrandValue(plains[idx]);
      checksum = mix32(checksum, score);
    }
  }
  return checksum;
}

class StaticRegistry {
  static seed: number = 17;
  static #multiplier: number = 3;
  static table: number[] = [];
  static {
    for (let i = 0; i < 32; i++) {
      StaticRegistry.table.push(
        (i * StaticRegistry.#multiplier + StaticRegistry.seed) | 0,
      );
    }
  }
  static lookup(index: number): number {
    return (StaticRegistry.table[index & 31] ?? 0) + StaticRegistry.#multiplier;
  }
}

const BaseExpr = class BaseWidget {
  #base: number;
  constructor(base: number) {
    this.#base = base;
  }
  value(): number {
    return this.#base;
  }
};

const DerivedExpr = class extends BaseExpr {
  #extra: number;
  constructor(base: number, extra: number) {
    super(base);
    this.#extra = extra;
  }
  override value(): number {
    return super.value() * 2 + this.#extra;
  }
};

export function staticBlocksExpressions(scale: number): number {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const w = new DerivedExpr(round & 63, StaticRegistry.lookup(round));
    const b = new BaseExpr(round & 31);
    checksum = mix32(checksum, w.value() + b.value());
  }
  return checksum;
}

class Entity {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  score(): number {
    return (this.x + this.y) | 0;
  }
}

class Actor extends Entity {
  vx: number;
  vy: number;
  constructor(x: number, y: number, vx: number, vy: number) {
    super(x, y);
    this.vx = vx;
    this.vy = vy;
  }
  override score(): number {
    return (super.score() + this.vx * 3 + this.vy * 5) | 0;
  }
}

class Hero extends Actor {
  level: number;
  constructor(x: number, y: number, vx: number, vy: number, level: number) {
    super(x, y, vx, vy);
    this.level = level;
  }
  override score(): number {
    return (super.score() * 2 + this.level * 7) | 0;
  }
}

class Prop extends Entity {
  weight: number;
  constructor(x: number, y: number, weight: number) {
    super(x, y);
    this.weight = weight;
  }
  override score(): number {
    return (super.score() + this.weight * 11) | 0;
  }
}

class Crate extends Prop {
  items: number;
  constructor(x: number, y: number, weight: number, items: number) {
    super(x, y, weight);
    this.items = items;
  }
  override score(): number {
    return (super.score() + this.items * 13) | 0;
  }
}

export function deepInheritanceSuper(scale: number): number {
  const entities: Entity[] = [];
  for (let i = 0; i < 64; i++) {
    const kind = i % 4;
    if (kind === 0) entities.push(new Entity(i, i + 1));
    else if (kind === 1) entities.push(new Actor(i, i + 2, i & 7, i & 3));
    else if (kind === 2)
      entities.push(new Hero(i, i + 3, i & 7, i & 3, (i & 15) + 1));
    else entities.push(new Crate(i, i + 4, (i & 7) + 1, i & 15));
  }
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < 16; i++) {
      const entity = entities[(round + i) & 63];
      if (entity === undefined) throw new Error("entity");
      checksum = mix32(checksum, entity.score());
    }
  }
  return checksum;
}

class Meter {
  _raw: number;
  readonly ceiling: number;
  constructor(raw: number, ceiling: number) {
    this._raw = raw;
    this.ceiling = ceiling;
  }
  get value(): number {
    const scaled = this._raw * 2 + 1;
    return scaled > this.ceiling ? this.ceiling : scaled;
  }
  set value(v: number) {
    this._raw = v < 0 ? 0 : v > 1000 ? 1000 : v;
  }
}

export function classAccessorsInstanceof(scale: number): number {
  const meters: Meter[] = [];
  for (let i = 0; i < 32; i++) {
    meters.push(new Meter(i * 3, i % 2 === 0 ? 500 : 120));
  }
  const entities: Entity[] = [];
  for (let i = 0; i < 32; i++) {
    const kind = i % 3;
    if (kind === 0) entities.push(new Entity(i, i + 1));
    else if (kind === 1) entities.push(new Actor(i, i + 2, 1, 2));
    else entities.push(new Hero(i, i + 3, 1, 2, i));
  }
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < 16; i++) {
      const m = meters[(round + i) & 31];
      const e = entities[(round + i) & 31];
      if (m === undefined || e === undefined) throw new Error("meter");
      m.value = (m.value + (round & 7) - 3) | 0;
      const bonus =
        e instanceof Hero
          ? 7
          : e instanceof Actor
            ? 3
            : e instanceof Entity
              ? 1
              : 0;
      checksum = mix32(checksum, m.value + bonus);
    }
  }
  return checksum;
}

// ============================================================================
// 3. Math Builtins
// ============================================================================

export function mathTranscendental(scale: number): number {
  let acc = 0;
  for (let round = 0; round < scale; round++) {
    const x = ((round & 1023) - 512) * 0.005;
    const y = ((round * 7) & 255) * 0.01 + 0.1;
    acc +=
      Math.sin(x) +
      Math.cos(x) +
      Math.tan(x * 0.25) +
      Math.atan2(y, x + 0.5) +
      Math.sqrt(y + 1) +
      Math.cbrt(x) +
      Math.tanh(x);
  }
  return Math.floor(acc * 1000) | 0;
}

export function mathBitwiseRounding(scale: number): number {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const x = (round * 2654435761) | 0;
    const f = (round & 511) * 0.137 - 30.25;
    const a = Math.imul(x, 0x45d9f3b) ^ Math.clz32(x);
    const b =
      Math.floor(f) +
      Math.ceil(f) +
      Math.round(f) +
      Math.trunc(f) +
      Math.sign(f) +
      Math.min(Math.abs(round & 63), 40) +
      Math.max(round & 31, 10);
    const c = Math.floor((Math.fround(f) + Math.f16round(f)) * 4);
    checksum = mix32(checksum, a + b + c);
  }
  return checksum;
}

export function mathHypotPowLog(scale: number): number {
  let acc = 0;
  for (let round = 0; round < scale; round++) {
    const a = (round & 63) * 0.05 + 1.0;
    const b = ((round * 3) & 31) * 0.05 + 0.5;
    const c = ((round * 5) & 15) * 0.1 + 0.25;
    acc +=
      Math.pow(a, 1.5) +
      Math.exp(b * 0.25) +
      Math.expm1(c * 0.1) +
      Math.log(a) +
      Math.log2(a + 1) +
      Math.log10(a + 2) +
      Math.log1p(c) +
      Math.hypot(a, b) +
      Math.hypot(a, b, c);
  }
  return Math.floor(acc * 1000) | 0;
}

// ============================================================================
// 4. String Builtins & Templates
// ============================================================================

export function stringReplaceAll(scale: number): number {
  const base = "alpha-beta-gamma-beta-delta-beta-epsilon";
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const r1 = base.replace("beta", "[$&]");
    const r2 = base.replaceAll("beta", "X");
    const r3 = base.replace("missing", "Y");
    const r4 = r2.replaceAll("-", "::");
    checksum = mix32(
      checksum,
      r1.length +
        r2.length +
        r3.length +
        r4.length +
        r4.charCodeAt(round % r4.length),
    );
  }
  return checksum;
}

export function stringNormalizeUnicode(scale: number): number {
  const ascii = "plain_ascii_identifier_1234567890";
  const decomposed = "cafe\u0301 na\u00efve re\u0301sume\u0301 \u1100\u1161";
  const compat = "\ufb01le \u212bngstrom \u2460";
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const a = ascii.normalize("NFC");
    const nfc = decomposed.normalize("NFC");
    const nfd = nfc.normalize("NFD");
    const nfkc = compat.normalize("NFKC");
    const nfkd = compat.normalize("NFKD");
    checksum = mix32(
      checksum,
      a.length +
        nfc.length +
        nfd.length +
        nfkc.length +
        nfkd.length +
        nfc.charCodeAt(round % nfc.length),
    );
  }
  return checksum;
}

export function stringCaseAsciiUnicode(scale: number): number {
  const ascii = "The Quick Brown Fox Jumps Over 123 Lazy Dogs!";
  const unicode =
    "Stra\u00dfe \u038c\u03a3\u039f\u03a3 \u0130stanbul \ud801\udc00";
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const lo = ascii.toLowerCase();
    const hi = ascii.toUpperCase();
    const uLo = unicode.toLowerCase();
    const uHi = unicode.toUpperCase();
    checksum = mix32(
      checksum,
      lo.charCodeAt(round % lo.length) +
        hi.charCodeAt(round % hi.length) +
        uLo.length +
        uHi.length,
    );
  }
  return checksum;
}

export function stringTrimPadSearch(scale: number): number {
  const raw = "  \t\n  hello_world_payload_42  \r\n ";
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const trimmed = raw.trim();
    const left = raw.trimStart();
    const right = raw.trimEnd();
    const padded = trimmed.padStart(30, "0").padEnd(36, "_");
    const rep = "ab".repeat((round & 7) + 1);
    const flags =
      (trimmed.startsWith("hello") ? 1 : 0) +
      (trimmed.endsWith("42") ? 2 : 0) +
      (trimmed.includes("payload") ? 4 : 0);
    const parts = trimmed.split("_");
    checksum = mix32(
      checksum,
      left.length +
        right.length +
        padded.length +
        rep.length +
        flags +
        parts.length +
        (parts[1]?.slice(0, 3).length ?? 0),
    );
  }
  return checksum;
}

// ============================================================================
// 5. Control Flow, Syntax & Functional Patterns
// ============================================================================

interface DestructNode {
  readonly id: number;
  readonly meta: { readonly weight: number; readonly bias?: number };
  readonly coords: readonly number[];
}

function sumPair({
  meta: { weight, bias = 5 },
  coords: [x = 0, y = 0, z = 0],
}: DestructNode): number {
  return (weight + bias + x + y * 2 + z * 3) | 0;
}

export function destructuringPatterns(scale: number): number {
  const nodes: DestructNode[] = [];
  for (let i = 0; i < 32; i++) {
    nodes.push({
      id: i,
      meta: i % 2 === 0 ? { weight: i * 3, bias: i } : { weight: i * 3 },
      coords: [i, i + 1, i + 2],
    });
  }
  let a = 1;
  let b = 2;
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const node = nodes[round & 31];
    if (node === undefined) throw new Error("node");
    const {
      id,
      meta: { weight, bias = 3 },
      ...restObj
    } = node;
    const [head = 0, ...tail] = restObj.coords;
    [a, b] = [b + (round & 3), a ^ (round & 7)];
    checksum = mix32(
      checksum,
      id + weight + bias + head + tail.length + sumPair(node) + a + b,
    );
  }
  return checksum;
}

function sumRestArgs(base: number, ...values: number[]): number {
  let total = base;
  for (let i = 0; i < values.length; i++)
    total = (total + (values[i] ?? 0)) | 0;
  return total;
}

export function spreadArrayObjectCall(scale: number): number {
  const left: number[] = [1, 2, 3, 4];
  const right: number[] = [5, 6, 7, 8];
  const base = { a: 10, b: 20, c: 30, d: 40 };
  const bytes = new Uint8Array(4);
  bytes[0] = 9;
  bytes[1] = 10;
  bytes[2] = 11;
  bytes[3] = 12;
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const combined: number[] = [...left, round & 15, ...right];
    const cloned = { ...base, b: round & 63, d: combined.length };
    const callSum = sumRestArgs(cloned.a, ...combined, ...bytes);
    checksum = mix32(checksum, callSum + cloned.b + cloned.c + cloned.d);
  }
  return checksum;
}

const switchKeywords: readonly string[] = [
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "export",
  "extends",
  "finally",
  "function",
  "import",
  "return",
  "switch",
  "throw",
];

function denseSwitch(k: number): number {
  switch (k) {
    case 0:
      return 3;
    case 1:
      return 7;
    case 2:
      return 11;
    case 3:
      return 13;
    case 4:
      return 17;
    case 5:
      return 19;
    case 6:
      return 23;
    case 7:
      return 29;
    case 8:
      return 31;
    case 9:
      return 37;
    case 10:
      return 41;
    case 11:
      return 43;
    case 12:
      return 47;
    case 13:
      return 53;
    case 14:
      return 59;
    case 15:
      return 61;
    default:
      return 1;
  }
}

function sparseSwitch(k: number): number {
  switch (k) {
    case 1:
      return 10;
    case 17:
      return 20;
    case 64:
      return 30;
    case 257:
      return 40;
    case 1024:
      return 50;
    case 4099:
      return 60;
    case 9973:
      return 70;
    default:
      return k & 7;
  }
}

function stringSwitch(word: string): number {
  switch (word) {
    case "break":
      return 1;
    case "case":
      return 2;
    case "catch":
      return 3;
    case "class":
      return 4;
    case "const":
      return 5;
    case "continue":
      return 6;
    case "default":
      return 7;
    case "delete":
      return 8;
    case "export":
      return 9;
    case "extends":
      return 10;
    case "finally":
      return 11;
    case "function":
      return 12;
    case "import":
      return 13;
    case "return":
      return 14;
    case "switch":
      return 15;
    case "throw":
      return 16;
    default:
      return 0;
  }
}

export function switchDenseSparseString(scale: number): number {
  const sparseInputs: readonly number[] = [
    1, 17, 64, 257, 1024, 4099, 9973, 42,
  ];
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const a = denseSwitch(round & 15);
    const b = sparseSwitch(sparseInputs[round & 7] ?? 0);
    const c = stringSwitch(switchKeywords[round & 15] ?? "");
    checksum = mix32(checksum, a + b + c);
  }
  return checksum;
}

function guardedCompute(x: number): number {
  let out = 0;
  try {
    out = (x * 7 + 13) | 0;
    if (x === -999999999) throw new RangeError("never");
  } catch {
    out = -1;
  } finally {
    out = (out + 1) | 0;
  }
  return out;
}

export function tryCatchNoThrow(scale: number): number {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    checksum = mix32(checksum, guardedCompute(round));
  }
  return checksum;
}

function validateValue(x: number): number {
  const mode = x & 7;
  if (mode === 0) throw new TypeError("bad type");
  if (mode === 3) throw new RangeError("out of range");
  if (mode === 6) throw new Error("generic");
  return x * 3 + 1;
}

export function tryCatchThrowError(scale: number): number {
  let checksum = 0;
  let caught = 0;
  for (let round = 0; round < scale; round++) {
    let local = 0;
    try {
      local = validateValue(round);
    } catch (err) {
      if (err instanceof TypeError) caught += 2;
      else if (err instanceof RangeError) caught += 3;
      else if (err instanceof Error) caught += 5;
      else caught += 1;
    } finally {
      local = (local + 1) | 0;
    }
    checksum = mix32(checksum, local + caught);
  }
  return checksum;
}

interface OptNode {
  readonly child?: {
    readonly items?: readonly number[];
    readonly compute?: (x: number) => number;
  };
  cached?: number;
  flag: number;
}

export function optionalChainingNullish(scale: number): number {
  const nodes: OptNode[] = [];
  for (let i = 0; i < 32; i++) {
    if (i % 3 === 0) {
      nodes.push({ flag: 0 });
    } else if (i % 3 === 1) {
      nodes.push({ child: { items: [i, i + 1] }, flag: 1 });
    } else {
      nodes.push({
        child: { items: [i * 2, i * 3], compute: (x: number) => (x + i) | 0 },
        cached: i,
        flag: 2,
      });
    }
  }
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const node = nodes[round & 31];
    if (node === undefined) throw new Error("opt");
    const elem = node.child?.items?.[round & 1] ?? 11;
    const computed = node.child?.compute?.(round & 15) ?? 7;
    let slot: number | undefined = (round & 1) === 0 ? undefined : node.cached;
    slot ??= elem;
    let flag = node.flag;
    flag ||= 4;
    flag &&= flag + 1;
    checksum = mix32(checksum, elem + computed + slot + flag);
  }
  return checksum;
}

function calcWithDefaults(
  a: number = 3,
  b: number = a * 2 + 1,
  ...rest: number[]
): number {
  let acc = (a * 5 + b) | 0;
  for (let i = 0; i < rest.length; i++) acc = (acc + (rest[i] ?? 0)) | 0;
  return acc;
}

export function defaultRestParams(scale: number): number {
  const extra: number[] = [4, 7, 11];
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const r0 = calcWithDefaults();
    const r1 = calcWithDefaults(round & 15);
    const r2 = calcWithDefaults(undefined, round & 31, 1, 2, 3);
    const r3 = calcWithDefaults(round & 7, undefined, ...extra);
    checksum = mix32(checksum, r0 + r1 + r2 + r3);
  }
  return checksum;
}

function makeNestedPipeline(seed: number): (x: number) => number {
  let outer = seed;
  return (a: number): number => {
    let middle = (outer + a) | 0;
    const inner = (b: number): (() => number) => {
      let leaf = (middle ^ b) | 0;
      return (): number => {
        outer = (outer + 1) | 0;
        middle = (middle + 3) | 0;
        leaf = (leaf + outer + middle) | 0;
        return leaf;
      };
    };
    const step = inner(a & 15);
    return (step() + step()) | 0;
  };
}

export function nestedClosures(scale: number): number {
  const pipes: ((x: number) => number)[] = [];
  for (let i = 0; i < 8; i++) pipes.push(makeNestedPipeline(i * 13 + 1));
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const fn = pipes[round & 7];
    if (fn === undefined) throw new Error("pipe");
    checksum = mix32(checksum, fn(round & 63));
  }
  return checksum;
}

export function forOfCollections(scale: number): number {
  const nums: number[] = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8];
  const ta = new Uint32Array(8);
  for (let i = 0; i < 8; i++) ta[i] = (i + 1) * 10;
  const map = new Map<string, number>();
  map.set("k1", 11);
  map.set("k2", 22);
  map.set("k3", 33);
  map.set("k4", 44);
  const set = new Set<number>();
  for (let i = 1; i <= 6; i++) set.add(i * 7);
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    let sum = 0;
    for (const n of nums) sum = (sum + n) | 0;
    for (const w of ta) sum = (sum + w) | 0;
    for (const [k, v] of map) sum = (sum + k.length + v) | 0;
    for (const s of set) sum = (sum + s) | 0;
    checksum = mix32(checksum, sum + round);
  }
  return checksum;
}

// ============================================================================
// 6. Collections & Objects
// ============================================================================

export function mapSetDeleteRehash(scale: number): number {
  const keys: string[] = [];
  for (let i = 0; i < 128; i++) keys.push("k_" + String(i));
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const map = new Map<string, number>();
    const set = new Set<number>();
    for (let i = 0; i < 128; i++) {
      const k = keys[i];
      if (k === undefined) throw new Error("key");
      map.set(k, i + round);
      set.add(i);
    }
    for (let i = 0; i < 128; i += 2) {
      const k = keys[i];
      if (k === undefined) throw new Error("key");
      map.delete(k);
      set.delete(i);
    }
    for (let i = 0; i < 64; i++) {
      const k = keys[(i * 2) & 127];
      if (k === undefined) throw new Error("key");
      map.set(k, i * 3);
      set.add(i + 200);
    }
    let iterSum = 0;
    for (const [, v] of map) iterSum = (iterSum + v) | 0;
    for (const v of set) iterSum = (iterSum + v) | 0;
    checksum = mix32(checksum, iterSum + map.size + set.size);
  }
  return checksum;
}

export function mapSetBigIntKeys(scale: number): number {
  const base = 1n << 100n;
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const map = new Map<bigint, number>();
    const set = new Set<bigint>();
    for (let i = 0; i < 48; i++) {
      const key = base + BigInt(i * 7 + (round & 3));
      map.set(key, i * 5);
      set.add(key);
    }
    let sum = 0;
    for (let i = 0; i < 48; i++) {
      const probe = base + BigInt(i * 7 + (round & 3));
      sum = (sum + (map.get(probe) ?? 0) + (set.has(probe) ? 1 : 0)) | 0;
    }
    for (let i = 0; i < 48; i += 3) {
      const probe = base + BigInt(i * 7 + (round & 3));
      map.delete(probe);
      set.delete(probe);
    }
    for (const [, v] of map) sum = (sum + v) | 0;
    checksum = mix32(checksum, sum + map.size + set.size);
  }
  return checksum;
}

interface KeyRecord {
  readonly id: number;
}

export function mapSetObjectKeys(scale: number): number {
  const keys: KeyRecord[] = [];
  for (let i = 0; i < 64; i++) keys.push({ id: i });
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const map = new Map<KeyRecord, number>();
    const set = new Set<KeyRecord>();
    for (let i = 0; i < 64; i++) {
      const k = keys[i];
      if (k === undefined) throw new Error("key");
      map.set(k, i + round);
      set.add(k);
    }
    let sum = 0;
    for (let i = 0; i < 64; i++) {
      const k = keys[(i * 5 + round) & 63];
      if (k === undefined) throw new Error("key");
      sum = (sum + (map.get(k) ?? 0) + (set.has(k) ? 1 : 0)) | 0;
    }
    for (let i = 0; i < 32; i++) {
      const k = keys[i];
      if (k === undefined) throw new Error("key");
      map.delete(k);
      set.delete(k);
    }
    checksum = mix32(checksum, sum + map.size + set.size);
  }
  return checksum;
}

export function objectDynamicOps(scale: number): number {
  const names: readonly string[] = [
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "zeta",
    "eta",
    "theta",
  ];
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const dict: Record<string, number> = {};
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (name === undefined) throw new Error("name");
      dict[name] = i * 7 + (round & 15);
    }
    Object.defineProperty(dict, "defined", {
      value: round & 31,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    const hasBeta = "beta" in dict ? 1 : 0;
    const hasOwnDef = Object.hasOwn(dict, "defined") ? 2 : 0;
    delete dict["gamma"];
    let forInLen = 0;
    for (const k in dict) forInLen += k.length;
    const keys = Object.keys(dict);
    const values = Object.values(dict);
    const entries: [string, number][] = Object.entries(dict);
    let valSum = 0;
    for (let i = 0; i < values.length; i++) valSum += values[i] ?? 0;
    checksum = mix32(
      checksum,
      hasBeta + hasOwnDef + forInLen + keys.length + entries.length + valSum,
    );
  }
  return checksum;
}

// ============================================================================
// 7. Standard Builtins (Typed-Native)
// ============================================================================

export function errorConstruction(scale: number): number {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const e1 = new Error("err-" + String(round & 15));
    const e2 = new TypeError("type-" + String(round & 7));
    const e3 = new RangeError("range-" + String(round & 3));
    const check =
      (e1 instanceof Error ? 1 : 0) +
      (e2 instanceof TypeError && e2 instanceof Error ? 2 : 0) +
      (e3 instanceof RangeError && e3 instanceof Error ? 4 : 0);
    checksum = mix32(
      checksum,
      e1.message.length +
        e2.name.length +
        e3.message.length +
        e3.name.length +
        check,
    );
  }
  return checksum;
}

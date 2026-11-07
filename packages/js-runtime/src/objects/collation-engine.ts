import { decodeFloat64 } from "@tint/foundation/binary/bytes";
import {
  normalizeUnicode,
  canonicalCombiningClass,
} from "@tint/foundation/unicode/normalization";
import {
  rootPacked,
  decimalZeros,
  tailoringPacked,
  collationNumericPrimary,
  collationHanBase,
} from "./collation-data.ts";
interface Element {
  readonly primary: number;
  readonly secondary: number;
  readonly tertiary: number;
}
interface Prefix {
  readonly prefix: string;
  readonly elements: readonly Element[];
}
interface Data {
  readonly rows: Map<string, readonly Element[]>;
  readonly prefixes: Map<string, Prefix[]>;
  readonly widths: Map<number, number>;
  readonly extendable: Set<string>;
  readonly han: readonly number[];
  readonly overrides: Map<string, readonly Element[] | null>;
  readonly reorder: string;
}
export interface CollationOptions {
  readonly sensitivity: "base" | "accent" | "case" | "variant";
  readonly caseFirst: "false" | "lower" | "upper";
  readonly numeric: boolean;
  readonly ignorePunctuation: boolean;
  readonly profile: string;
}
let cached: Data | undefined = undefined;
function points(text: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i);
    if (cp === undefined) throw "COLLATION_CODE_POINT";
    result.push(String.fromCodePoint(cp));
    i += cp > 65535 ? 2 : 1;
  }
  return result;
}
function point(text: string): number {
  const cp = text.codePointAt(0);
  if (cp === undefined) throw "COLLATION_EMPTY_POINT";
  return cp;
}
function data(): Data {
  if (cached !== undefined) return cached;
  let offset = 0;
  function read(): number {
    let result = 0,
      scale = 1;
    for (;;) {
      const code = rootPacked.charCodeAt(offset++) - 48;
      if (code < 0 || code >= 64 || !Number.isFinite(code))
        throw "COLLATION_PACKED_DATA";
      result += (code % 32) * scale;
      if (code < 32) return result;
      scale *= 32;
      if (scale > 4294967296) throw "COLLATION_PACKED_INTEGER";
    }
  }
  const weights: Element[] = [];
  const count = read();
  for (let i = 0; i < count; i++)
    weights.push({ primary: read(), secondary: read(), tertiary: read() });
  const rows = new Map<string, readonly Element[]>(),
    prefixes = new Map<string, Prefix[]>(),
    widths = new Map<number, number>(),
    extendable = new Set<string>();
  let first = 0;
  const rowCount = read();
  for (let i = 0; i < rowCount; i++) {
    first += read();
    const length = read();
    let key = String.fromCodePoint(first);
    for (let n = 1; n < length; n++) key += String.fromCodePoint(read());
    let prefix = "";
    const prefixLength = read();
    for (let n = 0; n < prefixLength; n++)
      prefix += String.fromCodePoint(read());
    const elements: Element[] = [];
    const width = read();
    for (let n = 0; n < width; n++) {
      const ce = weights[read()];
      if (ce === undefined) throw "COLLATION_WEIGHT_INDEX";
      elements.push(ce);
    }
    if (prefixLength !== 0) {
      let list = prefixes.get(key);
      if (list === undefined) {
        list = [];
        prefixes.set(key, list);
      }
      list.push({ prefix, elements });
    } else {
      rows.set(key, elements);
      widths.set(first, Math.max(widths.get(first) ?? 1, length));
      const chars = points(key);
      let start = "";
      for (let n = 0; n < chars.length - 1; n++) {
        const char = chars[n];
        if (char === undefined) throw "COLLATION_PREFIX";
        start += char;
        extendable.add(start);
      }
    }
  }
  const han: number[] = [];
  const ranges = read();
  for (let i = 0; i < ranges; i++) {
    han.push(read(), read());
  }
  if (offset !== rootPacked.length) throw "COLLATION_PACKED_TRAILING";
  cached = {
    rows,
    prefixes,
    widths,
    extendable,
    han,
    overrides: new Map<string, readonly Element[] | null>(),
    reorder: "",
  };
  return cached;
}
interface Profile {
  readonly overrides: Map<string, readonly Element[] | null>;
  readonly reorder: string;
  readonly shifted: boolean;
}
let profiles: Map<string, Profile> | undefined = undefined;
let tailoredData: Map<string, Data> | undefined = undefined;
function profileData(name: string | undefined): Data {
  const root = data();
  if (name === undefined || name === "root/standard") return root;
  const instances =
    tailoredData === undefined ? new Map<string, Data>() : tailoredData;
  tailoredData = instances;
  const prior = instances.get(name);
  if (prior !== undefined) return prior;
  if (profiles === undefined) {
    const result = new Map<string, Profile>();
    let offset = 0;
    function read(): number {
      let value = 0,
        scale = 1;
      for (;;) {
        const code = tailoringPacked.charCodeAt(offset++) - 48;
        if (code < 0 || code >= 64 || !Number.isFinite(code))
          throw "COLLATION_TAILORING_DATA";
        value += (code % 32) * scale;
        if (code < 32) return value;
        scale *= 32;
        if (scale > 4503599627370496) throw "COLLATION_TAILORING_INTEGER";
      }
    }
    function text(): string {
      let value = "";
      const n = read();
      for (let i = 0; i < n; i++) value += String.fromCharCode(read());
      return value;
    }
    function number(): number {
      const value = read();
      if (value % 2 === 0) return value / 2;
      if (value !== 1) throw "COLLATION_FLOAT_TAG";
      const lo = read(),
        hi = read(),
        result = decodeFloat64({ lo, hi });
      if (!result.ok || !Number.isFinite(result.value)) throw "COLLATION_FLOAT";
      return result.value;
    }
    const count = read();
    for (let i = 0; i < count; i++) {
      const key = text(),
        reorder = text(),
        shifted = read() !== 0,
        overrides = new Map<string, readonly Element[] | null>();
      const n = read();
      for (let j = 0; j < n; j++) {
        const key = text(),
          width = read();
        if (width === 0) {
          overrides.set(key, null);
          continue;
        }
        const ces: Element[] = [];
        for (let k = 1; k < width; k++)
          ces.push({
            primary: number(),
            secondary: number(),
            tertiary: number(),
          });
        overrides.set(key, ces);
      }
      result.set(key, { overrides, reorder, shifted });
    }
    if (offset !== tailoringPacked.length) throw "COLLATION_TAILORING_TRAILING";
    profiles = result;
  }
  const profile = profiles.get(name);
  if (profile === undefined) throw "COLLATION_PROFILE";
  const widths = new Map<number, number>(),
    extendable = new Set<string>();
  for (const [cp, width] of root.widths) widths.set(cp, width);
  for (const key of root.extendable) extendable.add(key);
  for (const [key, ces] of profile.overrides) {
    if (ces === null) continue;
    const chars = points(key),
      first = point(key);
    widths.set(first, Math.max(widths.get(first) ?? 1, chars.length));
    let start = "";
    for (let n = 0; n < chars.length - 1; n++) {
      const char = chars[n];
      if (char === undefined) throw "COLLATION_PREFIX";
      start += char;
      extendable.add(start);
    }
  }
  const result: Data = {
    rows: root.rows,
    prefixes: root.prefixes,
    widths,
    extendable,
    han: root.han,
    overrides: profile.overrides,
    reorder: profile.reorder,
  };
  instances.set(name, result);
  return result;
}
function row(data: Data, key: string): readonly Element[] | undefined {
  if (data.overrides.has(key)) return data.overrides.get(key) ?? undefined;
  return data.rows.get(key);
}
function implicit(cp: number, root: Data): Element {
  let rank = 0;
  for (let i = 0; i < root.han.length; i += 2) {
    const start = root.han[i],
      end = root.han[i + 1];
    if (start === undefined || end === undefined) throw "COLLATION_HAN_RANGE";
    if (cp >= start && cp <= end)
      return {
        primary: collationHanBase + (rank + cp - start) * 128,
        secondary: 1280,
        tertiary: 1280,
      };
    rank += end - start + 1;
  }
  return { primary: 3758096384 + cp * 64, secondary: 1280, tertiary: 1280 };
}
function digit(cp: number): number {
  let low = 0,
    high = decimalZeros.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2),
      zero = decimalZeros[middle];
    if (zero === undefined) throw "COLLATION_DECIMAL_RANGE";
    if (zero <= cp) low = middle + 1;
    else high = middle;
  }
  const zero = decimalZeros[low - 1];
  return zero !== undefined && cp < zero + 10 ? cp - zero : -1;
}
function elements(value: string, options: CollationOptions): Element[] {
  const normalized = normalizeUnicode(value, "NFD");
  if (normalized === undefined) throw "COLLATION_NORMALIZATION";
  const root = profileData(options.profile),
    chars = points(normalized),
    result: Element[] = [];
  for (let i = 0; i < chars.length;) {
    const current = chars[i];
    if (current === undefined) throw "COLLATION_POSITION";
    if (options.numeric && digit(point(current)) >= 0) {
      const digits: number[] = [];
      while (i < chars.length) {
        const char = chars[i];
        if (char === undefined) throw "COLLATION_POSITION";
        const d = digit(point(char));
        if (d < 0) break;
        if (d !== 0 || digits.length) digits.push(d);
        i++;
      }
      if (!digits.length) digits.push(0);
      result.push(
        { primary: collationNumericPrimary, secondary: 1280, tertiary: 1280 },
        { primary: 268435456 + digits.length, secondary: 0, tertiary: 0 },
      );
      for (const d of digits) {
        if (d === undefined) throw "COLLATION_DIGIT";
        result.push({ primary: 536870912 + d, secondary: 0, tertiary: 0 });
      }
      continue;
    }
    let found: readonly Element[] | undefined,
      end = i + 1,
      matched = current;
    const rules = root.prefixes.get(current);
    if (rules !== undefined) {
      for (const rule of rules) {
        if (rule === undefined) throw "COLLATION_PREFIX";
        const preceding = chars
          .slice(Math.max(0, i - rule.prefix.length), i)
          .join("");
        if (preceding.endsWith(rule.prefix)) {
          found = rule.elements;
          break;
        }
      }
    }
    if (found === undefined) {
      const width = Math.min(
        root.widths.get(point(current)) ?? 1,
        chars.length - i,
      );
      for (let n = width; n > 0; n--) {
        const key = chars.slice(i, i + n).join(""),
          match = row(root, key);
        if (match !== undefined) {
          found = match;
          matched = key;
          end = i + n;
          break;
        }
      }
    }
    if (root.extendable.has(matched)) {
      let blocked = 0;
      for (let j = end; j < chars.length;) {
        const char = chars[j];
        if (char === undefined) throw "COLLATION_POSITION";
        const ccc = canonicalCombiningClass(point(char));
        if (ccc === 0) break;
        const candidate = matched + char,
          match = row(root, candidate);
        if (ccc > blocked && match !== undefined) {
          found = match;
          matched = candidate;
          chars.splice(j, 1);
          if (!root.extendable.has(matched)) break;
        } else {
          blocked = ccc;
          j++;
        }
      }
    }
    if (found === undefined) result.push(implicit(point(current), root));
    else for (const ce of found) if (ce !== undefined) result.push(ce);
    i = end;
  }
  return result;
}
function key(text: string, options: CollationOptions): number[][] {
  const primary: number[] = [],
    secondary: number[] = [],
    tertiary: number[] = [],
    cases: number[] = [];
  const reorder = profileData(options.profile).reorder;
  let shifted = false;
  for (const ce of elements(text, options)) {
    if (ce === undefined) throw "COLLATION_ELEMENT";
    if (options.ignorePunctuation) {
      if (ce.primary !== 0) shifted = ce.primary <= 201326591;
      if (shifted) continue;
    }
    if (ce.primary) {
      let p = ce.primary;
      if (reorder === "others digit" && p >= 251658240 && p < 671088640)
        p += 3087007744;
      else if (reorder === "Thai" && p >= 1946157056 && p < 1962934272)
        p -= 1258291200;
      primary.push(p);
    }
    if (ce.secondary) secondary.push(ce.secondary);
    const bits = Math.floor(ce.tertiary / 16384),
      base = ce.tertiary % 16384;
    const caseWeight =
      options.caseFirst === "upper"
        ? bits === 2
          ? 1
          : bits === 1
            ? 2
            : 3
        : bits === 2
          ? 3
          : bits === 1
            ? 2
            : 1;
    if (ce.primary && ce.tertiary) cases.push(caseWeight);
    if (ce.tertiary) {
      const weight =
        options.caseFirst === "false"
          ? base
          : (ce.primary === 0 && ce.secondary === 0 ? 3 : caseWeight) * 16384 +
            base;
      if (weight) tertiary.push(weight);
    }
  }
  if (options.sensitivity === "base") return [primary];
  if (options.sensitivity === "case") return [primary, cases];
  if (options.sensitivity === "accent") return [primary, secondary];
  return [primary, secondary, tertiary];
}
export function compareCollation(
  left: string,
  right: string,
  options: CollationOptions,
): number {
  if (left === right) return 0;
  const a = key(left, options),
    b = key(right, options);
  for (let level = 0; level < a.length; level++) {
    const x = a[level],
      y = b[level];
    if (x === undefined || y === undefined) throw "COLLATION_LEVEL";
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const p = x[i],
        q = y[i];
      if (p === undefined || q === undefined) throw "COLLATION_WEIGHT";
      if (p !== q) return p < q ? -1 : 1;
    }
    if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  }
  return 0;
}

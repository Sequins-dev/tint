import { asciiEndOfText } from "../../text/latin1.ts";
import {
  decompositionPoints,
  decompositionInfo,
  decompositionValues,
  combiningPoints,
  combiningClasses,
  compositionKeys,
  compositionValues,
} from "./data.ts";
export const unicodeVersion = "17.0.0";
function word(text: string, index: number): number {
  const offset = index << 1;
  return text.charCodeAt(offset) | (text.charCodeAt(offset + 1) << 16);
}
function find(points: string, point: number): number {
  let low = 0,
    high = points.length >>> 1;
  while (low < high) {
    const mid = (low + high) >>> 1,
      value = word(points, mid);
    if (point < value) high = mid;
    else if (point > value) low = mid + 1;
    else return mid;
  }
  return -1;
}
function combining(point: number): number {
  if (point < 0x0300 || point > 0x1e94a) return 0;
  if (point <= 0x036f) {
    if (point < 0x034f) return combiningClasses.charCodeAt(point - 0x0300);
    if (point === 0x034f) return 0;
    return combiningClasses.charCodeAt(point - 0x0301);
  }
  const index = find(combiningPoints, point);
  return index < 0 ? 0 : combiningClasses.charCodeAt(index);
}
/** Unicode canonical combining class, including zero for unlisted code points. */
export function canonicalCombiningClass(point: number): number {
  return combining(point);
}
interface PointBuffer {
  data: Int32Array;
  length: number;
}
function pushPoint(buf: PointBuffer, point: number): void {
  const len = buf.length;
  let data = buf.data;
  if (len >= data.length) {
    const next = new Int32Array(data.length << 1);
    next.set(data);
    data = next;
    buf.data = next;
  }
  data[len] = point;
  buf.length = len + 1;
}
function decompose(
  point: number,
  compatibility: boolean,
  output: PointBuffer,
): void {
  if (
    point < (compatibility ? 0x00a0 : 0x00c0) ||
    (point >= 0x0300 && point < 0x0340) ||
    (point >= 0x1100 && point <= 0x11ff)
  ) {
    pushPoint(output, point);
    return;
  }
  const syllable = point - 0xac00;
  if (syllable >= 0 && syllable < 11172) {
    pushPoint(output, 0x1100 + ((syllable / 588) | 0));
    pushPoint(output, 0x1161 + (((syllable % 588) / 28) | 0));
    const tail = syllable % 28;
    if (tail !== 0) pushPoint(output, 0x11a7 + tail);
    return;
  }
  if (point > 0x2fa1d) {
    pushPoint(output, point);
    return;
  }
  const index = find(decompositionPoints, point);
  if (index < 0) {
    pushPoint(output, point);
    return;
  }
  const info = word(decompositionInfo, index);
  if ((info & 1) !== 0 && !compatibility) {
    pushPoint(output, point);
    return;
  }
  const start = info >>> 1,
    end = word(decompositionInfo, index + 1) >>> 1;
  for (let at = start; at < end; at++)
    decompose(word(decompositionValues, at), compatibility, output);
}
function hasDecomposition(point: number, compatibility: boolean): boolean {
  if (
    point < (compatibility ? 0x00a0 : 0x00c0) ||
    (point >= 0x0300 && point < 0x0340) ||
    (point >= 0x1100 && point <= 0x11ff)
  )
    return false;
  if (point >= 0xac00 && point < 0xd7a4) return true;
  if (point > 0x2fa1d) return false;
  const index = find(decompositionPoints, point);
  if (index < 0) return false;
  return compatibility || (word(decompositionInfo, index) & 1) === 0;
}
/** Short runs use bounded insertion; larger runs use stable counting over the
 * 256 canonical classes. Long unbounded sequences remain intact, without CGJs. */
function orderRun(points: Int32Array, start: number, end: number): void {
  const length = end - start;
  if (length < 16) {
    for (let at = start + 1; at < end; at++) {
      const point = points[at] ?? 0;
      const order = combining(point);
      let destination = at;
      while (destination > start) {
        const previous = points[destination - 1] ?? 0;
        if (combining(previous) <= order) break;
        points[destination] = previous;
        destination--;
      }
      points[destination] = point;
    }
    return;
  }
  const classes = new Uint8Array(length),
    counts = new Uint32Array(256);
  for (let at = 0; at < length; at++) {
    const point = points[start + at] ?? 0;
    const order = combining(point);
    classes[at] = order;
    counts[order] = (counts[order] ?? 0) + 1;
  }
  let offset = 0;
  for (let order = 0; order < 256; order++) {
    const count = counts[order] ?? 0;
    counts[order] = offset;
    offset += count;
  }
  const ordered = new Int32Array(length);
  for (let at = 0; at < length; at++) {
    const order = classes[at] ?? 0,
      destination = counts[order] ?? 0;
    ordered[destination] = points[start + at] ?? 0;
    counts[order] = destination + 1;
  }
  for (let at = 0; at < length; at++) points[start + at] = ordered[at] ?? 0;
}
function canonicalOrder(points: Int32Array, length: number): void {
  let start = 0,
    previous = 0,
    ordered = true;
  for (let at = 0; at < length; at++) {
    const point = points[at] ?? 0;
    const order = point < 0x0300 ? 0 : combining(point);
    if (order === 0) {
      if (!ordered) orderRun(points, start, at);
      start = at + 1;
      previous = 0;
      ordered = true;
    } else {
      if (order < previous) ordered = false;
      previous = order;
    }
  }
  if (!ordered) orderRun(points, start, length);
}
function composite(left: number, right: number): number | undefined {
  if (right < 0x0300 || right > 0x16d67) return undefined;
  if (right >= 0x1161 && right < 0x1176 && left >= 0x1100 && left < 0x1113)
    return 0xac00 + ((left - 0x1100) * 21 + right - 0x1161) * 28;
  if (right > 0x11a7 && right < 0x11c3) {
    const syllable = left - 0xac00;
    if (syllable >= 0 && syllable < 11172 && syllable % 28 === 0)
      return left + right - 0x11a7;
  }
  if (left < 0x003c || left > 0x16d69) return undefined;
  const requested = left * 0x110000 + right;
  let low = 0,
    high = (compositionKeys.length / 3) | 0;
  while (low < high) {
    const mid = (low + high) >>> 1,
      at = mid * 3;
    const key =
      compositionKeys.charCodeAt(at) +
      compositionKeys.charCodeAt(at + 1) * 65536 +
      compositionKeys.charCodeAt(at + 2) * 4294967296;
    if (requested < key) high = mid;
    else if (requested > key) low = mid + 1;
    else return word(compositionValues, mid);
  }
  return undefined;
}
function composeInPlace(points: Int32Array, length: number): number {
  let write = 0,
    starter = 0,
    starterIndex = -1,
    lastClass = 0;
  for (let at = 0; at < length; at++) {
    const point = points[at] ?? 0;
    if (point < 0x0300) {
      starterIndex = write;
      starter = point;
      points[write++] = point;
      lastClass = 0;
      continue;
    }
    const order = combining(point);
    const joined =
      starterIndex >= 0 && (lastClass === 0 || lastClass < order)
        ? composite(starter, point)
        : undefined;
    if (joined !== undefined) {
      points[starterIndex] = joined;
      starter = joined;
    } else {
      if (order === 0) {
        starterIndex = write;
        starter = point;
      }
      points[write++] = point;
      lastClass = order;
    }
  }
  return write;
}
function stringFromPoints(
  prefix: string,
  points: Int32Array,
  count: number,
): string {
  let out = prefix;
  let at = 0;
  while (at < count) {
    const p0 = points[at] ?? 0;
    if (p0 > 0xffff) {
      const adjusted = p0 - 0x10000;
      out += String.fromCharCode(
        0xd800 + (adjusted >> 10),
        0xdc00 + (adjusted & 0x3ff),
      );
      at++;
      continue;
    }
    if (at + 16 <= count) {
      const p1 = points[at + 1] ?? 0,
        p2 = points[at + 2] ?? 0,
        p3 = points[at + 3] ?? 0,
        p4 = points[at + 4] ?? 0,
        p5 = points[at + 5] ?? 0,
        p6 = points[at + 6] ?? 0,
        p7 = points[at + 7] ?? 0,
        p8 = points[at + 8] ?? 0,
        p9 = points[at + 9] ?? 0,
        p10 = points[at + 10] ?? 0,
        p11 = points[at + 11] ?? 0,
        p12 = points[at + 12] ?? 0,
        p13 = points[at + 13] ?? 0,
        p14 = points[at + 14] ?? 0,
        p15 = points[at + 15] ?? 0;
      if (
        (p1 |
          p2 |
          p3 |
          p4 |
          p5 |
          p6 |
          p7 |
          p8 |
          p9 |
          p10 |
          p11 |
          p12 |
          p13 |
          p14 |
          p15) <=
        0xffff
      ) {
        out += String.fromCharCode(
          p0,
          p1,
          p2,
          p3,
          p4,
          p5,
          p6,
          p7,
          p8,
          p9,
          p10,
          p11,
          p12,
          p13,
          p14,
          p15,
        );
        at += 16;
        continue;
      }
    }
    if (at + 8 <= count) {
      const p1 = points[at + 1] ?? 0,
        p2 = points[at + 2] ?? 0,
        p3 = points[at + 3] ?? 0,
        p4 = points[at + 4] ?? 0,
        p5 = points[at + 5] ?? 0,
        p6 = points[at + 6] ?? 0,
        p7 = points[at + 7] ?? 0;
      if ((p1 | p2 | p3 | p4 | p5 | p6 | p7) <= 0xffff) {
        out += String.fromCharCode(p0, p1, p2, p3, p4, p5, p6, p7);
        at += 8;
        continue;
      }
    }
    if (at + 4 <= count) {
      const p1 = points[at + 1] ?? 0,
        p2 = points[at + 2] ?? 0,
        p3 = points[at + 3] ?? 0;
      if ((p1 | p2 | p3) <= 0xffff) {
        out += String.fromCharCode(p0, p1, p2, p3);
        at += 4;
        continue;
      }
    }
    out += String.fromCharCode(p0);
    at++;
  }
  return out;
}
/** Unicode17 NFC/NFD/NFKC/NFKD. Invalid form is a caller-level policy decision. */
export function normalizeUnicode(
  text: string,
  form: string = "NFC",
): string | undefined {
  if (form !== "NFC" && form !== "NFD" && form !== "NFKC" && form !== "NFKD")
    return undefined;
  const length = text.length;
  // Every ASCII string is already normalized in all four Unicode forms.
  const firstNonAscii = asciiEndOfText(text, 0, length);
  if (firstNonAscii === length) return text;
  const compatibility = form === "NFKC" || form === "NFKD",
    composed = form === "NFC" || form === "NFKC";
  const minDecomp = compatibility ? 0x00a0 : 0x00c0;
  // Zero-allocation quick-check:
  // - NFC: every code unit < 0x0300 is already normalized (no combining marks,
  //   no composition right-hand side, and no canonical decomposition that differs).
  // - NFKC: every code unit < 0x00a0 is already normalized.
  // - NFD/NFKD: already normalized iff no code point decomposes and ccc is non-decreasing.
  if (composed) {
    const quickLimit = compatibility ? 0x00a0 : 0x0300;
    let quickDone = true;
    for (let i = firstNonAscii; i < length; i++) {
      if (text.charCodeAt(i) >= quickLimit) {
        quickDone = false;
        break;
      }
    }
    if (quickDone) return text;
  } else {
    let quickDone = true;
    let prevCcc = 0;
    for (let offset = firstNonAscii; offset < length;) {
      let point = text.charCodeAt(offset++);
      if (point < minDecomp) {
        prevCcc = 0;
        continue;
      }
      if (point >= 0xd800 && point <= 0xdbff && offset < length) {
        const low = text.charCodeAt(offset);
        if (low >= 0xdc00 && low <= 0xdfff) {
          offset++;
          point = ((point - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
        }
      }
      if (hasDecomposition(point, compatibility)) {
        quickDone = false;
        break;
      }
      const ccc = combining(point);
      if (ccc !== 0 && ccc < prevCcc) {
        quickDone = false;
        break;
      }
      prevCcc = ccc;
    }
    if (quickDone) return text;
  }
  // Any ASCII prefix before the last ASCII starter prior to firstNonAscii cannot
  // decompose, reorder, or compose with anything at or after firstNonAscii.
  const prefixEnd = firstNonAscii > 0 ? firstNonAscii - 1 : 0;
  const tailLength = length - prefixEnd;
  const buf: PointBuffer = {
    data: new Int32Array(tailLength + (tailLength >>> 1) + 16),
    length: 0,
  };
  for (let offset = prefixEnd; offset < length;) {
    let point = text.charCodeAt(offset++);
    if (
      point < minDecomp ||
      (point >= 0x0300 && point < 0x0340) ||
      (point >= 0x1100 && point <= 0x11ff)
    ) {
      pushPoint(buf, point);
      continue;
    }
    if (point >= 0xd800 && point <= 0xdbff && offset < length) {
      const low = text.charCodeAt(offset);
      if (low >= 0xdc00 && low <= 0xdfff) {
        offset++;
        point = ((point - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
      }
    }
    decompose(point, compatibility, buf);
  }
  canonicalOrder(buf.data, buf.length);
  const count = composed ? composeInPlace(buf.data, buf.length) : buf.length;
  return stringFromPoints(
    prefixEnd > 0 ? text.slice(0, prefixEnd) : "",
    buf.data,
    count,
  );
}

/** String.prototype.normalize(form?): throws RangeError on invalid form. */
export function normalizeString(text: string, form?: string): string {
  const actual = form === undefined ? "NFC" : form;
  const result = normalizeUnicode(text, actual);
  if (result === undefined)
    throw new RangeError(
      "The normalization form should be one of NFC, NFD, NFKC, NFKD.",
    );
  return result;
}

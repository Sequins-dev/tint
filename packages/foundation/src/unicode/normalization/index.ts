import { asciiEndOfText, latin1Text } from "../../text/latin1.ts";
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

// Pure O(1) lookup strings derived directly from Unicode 17.0.0 data.ts:
// - Latin-1 canonical decompositions for 0x00c0..0x00ff (64 entries)
// - ASCII letter (A-Z, a-z) + combining mark (0x0300..0x030c) compositions (52 * 13 = 676 entries)
const latin1DecompBase =
  "AAAAAA\u0000CEEEEIIII\u0000NOOOOO\u0000\u0000UUUUY\u0000\u0000aaaaaa\u0000ceeeeiiii\u0000nooooo\u0000\u0000uuuuy\u0000y";
const latin1DecompMark =
  "\u0300\u0301\u0302\u0303\u0308\u030a\u0000\u0327\u0300\u0301\u0302\u0308\u0300\u0301\u0302\u0308\u0000\u0303\u0300\u0301\u0302\u0303\u0308\u0000\u0000\u0300\u0301\u0302\u0308\u0301\u0000\u0000\u0300\u0301\u0302\u0303\u0308\u030a\u0000\u0327\u0300\u0301\u0302\u0308\u0300\u0301\u0302\u0308\u0000\u0303\u0300\u0301\u0302\u0303\u0308\u0000\u0000\u0300\u0301\u0302\u0308\u0301\u0000\u0308";
const asciiCompMarks = 13;
const asciiCompTable =
  "\u00c0\u00c1\u00c2\u00c3\u0100\u0000\u0102\u0226\u00c4\u1ea2\u00c5\u0000\u01cd\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u1e02\u0000\u0000\u0000\u0000\u0000\u0000\u0106\u0108\u0000\u0000\u0000\u0000\u010a\u0000\u0000\u0000\u0000\u010c\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u1e0a\u0000\u0000\u0000\u0000\u010e\u00c8\u00c9\u00ca\u1ebc\u0112\u0000\u0114\u0116\u00cb\u1eba\u0000\u0000\u011a\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u1e1e\u0000\u0000\u0000\u0000\u0000\u0000\u01f4\u011c\u0000\u1e20\u0000\u011e\u0120\u0000\u0000\u0000\u0000\u01e6\u0000\u0000\u0124\u0000\u0000\u0000\u0000\u1e22\u1e26\u0000\u0000\u0000\u021e\u00cc\u00cd\u00ce\u0128\u012a\u0000\u012c\u0130\u00cf\u1ec8\u0000\u0000\u01cf\u0000\u0000\u0134\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u1e30\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u01e8\u0000\u0139\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u013d\u0000\u1e3e\u0000\u0000\u0000\u0000\u0000\u1e40\u0000\u0000\u0000\u0000\u0000\u01f8\u0143\u0000\u00d1\u0000\u0000\u0000\u1e44\u0000\u0000\u0000\u0000\u0147\u00d2\u00d3\u00d4\u00d5\u014c\u0000\u014e\u022e\u00d6\u1ece\u0000\u0150\u01d1\u0000\u1e54\u0000\u0000\u0000\u0000\u0000\u1e56\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0154\u0000\u0000\u0000\u0000\u0000\u1e58\u0000\u0000\u0000\u0000\u0158\u0000\u015a\u015c\u0000\u0000\u0000\u0000\u1e60\u0000\u0000\u0000\u0000\u0160\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u1e6a\u0000\u0000\u0000\u0000\u0164\u00d9\u00da\u00db\u0168\u016a\u0000\u016c\u0000\u00dc\u1ee6\u016e\u0170\u01d3\u0000\u0000\u0000\u1e7c\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u1e80\u1e82\u0174\u0000\u0000\u0000\u0000\u1e86\u1e84\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u1e8a\u1e8c\u0000\u0000\u0000\u0000\u1ef2\u00dd\u0176\u1ef8\u0232\u0000\u0000\u1e8e\u0178\u1ef6\u0000\u0000\u0000\u0000\u0179\u1e90\u0000\u0000\u0000\u0000\u017b\u0000\u0000\u0000\u0000\u017d\u00e0\u00e1\u00e2\u00e3\u0101\u0000\u0103\u0227\u00e4\u1ea3\u00e5\u0000\u01ce\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u1e03\u0000\u0000\u0000\u0000\u0000\u0000\u0107\u0109\u0000\u0000\u0000\u0000\u010b\u0000\u0000\u0000\u0000\u010d\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u1e0b\u0000\u0000\u0000\u0000\u010f\u00e8\u00e9\u00ea\u1ebd\u0113\u0000\u0115\u0117\u00eb\u1ebb\u0000\u0000\u011b\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u1e1f\u0000\u0000\u0000\u0000\u0000\u0000\u01f5\u011d\u0000\u1e21\u0000\u011f\u0121\u0000\u0000\u0000\u0000\u01e7\u0000\u0000\u0125\u0000\u0000\u0000\u0000\u1e23\u1e27\u0000\u0000\u0000\u021f\u00ec\u00ed\u00ee\u0129\u012b\u0000\u012d\u0000\u00ef\u1ec9\u0000\u0000\u01d0\u0000\u0000\u0135\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u01f0\u0000\u1e31\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u01e9\u0000\u013a\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u013e\u0000\u1e3f\u0000\u0000\u0000\u0000\u0000\u1e41\u0000\u0000\u0000\u0000\u0000\u01f9\u0144\u0000\u00f1\u0000\u0000\u0000\u1e45\u0000\u0000\u0000\u0000\u0148\u00f2\u00f3\u00f4\u00f5\u014d\u0000\u014f\u022f\u00f6\u1ecf\u0000\u0151\u01d2\u0000\u1e55\u0000\u0000\u0000\u0000\u0000\u1e57\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0155\u0000\u0000\u0000\u0000\u0000\u1e59\u0000\u0000\u0000\u0000\u0159\u0000\u015b\u015d\u0000\u0000\u0000\u0000\u1e61\u0000\u0000\u0000\u0000\u0161\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u1e6b\u1e97\u0000\u0000\u0000\u0165\u00f9\u00fa\u00fb\u0169\u016b\u0000\u016d\u0000\u00fc\u1ee7\u016f\u0171\u01d4\u0000\u0000\u0000\u1e7d\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u1e81\u1e83\u0175\u0000\u0000\u0000\u0000\u1e87\u1e85\u0000\u1e98\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u1e8b\u1e8d\u0000\u0000\u0000\u0000\u1ef3\u00fd\u0177\u1ef9\u0233\u0000\u0000\u1e8f\u00ff\u1ef7\u1e99\u0000\u0000\u0000\u017a\u1e91\u0000\u0000\u0000\u0000\u017c\u0000\u0000\u0000\u0000\u017e";

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
  data: Uint32Array;
  length: number;
}
function pushPoint(buf: PointBuffer, point: number): void {
  const len = buf.length;
  let data = buf.data;
  if (len >= data.length) {
    const next = new Uint32Array(data.length << 1);
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
  if (point >= 0x00c0 && point <= 0x00ff) {
    const base = latin1DecompBase.charCodeAt(point - 0x00c0);
    if (base !== 0) {
      pushPoint(output, base);
      pushPoint(output, latin1DecompMark.charCodeAt(point - 0x00c0));
      return;
    }
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
  if (point >= 0x00c0 && point <= 0x00ff)
    return latin1DecompBase.charCodeAt(point - 0x00c0) !== 0;
  if (point >= 0xac00 && point < 0xd7a4) return true;
  if (point > 0x2fa1d) return false;
  const index = find(decompositionPoints, point);
  if (index < 0) return false;
  return compatibility || (word(decompositionInfo, index) & 1) === 0;
}
/** Short runs use bounded insertion; larger runs use stable counting over the
 * 256 canonical classes. Long unbounded sequences remain intact, without CGJs. */
function orderRun(points: Uint32Array, start: number, end: number): void {
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
  const ordered = new Uint32Array(length);
  for (let at = 0; at < length; at++) {
    const order = classes[at] ?? 0,
      destination = counts[order] ?? 0;
    ordered[destination] = points[start + at] ?? 0;
    counts[order] = destination + 1;
  }
  for (let at = 0; at < length; at++) points[start + at] = ordered[at] ?? 0;
}
function canonicalOrder(
  points: Uint32Array,
  from: number,
  length: number,
): void {
  let start = from,
    previous = 0,
    ordered = true;
  for (let at = from; at < length; at++) {
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
  if (right < 0x0300 + asciiCompMarks) {
    let li = -1;
    if (left >= 65 && left <= 90) li = left - 65;
    else if (left >= 97 && left <= 122) li = 26 + (left - 97);
    if (li >= 0) {
      const mapped = asciiCompTable.charCodeAt(
        li * asciiCompMarks + (right - 0x0300),
      );
      return mapped === 0 ? undefined : mapped;
    }
  }
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
function composeInPlace(
  points: Uint32Array,
  from: number,
  length: number,
): number {
  let write = from,
    starter = 0,
    starterIndex = -1,
    lastClass = 0;
  for (let at = from; at < length; at++) {
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
function chunkFromPoints(points: Uint32Array, at: number, len: number): string {
  if (len === 1) return String.fromCharCode(points[at] ?? 0);
  if (len === 2)
    return String.fromCharCode(points[at] ?? 0, points[at + 1] ?? 0);
  if (len === 3)
    return String.fromCharCode(
      points[at] ?? 0,
      points[at + 1] ?? 0,
      points[at + 2] ?? 0,
    );
  if (len === 4)
    return String.fromCharCode(
      points[at] ?? 0,
      points[at + 1] ?? 0,
      points[at + 2] ?? 0,
      points[at + 3] ?? 0,
    );
  if (len === 5)
    return String.fromCharCode(
      points[at] ?? 0,
      points[at + 1] ?? 0,
      points[at + 2] ?? 0,
      points[at + 3] ?? 0,
      points[at + 4] ?? 0,
    );
  if (len === 6)
    return String.fromCharCode(
      points[at] ?? 0,
      points[at + 1] ?? 0,
      points[at + 2] ?? 0,
      points[at + 3] ?? 0,
      points[at + 4] ?? 0,
      points[at + 5] ?? 0,
    );
  if (len === 7)
    return String.fromCharCode(
      points[at] ?? 0,
      points[at + 1] ?? 0,
      points[at + 2] ?? 0,
      points[at + 3] ?? 0,
      points[at + 4] ?? 0,
      points[at + 5] ?? 0,
      points[at + 6] ?? 0,
    );
  return String.fromCharCode(
    points[at] ?? 0,
    points[at + 1] ?? 0,
    points[at + 2] ?? 0,
    points[at + 3] ?? 0,
    points[at + 4] ?? 0,
    points[at + 5] ?? 0,
    points[at + 6] ?? 0,
    points[at + 7] ?? 0,
  );
}
function stringFromPoints(
  text: string,
  prefixEnd: number,
  points: Uint32Array,
  count: number,
): string {
  // Single-allocation Latin-1 fast path when every output code point fits in
  // 0x00..0xFF (e.g. NFKC/NFKD of ASCII/Latin-1 compatibility forms).
  let maxPoint = 0;
  for (let i = 0; i < count; i++) {
    const p = points[i] ?? 0;
    if (p > maxPoint) maxPoint = p;
  }
  if (maxPoint <= 0xff) {
    const total = prefixEnd + count;
    const bytes = new Uint8Array(total);
    let allPrefixLatin1 = true;
    for (let i = 0; i < prefixEnd; i++) {
      const unit = text.charCodeAt(i);
      if (unit > 0xff) {
        allPrefixLatin1 = false;
        break;
      }
      bytes[i] = unit;
    }
    if (allPrefixLatin1) {
      for (let i = 0; i < count; i++) bytes[prefixEnd + i] = points[i] ?? 0;
      return latin1Text(bytes, 0, total);
    }
  }
  const prefix = prefixEnd > 0 ? text.slice(0, prefixEnd) : "";
  if (maxPoint <= 0xffff && count <= 32) {
    let at = 0;
    let tail = "";
    while (at + 16 <= count) {
      const chunk = String.fromCharCode(
        points[at] ?? 0,
        points[at + 1] ?? 0,
        points[at + 2] ?? 0,
        points[at + 3] ?? 0,
        points[at + 4] ?? 0,
        points[at + 5] ?? 0,
        points[at + 6] ?? 0,
        points[at + 7] ?? 0,
        points[at + 8] ?? 0,
        points[at + 9] ?? 0,
        points[at + 10] ?? 0,
        points[at + 11] ?? 0,
        points[at + 12] ?? 0,
        points[at + 13] ?? 0,
        points[at + 14] ?? 0,
        points[at + 15] ?? 0,
      );
      tail = tail.length === 0 ? chunk : tail + chunk;
      at += 16;
    }
    if (at + 8 <= count) {
      const chunk = chunkFromPoints(points, at, 8);
      tail = tail.length === 0 ? chunk : tail + chunk;
      at += 8;
    }
    if (at < count) {
      const chunk = chunkFromPoints(points, at, count - at);
      tail = tail.length === 0 ? chunk : tail + chunk;
    }
    return prefix.length === 0 ? tail : prefix + tail;
  }
  const pieces: string[] = [];
  if (prefix.length > 0) pieces.push(prefix);
  let at = 0;
  while (at < count) {
    const p0 = points[at] ?? 0;
    if (p0 > 0xffff) {
      const adjusted = p0 - 0x10000;
      pieces.push(
        String.fromCharCode(
          0xd800 + (adjusted >> 10),
          0xdc00 + (adjusted & 0x3ff),
        ),
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
        pieces.push(
          String.fromCharCode(
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
          ),
        );
        at += 16;
        continue;
      }
    }
    let run = 1;
    while (run < 8 && at + run < count && (points[at + run] ?? 0) <= 0xffff)
      run++;
    pieces.push(chunkFromPoints(points, at, run));
    at += run;
  }
  return pieces.join("");
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
  let prefixEnd = firstNonAscii > 0 ? firstNonAscii - 1 : 0;
  if (composed) {
    const quickLimit = compatibility ? 0x00a0 : 0x0300;
    let quickDone = true;
    let failAt = length;
    for (let i = firstNonAscii; i < length; i++) {
      if (text.charCodeAt(i) >= quickLimit) {
        quickDone = false;
        failAt = i;
        break;
      }
    }
    if (quickDone) return text;
    if (failAt > 0 && failAt - 1 > prefixEnd) prefixEnd = failAt - 1;
  } else {
    let quickDone = true;
    let prevCcc = 0;
    let lastStarter = firstNonAscii;
    for (let offset = firstNonAscii; offset < length;) {
      const startOffset = offset;
      let point = text.charCodeAt(offset++);
      if (point < minDecomp) {
        prevCcc = 0;
        lastStarter = offset;
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
        prefixEnd = prevCcc === 0 ? startOffset : lastStarter;
        break;
      }
      const ccc = combining(point);
      if (ccc === 0) {
        lastStarter = startOffset;
      } else if (ccc < prevCcc) {
        quickDone = false;
        prefixEnd = lastStarter;
        break;
      }
      prevCcc = ccc;
    }
    if (quickDone) return text;
  }
  const tailLength = length - prefixEnd;
  const embedPrefix = prefixEnd > 0 && prefixEnd <= 16 && tailLength <= 32;
  const start = embedPrefix ? prefixEnd : 0;
  const data = new Uint32Array(start + tailLength + (tailLength >>> 1) + 8);
  if (embedPrefix) {
    for (let i = 0; i < prefixEnd; i++) data[i] = text.charCodeAt(i);
  }
  const buf: PointBuffer = {
    data,
    length: start,
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
  canonicalOrder(buf.data, start, buf.length);
  const count = composed
    ? composeInPlace(buf.data, start, buf.length)
    : buf.length;
  return stringFromPoints(text, embedPrefix ? 0 : prefixEnd, buf.data, count);
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

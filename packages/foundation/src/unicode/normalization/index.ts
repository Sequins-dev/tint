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
  const lo = text.charCodeAt(index * 2),
    hi = text.charCodeAt(index * 2 + 1);
  if (lo !== lo || hi !== hi) throw "NORMALIZATION_TABLE_BOUNDS";
  return lo + hi * 65536;
}
function find(points: string, point: number): number {
  let low = 0,
    high = points.length / 2;
  while (low < high) {
    const mid = Math.floor((low + high) / 2),
      value = word(points, mid);
    if (point < value) high = mid;
    else if (point > value) low = mid + 1;
    else return mid;
  }
  return -1;
}
function combining(point: number): number {
  const index = find(combiningPoints, point);
  return index < 0 ? 0 : combiningClasses.charCodeAt(index);
}
/** Unicode canonical combining class, including zero for unlisted code points. */
export function canonicalCombiningClass(point: number): number {
  return combining(point);
}
function decompose(
  point: number,
  compatibility: boolean,
  output: number[],
): void {
  const syllable = point - 0xac00;
  if (syllable >= 0 && syllable < 11172) {
    output.push(0x1100 + Math.floor(syllable / 588));
    output.push(0x1161 + Math.floor((syllable % 588) / 28));
    const tail = syllable % 28;
    if (tail !== 0) output.push(0x11a7 + tail);
    return;
  }
  const index = find(decompositionPoints, point);
  if (index < 0) {
    output.push(point);
    return;
  }
  const info = word(decompositionInfo, index);
  if (info % 2 !== 0 && !compatibility) {
    output.push(point);
    return;
  }
  const start = Math.floor(info / 2),
    end = Math.floor(word(decompositionInfo, index + 1) / 2);
  for (let at = start; at < end; at++)
    decompose(word(decompositionValues, at), compatibility, output);
}
/** Short runs use bounded insertion; larger runs use stable counting over the
 * 256 canonical classes. Long unbounded sequences remain intact, without CGJs. */
function orderRun(points: number[], start: number, end: number): void {
  const length = end - start;
  if (length < 16) {
    for (let at = start + 1; at < end; at++) {
      const point = points[at];
      if (point === undefined) throw "NORMALIZATION_ORDER_INVARIANT";
      const order = combining(point);
      let destination = at;
      while (destination > start) {
        const previous = points[destination - 1];
        if (previous === undefined) throw "NORMALIZATION_ORDER_INVARIANT";
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
    const point = points[start + at];
    if (point === undefined) throw "NORMALIZATION_ORDER_INVARIANT";
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
  const ordered = new Float64Array(length);
  for (let at = 0; at < length; at++) {
    const order = classes[at] ?? 0,
      destination = counts[order] ?? 0;
    const point = points[start + at];
    if (point === undefined) throw "NORMALIZATION_ORDER_INVARIANT";
    ordered[destination] = point;
    counts[order] = destination + 1;
  }
  for (let at = 0; at < length; at++) {
    const point = ordered[at];
    if (point === undefined) throw "NORMALIZATION_ORDER_INVARIANT";
    points[start + at] = point;
  }
}
function canonicalOrder(points: number[]): void {
  let start = 0,
    previous = 0,
    ordered = true;
  for (let at = 0; at < points.length; at++) {
    const point = points[at];
    if (point === undefined) throw "NORMALIZATION_ORDER_INVARIANT";
    const order = combining(point);
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
  if (!ordered) orderRun(points, start, points.length);
}
function composite(left: number, right: number): number | undefined {
  if (left >= 0x1100 && left < 0x1113 && right >= 0x1161 && right < 0x1176)
    return 0xac00 + ((left - 0x1100) * 21 + right - 0x1161) * 28;
  const syllable = left - 0xac00;
  if (
    syllable >= 0 &&
    syllable < 11172 &&
    syllable % 28 === 0 &&
    right > 0x11a7 &&
    right < 0x11c3
  )
    return left + right - 0x11a7;
  const requested = left * 0x110000 + right;
  let low = 0,
    high = compositionKeys.length / 3;
  while (low < high) {
    const mid = Math.floor((low + high) / 2),
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
function compose(input: readonly number[]): number[] {
  const output: number[] = [];
  let starter = 0,
    starterIndex = -1,
    lastClass = 0;
  for (let at = 0; at < input.length; at++) {
    const point = input[at];
    if (point === undefined) throw "NORMALIZATION_COMPOSE_INVARIANT";
    const order = combining(point);
    const joined =
      starterIndex >= 0 && (lastClass === 0 || lastClass < order)
        ? composite(starter, point)
        : undefined;
    if (joined !== undefined) {
      output[starterIndex] = joined;
      starter = joined;
    } else {
      if (order === 0) {
        starterIndex = output.length;
        starter = point;
      }
      output.push(point);
      lastClass = order;
    }
  }
  return output;
}
/** Unicode17 NFC/NFD/NFKC/NFKD. Invalid form is a caller-level policy decision. */
export function normalizeUnicode(
  text: string,
  form: string = "NFC",
): string | undefined {
  if (form !== "NFC" && form !== "NFD" && form !== "NFKC" && form !== "NFKD")
    return undefined;
  const compatibility = form === "NFKC" || form === "NFKD",
    composed = form === "NFC" || form === "NFKC";
  const decomposed: number[] = [];
  for (let offset = 0; offset < text.length;) {
    const point = text.codePointAt(offset);
    if (point === undefined) throw "NORMALIZATION_INPUT_INVARIANT";
    decompose(point, compatibility, decomposed);
    offset += point > 65535 ? 2 : 1;
  }
  canonicalOrder(decomposed);
  const points = composed ? compose(decomposed) : decomposed;
  const pieces: string[] = [];
  for (let at = 0; at < points.length; at++) {
    const point = points[at];
    if (point === undefined) throw "NORMALIZATION_OUTPUT_INVARIANT";
    pieces.push(String.fromCodePoint(point));
  }
  return pieces.join("");
}

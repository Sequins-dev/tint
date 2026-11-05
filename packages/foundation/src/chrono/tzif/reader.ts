import { readUnsigned, readSigned, readWord64 } from "../../binary/bytes.ts";
import type { Word64 } from "../../binary/word64.ts";

/** Wire timestamps retain all signed 64 bits in two's-complement form. */
export interface TzifTransition {
  readonly at: Word64;
  readonly type: number;
}
export interface TzifLocalType {
  readonly offsetSeconds: number;
  readonly daylightSaving: boolean;
  /** Designations have no mandated character encoding; retain their bytes. */
  readonly designation: readonly number[];
  readonly standard: boolean;
  readonly universal: boolean;
}
export interface TzifData {
  readonly version: number;
  readonly transitions: readonly TzifTransition[];
  readonly types: readonly TzifLocalType[];
  /** Undefined for v1, possibly empty for v2+. Interpretation is a separate stage. */
  readonly footer: string | undefined;
}
export type TzifResult =
  | { readonly ok: true; readonly value: TzifData }
  | {
      readonly ok: false;
      readonly error: "INVALID_TZIF" | "LEAP_SECONDS_UNSUPPORTED";
    };
interface Header {
  readonly version: number;
  readonly universal: number;
  readonly standard: number;
  readonly leaps: number;
  readonly times: number;
  readonly types: number;
  readonly characters: number;
}
function header(bytes: Uint8Array, offset: number): Header | undefined {
  if (
    offset < 0 ||
    bytes.length - offset < 44 ||
    bytes[offset] !== 84 ||
    bytes[offset + 1] !== 90 ||
    bytes[offset + 2] !== 105 ||
    bytes[offset + 3] !== 102
  )
    return undefined;
  const encoded = bytes[offset + 4];
  const version =
    encoded === 0
      ? 1
      : encoded === 50
        ? 2
        : encoded === 51
          ? 3
          : encoded === 52
            ? 4
            : 0;
  if (version === 0) return undefined;
  const counts: number[] = [];
  for (let index = 0; index < 6; index++) {
    const read = readUnsigned(bytes, offset + 20 + index * 4, 4, "big");
    if (!read.ok) return undefined;
    counts.push(read.value);
  }
  const universal = counts[0],
    standard = counts[1],
    leaps = counts[2],
    times = counts[3],
    types = counts[4],
    characters = counts[5];
  if (
    universal === undefined ||
    standard === undefined ||
    leaps === undefined ||
    times === undefined ||
    types === undefined ||
    characters === undefined ||
    types === 0 ||
    characters === 0 ||
    (universal !== 0 && universal !== types) ||
    (standard !== 0 && standard !== types)
  )
    return undefined;
  return { version, universal, standard, leaps, times, types, characters };
}
function blockSize(head: Header, width: number): number {
  return (
    head.times * (width + 1) +
    head.types * 6 +
    head.characters +
    head.leaps * (width + 4) +
    head.standard +
    head.universal
  );
}
function signedHigh(word: Word64): number {
  return word.hi >= 2147483648 ? word.hi - 4294967296 : word.hi;
}
function before(one: Word64, two: Word64): boolean {
  const high = signedHigh(one),
    other = signedHigh(two);
  return high < other || (high === other && one.lo < two.lo);
}
/** Decode RFC 9636 TZif v1-v4. No filesystem, clock, zone selection or Date policy.
 * POSIX timestamps are required: leap-aware tables cannot be silently treated as Unix time. */
export function readTzif(bytes: Uint8Array): TzifResult {
  function invalid(): TzifResult {
    return { ok: false, error: "INVALID_TZIF" };
  }
  const initial = header(bytes, 0);
  if (initial === undefined) return invalid();
  let head = initial,
    offset = 44,
    width = 4;
  const firstSize = blockSize(initial, 4);
  if (firstSize > bytes.length - offset) return invalid();
  if (initial.version !== 1) {
    offset += firstSize;
    const second = header(bytes, offset);
    if (second === undefined || second.version !== initial.version)
      return invalid();
    head = second;
    offset += 44;
    width = 8;
  }
  const size = blockSize(head, width),
    end = offset + size;
  if (size > bytes.length - offset) return invalid();
  if (head.leaps !== 0) return { ok: false, error: "LEAP_SECONDS_UNSUPPORTED" };
  const typeIndexStart = offset + head.times * width,
    records = typeIndexStart + head.times,
    names = records + head.types * 6;
  const transitions: TzifTransition[] = [];
  for (let index = 0; index < head.times; index++) {
    let at: Word64;
    if (width === 8) {
      const read = readWord64(bytes, offset + index * 8, "big");
      if (!read.ok) return invalid();
      at = read.value;
    } else {
      const read = readUnsigned(bytes, offset + index * 4, 4, "big");
      if (!read.ok) return invalid();
      at = { lo: read.value, hi: read.value >= 2147483648 ? 4294967295 : 0 };
    }
    const type = bytes[typeIndexStart + index],
      previous = transitions[index - 1];
    if (
      type === undefined ||
      type >= head.types ||
      (previous !== undefined && !before(previous.at, at))
    )
      return invalid();
    transitions.push({ at, type });
  }
  const types: TzifLocalType[] = [];
  for (let index = 0; index < head.types; index++) {
    const position = records + index * 6,
      read = readSigned(bytes, position, 4, "big"),
      dst = bytes[position + 4],
      designation = bytes[position + 5];
    if (
      !read.ok ||
      read.value === -2147483648 ||
      dst === undefined ||
      dst > 1 ||
      designation === undefined ||
      designation >= head.characters
    )
      return invalid();
    const name: number[] = [];
    let cursor = designation;
    while (cursor < head.characters && bytes[names + cursor] !== 0) {
      const byte = bytes[names + cursor];
      if (byte === undefined) return invalid();
      name.push(byte);
      cursor++;
    }
    if (cursor === head.characters) return invalid();
    const standard =
      head.standard === 0 ? 0 : bytes[names + head.characters + index];
    const universal =
      head.universal === 0
        ? 0
        : bytes[names + head.characters + head.standard + index];
    if (
      standard === undefined ||
      standard > 1 ||
      universal === undefined ||
      universal > 1 ||
      (universal === 1 && standard !== 1)
    )
      return invalid();
    types.push({
      offsetSeconds: read.value,
      daylightSaving: dst === 1,
      designation: name,
      standard: standard === 1,
      universal: universal === 1,
    });
  }
  let footer: string | undefined = undefined;
  if (head.version === 1) {
    if (end !== bytes.length) return invalid();
  } else {
    if (
      bytes[end] !== 10 ||
      bytes[bytes.length - 1] !== 10 ||
      bytes.length < end + 2
    )
      return invalid();
    for (let index = end + 1; index < bytes.length - 1; index++) {
      const byte = bytes[index];
      if (byte === undefined || byte < 32 || byte > 126) return invalid();
    }
    footer = new TextDecoder().decode(
      bytes.subarray(end + 1, bytes.length - 1),
    );
  }
  return {
    ok: true,
    value: { version: head.version, transitions, types, footer },
  };
}

// String benchmark kernels (docs/design-one-byte-strings.md). Plain typed
// TypeScript in erasable syntax: Node 26.13.1 runs the stripped text and Tint
// compiles the same text with the general fallback disabled, so every
// measurement is of typed code. Each kernel takes a scale and returns a
// deterministic 32-bit checksum. The file is self-contained apart from its
// codec import: Node runs ./codec.ts (the standard globals) and Tint links
// ./native-codec.ts (their runtime cores). The driver appends its `run()`.
//
// Text is Latin-1 unless a kernel's name ends in `TwoByte`: those repeat a
// kernel over text that holds code units above 0xFF, so a representation
// change cannot speed up one-byte text by slowing the general case.
import { cloneString, createCloner, decodeText, encodeText } from "./codec.ts";

const words: readonly string[] = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
];

function sentence(count: number, twoByte: boolean): string {
  let text = "";
  for (let i = 0; i < count; i++)
    text +=
      "line " +
      String(i) +
      (twoByte
        ? ": the quick brown 狐 jumps over the lazy 犬\n"
        : ": the quick brown fox jumps over the lazy dog\n");
  return text;
}

function mix(checksum: number, value: number): number {
  return (Math.imul(checksum, 31) + value) | 0;
}

// --- Creation: short strings from character codes and numbers. ---
export function create(scale: number): number {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < 64; i++) {
      const code = String.fromCharCode(
        97 + ((round + i) % 26),
        98 + (i % 20),
        48 + (i % 10),
      );
      const name = "v" + String(i);
      checksum = mix(
        checksum,
        code.length + name.length + code.charCodeAt(1) + name.charCodeAt(1),
      );
    }
  }
  return checksum;
}

// --- Concatenation: pairs and a growing buffer of words. ---
function concatenate(scale: number, twoByte: boolean): number {
  const separator = twoByte ? "・" : " ";
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    let text = "";
    for (let i = 0; i < 64; i++)
      text += (words[(i + round) & 7] ?? "") + separator;
    const pair =
      (words[round & 7] ?? "") + "-" + (words[(round >> 3) & 7] ?? "");
    checksum = mix(
      checksum,
      text.length + pair.length + text.charCodeAt(round % text.length),
    );
  }
  return checksum;
}
export function concat(scale: number): number {
  return concatenate(scale, false);
}
export function concatTwoByte(scale: number): number {
  return concatenate(scale, true);
}

// --- Equality: fresh strings (from split) against literals and each other. ---
const reserved =
  "function return const let var while for if else switch case break continue class extends super this new delete typeof instanceof void yield await import export default";
export function equality(scale: number): number {
  const source = reserved.split(" ");
  // A second split makes equal strings with distinct identities.
  const copies = reserved.split(" ");
  let hits = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < copies.length; i++) {
      const word = copies[i] ?? "";
      if (word === "instanceof") hits += 3;
      else if (word === "default" || word === "return") hits += 5;
      if (word === source[(i + round) % source.length]) hits++;
      if (word === source[i]) hits += 2;
    }
  }
  return hits | 0;
}

// --- Search: indexOf, lastIndexOf, includes and startsWith. ---
function searchText(scale: number, twoByte: boolean): number {
  const text = sentence(48, twoByte);
  const needles: readonly string[] = twoByte
    ? ["lazy 犬\n", "line 47", "狐", "zebra", "line 17:", "quick brown"]
    : ["lazy dog\n", "line 47", "fox", "zebra", "line 17:", "quick brown"];
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const needle = needles[round % needles.length] ?? "";
    const line = "line " + String(round % 48) + ":";
    checksum = mix(checksum, text.indexOf(needle));
    checksum = mix(checksum, text.lastIndexOf(needle));
    checksum = mix(checksum, text.includes(line) ? 1 : 0);
    checksum = mix(checksum, text.startsWith(line, round % 64) ? 1 : 0);
  }
  return checksum;
}
export function search(scale: number): number {
  return searchText(scale, false);
}
export function searchTwoByte(scale: number): number {
  return searchText(scale, true);
}

// --- Code units: a charCodeAt hash loop over a 2 KiB string. ---
function hashUnits(scale: number, twoByte: boolean): number {
  const text = sentence(40, twoByte);
  let checksum = 0;
  for (let round = 0; round < scale; round++)
    for (let i = 0; i < text.length; i++)
      checksum = mix(checksum, text.charCodeAt(i));
  return checksum;
}
export function codeUnits(scale: number): number {
  return hashUnits(scale, false);
}
export function codeUnitsTwoByte(scale: number): number {
  return hashUnits(scale, true);
}

// --- Split and join: a 64-field record line. ---
export function splitJoin(scale: number): number {
  const fields: string[] = [];
  for (let i = 0; i < 64; i++) fields.push("field" + String(i * 37));
  const line = fields.join(",");
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const parts = line.split(",");
    const joined = parts.join(";");
    checksum = mix(
      checksum,
      parts.length + joined.length + joined.charCodeAt(round % joined.length),
    );
  }
  return checksum;
}

// --- Slicing: slice and substring over a 2 KiB string. ---
function sliceText(scale: number, twoByte: boolean): number {
  const text = sentence(40, twoByte);
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < 32; i++) {
      const begin = (round * 7 + i * 61) % (text.length - 64);
      const part = text.slice(begin, begin + 8 + (i & 31));
      const tail = text.substring(begin + 32);
      checksum = mix(checksum, part.length + part.charCodeAt(3));
      checksum = mix(checksum, tail.length);
    }
  }
  return checksum;
}
export function slice(scale: number): number {
  return sliceText(scale, false);
}
export function sliceTwoByte(scale: number): number {
  return sliceText(scale, true);
}

// --- Number to string and back. ---
export function numberString(scale: number): number {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < 32; i++) {
      const value = round * 977 + i * 13;
      const integer = String(value);
      const fraction = String(value / 8);
      checksum = mix(checksum, integer.length + fraction.length);
      checksum = mix(checksum, Number(integer) & 1023);
      checksum = mix(checksum, Number(fraction) * 8 === value ? 1 : 0);
    }
  }
  return checksum;
}

// --- Template literals. ---
export function template(scale: number): number {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < 32; i++) {
      const name = words[i & 7] ?? "";
      const text = `${name}[${i}] = ${round & 255}; // ${name}`;
      checksum = mix(checksum, text.length + text.charCodeAt(text.length - 2));
    }
  }
  return checksum;
}

// --- Map with string keys: fresh keys are hashed on every lookup. ---
export function mapKeys(scale: number): number {
  const keys: string[] = [];
  for (let i = 0; i < 512; i++) keys.push("identifier_" + String(i));
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const map = new Map<string, number>();
    for (let i = 0; i < 512; i++) map.set(keys[i] ?? "", i + round);
    for (let i = 0; i < 512; i++) {
      const key = "identifier_" + String((i * 7 + round) & 1023);
      checksum = mix(checksum, map.get(key) ?? -1);
    }
  }
  return checksum;
}

// --- UTF-8 encoding and decoding (TextEncoder/TextDecoder's core). ---
function codec(scale: number, twoByte: boolean): number {
  const text = sentence(32, twoByte);
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const bytes = encodeText(text);
    const back = decodeText(bytes);
    checksum = mix(checksum, bytes.length + back.length);
    checksum = mix(checksum, back.charCodeAt(round % back.length));
  }
  return checksum;
}
export function utf8(scale: number): number {
  return codec(scale, false);
}
export function utf8TwoByte(scale: number): number {
  return codec(scale, true);
}

// --- Structured clone of 1 KiB and 1 MiB strings. ---
function cloneText(scale: number, size: number): number {
  // Built with one join, so the setup stays linear and the clone dominates.
  const parts: string[] = [];
  let length = 0;
  while (length < size) {
    const part = "clone payload " + String(length) + ";";
    parts.push(part);
    length += part.length;
  }
  const text = parts.join("").slice(0, size);
  const cloner = createCloner();
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const copy = cloneString(cloner, text);
    checksum = mix(checksum, copy.length + copy.charCodeAt(round % size));
  }
  return checksum;
}
export function clone1KiB(scale: number): number {
  return cloneText(scale, 1024);
}
export function clone1MiB(scale: number): number {
  return cloneText(scale, 1048576);
}

// --- PR #17's string kernels, unchanged from tools/typed-bench/kernels.ts
// at aab393287 (perf/typed-codegen), so their results compare with its
// harness. They moved to this stream with the landing bar. ---
// Strings: building, slicing and character scans.
export function strings(scale: number): number {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    const parts: string[] = [];
    for (let i = 0; i < 64; i++)
      parts.push("item" + String(round + i) + ":" + String((i * 7) % 10));
    const joined = parts.join(",");
    let text = "";
    for (let i = 0; i < 16; i++) text += joined.slice(i * 8, i * 8 + 6);
    for (let i = 0; i < text.length; i++)
      checksum = (Math.imul(checksum, 33) + text.charCodeAt(i)) | 0;
    checksum = (checksum + joined.indexOf("item" + String(round + 32))) | 0;
  }
  return checksum;
}
// String building: concatenation, templates, conversions, charCodeAt.
export function stringBuild(scale: number): number {
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    let text = "";
    for (let i = 0; i < 48; i++) text += `${i}:${round & 15};`;
    let line = "";
    for (let i = 0; i < 24; i++)
      line = line + String.fromCharCode(97 + ((i + round) % 26));
    const label = "round " + round + " of " + scale;
    for (let i = 0; i < text.length; i += 3)
      checksum = (Math.imul(checksum, 31) + text.charCodeAt(i)) | 0;
    checksum =
      (checksum + line.length + label.length + line.charCodeAt(round % 24)) | 0;
  }
  return checksum;
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export interface Die {
  readonly offset: number;
  readonly tag: number;
  readonly attrs: Map<number, unknown>;
  readonly children: Die[];
}
export function reader(bytes: Uint8Array, start = 0) {
  const decoder = new TextDecoder();
  let at = start;
  return {
    get at() {
      return at;
    },
    byte: () => bytes[at++]!,
    uleb: () => {
      let value = 0,
        shift = 0,
        byte: number;
      do {
        byte = bytes[at++]!;
        value += (byte & 127) * 2 ** shift;
        shift += 7;
      } while (byte & 128);
      return value;
    },
    sleb: () => {
      let value = 0,
        shift = 0,
        byte: number;
      do {
        byte = bytes[at++]!;
        value += (byte & 127) * 2 ** shift;
        shift += 7;
      } while (byte & 128);
      return byte & 64 ? value - 2 ** shift : value;
    },
    number: (length: number) => {
      let value = 0;
      for (let i = 0; i < length; i++) value += bytes[at++]! * 256 ** i;
      return value;
    },
    text: () => {
      const begin = at;
      while (bytes[at++] !== 0) assert.ok(at <= bytes.length);
      return decoder.decode(bytes.subarray(begin, at - 1));
    },
    block: (length: number) => {
      const value = bytes.slice(at, at + length);
      at += length;
      return value;
    },
  };
}
/** Decode the unit's DIE tree independently of the writer's layout. */
export function decodeInfo(abbrev: Uint8Array, info: Uint8Array): Die {
  const a = reader(abbrev),
    forms = new Map<
      number,
      { tag: number; children: boolean; attrs: [number, number][] }
    >();
  for (let code = a.uleb(); code !== 0; code = a.uleb()) {
    const tag = a.uleb(),
      children = a.byte() !== 0,
      attrs: [number, number][] = [];
    for (
      let name = a.uleb(), form = a.uleb();
      name || form;
      name = a.uleb(), form = a.uleb()
    )
      attrs.push([name, form]);
    forms.set(code, { tag, children, attrs });
  }
  const data = reader(info, 11);
  function die(): Die | undefined {
    const offset = data.at,
      code = data.uleb();
    if (code === 0) return undefined;
    const form = forms.get(code);
    assert.ok(form, `abbreviation ${code}`);
    const attrs = new Map<number, unknown>();
    for (const [name, kind] of form.attrs) {
      let value: unknown;
      if (kind === 8) value = data.text();
      else if (kind === 1 || kind === 7) value = data.number(8);
      else if (kind === 6 || kind === 0x13 || kind === 0x17)
        value = data.number(4);
      else if (kind === 5) value = data.number(2);
      else if (kind === 0x0b || kind === 0x0c) value = data.byte();
      else if (kind === 0x0f) value = data.uleb();
      else if (kind === 0x0d) value = data.sleb();
      else if (kind === 0x18) value = data.block(data.uleb());
      else if (kind === 0x19) value = true;
      else assert.fail(`unsupported test decoder form ${kind}`);
      attrs.set(name, value);
    }
    const children: Die[] = [];
    if (form.children)
      for (let child = die(); child; child = die()) children.push(child);
    return { offset, tag: form.tag, attrs, children };
  }
  return die()!;
}
export interface LocationEntry {
  readonly begin: number;
  readonly end: number;
  readonly expression: Uint8Array;
}
export function decodeLocations(
  loc: Uint8Array,
  offset: number,
): LocationEntry[] {
  const data = reader(loc, offset),
    entries: LocationEntry[] = [];
  while (true) {
    const begin = data.number(8),
      end = data.number(8);
    if (begin === 0 && end === 0) return entries;
    entries.push({ begin, end, expression: data.block(data.number(2)) });
  }
}
export function decodeRanges(
  ranges: Uint8Array,
  offset: number,
): { begin: number; end: number }[] {
  const data = reader(ranges, offset),
    entries: { begin: number; end: number }[] = [];
  while (true) {
    const begin = data.number(8),
      end = data.number(8);
    if (begin === 0 && end === 0) return entries;
    entries.push({ begin, end });
  }
}
export function walk(die: Die, visit: (die: Die) => void): void {
  visit(die);
  for (const child of die.children) walk(child, visit);
}
/** Apple's llvm-dwarfdump, when the host provides it through xcrun. */
export function dwarfdump(): string | undefined {
  const found = spawnSync("xcrun", ["--find", "llvm-dwarfdump"], {
    encoding: "utf8",
  });
  return found.status === 0 ? found.stdout.trim() : undefined;
}

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDebugInfo, type DebugRequest } from "@tint/image/dwarf";
import { buildAArch64Executable } from "../../../tools/aarch64-executable.ts";
import {
  decodeInfo,
  decodeLocations,
  decodeRanges,
  dwarfdump,
  walk,
  type Die,
} from "./support/dwarf-decode.ts";

const codeAddress = 0x100001000;
function request(): DebugRequest {
  return {
    codeAddress,
    codeLength: 64,
    directory: "/project",
    lines: [
      { offset: 0, byteLength: 16, file: "main.ts", line: 2, column: 3 },
      { offset: 16, byteLength: 16, file: "util.ts", line: 7, column: 5 },
      { offset: 32, byteLength: 24, file: "main.ts", line: 4, column: 1 },
    ],
    types: [
      { kind: "base", name: "number", byteSize: 8, encoding: "float" },
      { kind: "base", name: "char16_t", byteSize: 2, encoding: "utf" },
      { kind: "pointer", target: 3 },
      {
        kind: "structure",
        name: "Point",
        byteSize: 32,
        members: [
          { name: "x", type: 0, offset: 16 },
          { name: "next", type: 2, offset: 24 },
        ],
      },
      { kind: "array", element: 1, count: undefined },
      { kind: "base", name: "uint64", byteSize: 8, encoding: "unsigned" },
      {
        kind: "enumeration",
        name: "tag",
        byteSize: 8,
        base: 5,
        values: [
          { name: "undefined", value: 0 },
          { name: "number", value: 1 },
        ],
      },
      {
        kind: "union",
        name: "payload",
        byteSize: 8,
        members: [
          { name: "number", type: 0, offset: 0 },
          { name: "object", type: 2, offset: 0 },
        ],
      },
    ],
    origins: ["util.ts:helper"],
    functions: [
      {
        name: "main",
        offset: 0,
        byteLength: 56,
        variables: [
          {
            name: "count",
            type: 0,
            parameter: true,
            file: "main.ts",
            line: 1,
            locations: [
              {
                offset: 4,
                byteLength: 12,
                pieces: [{ part: { kind: "register", register: 72 } }],
              },
              {
                offset: 16,
                byteLength: 8,
                pieces: [
                  { part: { kind: "memory", register: 31, offset: 24 } },
                ],
              },
            ],
          },
          {
            name: "point",
            type: 2,
            locations: [
              {
                offset: 8,
                byteLength: 40,
                pieces: [{ part: { kind: "register", register: 28 } }],
              },
            ],
          },
          {
            name: "maybe",
            type: 0,
            locations: [
              {
                offset: 8,
                byteLength: 8,
                pieces: [
                  {
                    part: { kind: "register", register: 27 },
                    byteSize: 8,
                  },
                  {
                    part: { kind: "memory", register: 31, offset: 40 },
                    byteSize: 8,
                  },
                ],
              },
            ],
          },
          {
            name: "text",
            type: 1,
            locations: [
              {
                offset: 8,
                byteLength: 8,
                pieces: [
                  {
                    part: {
                      kind: "pointer",
                      base: { kind: "memory", register: 31, offset: 48 },
                      add: 24,
                      value: false,
                    },
                  },
                ],
              },
            ],
            count: [
              {
                offset: 8,
                byteLength: 8,
                pieces: [
                  {
                    part: {
                      kind: "pointer",
                      base: { kind: "memory", register: 31, offset: 48 },
                      add: 16,
                      value: true,
                    },
                  },
                ],
              },
            ],
          },
          { name: "gone", type: 0, locations: [] },
        ],
        inlined: [
          {
            origin: 0,
            callFile: "main.ts",
            callLine: 3,
            callColumn: 9,
            ranges: [
              { offset: 16, byteLength: 8 },
              { offset: 28, byteLength: 4 },
            ],
            variables: [
              {
                name: "value",
                type: 0,
                parameter: true,
                locations: [
                  {
                    offset: 16,
                    byteLength: 4,
                    pieces: [{ part: { kind: "register", register: 64 } }],
                  },
                ],
              },
            ],
            inlined: [
              {
                origin: 0,
                callFile: "util.ts",
                callLine: 8,
                callColumn: 2,
                ranges: [{ offset: 20, byteLength: 4 }],
                variables: [],
                inlined: [],
              },
            ],
          },
        ],
      },
    ],
    maxByteLength: 100000,
  };
}

function named(die: Die, name: string): Die {
  let found: Die | undefined;
  walk(die, (item) => {
    if (found === undefined && item.attrs.get(3) === name) found = item;
  });
  assert.ok(found, name);
  return found;
}

test("variables describe typed values with location lists, pieces and views", () => {
  const result = buildDebugInfo(request());
  assert.ok(result.ok);
  const { abbrev, info, loc } = result.value,
    unit = decodeInfo(abbrev, info),
    byOffset = new Map<number, Die>();
  walk(unit, (die) => byOffset.set(die.offset, die));
  const count = named(unit, "count");
  assert.equal(count.tag, 0x05);
  assert.equal(count.attrs.get(0x3b), 1);
  assert.equal(
    byOffset.get(count.attrs.get(0x49) as number)!.attrs.get(3),
    "number",
  );
  assert.deepEqual(
    decodeLocations(loc, count.attrs.get(2) as number).map((entry) => [
      entry.begin,
      entry.end,
      [...entry.expression],
    ]),
    [
      [4, 16, [0x90, 72]],
      [16, 24, [0x8f, 24]],
    ],
  );
  const point = named(unit, "point"),
    pointer = byOffset.get(point.attrs.get(0x49) as number)!,
    record = byOffset.get(pointer.attrs.get(0x49) as number)!;
  assert.equal(pointer.tag, 0x0f);
  assert.equal(record.tag, 0x13);
  assert.equal(record.attrs.get(3), "Point");
  assert.deepEqual(
    record.children.map((member) => [
      member.attrs.get(3),
      member.attrs.get(0x38),
    ]),
    [
      ["x", 16],
      ["next", 24],
    ],
  );
  // Recursive member types resolve to the pointer DIE.
  assert.equal(record.children[1]!.attrs.get(0x49), pointer.offset);
  assert.deepEqual(
    [
      ...decodeLocations(loc, named(unit, "maybe").attrs.get(2) as number)[0]!
        .expression,
    ],
    [0x6b, 0x93, 8, 0x8f, 40, 0x93, 8],
  );
  // A view: artificial count, array type counted by it, then the variable.
  const text = named(unit, "text"),
    array = byOffset.get(text.attrs.get(0x49) as number)!;
  assert.equal(array.tag, 0x01);
  const counter = byOffset.get(array.children[0]!.attrs.get(0x37) as number)!;
  assert.equal(counter.attrs.get(3), "__count_text");
  assert.equal(counter.attrs.get(0x34), true);
  assert.deepEqual(
    [...decodeLocations(loc, counter.attrs.get(2) as number)[0]!.expression],
    [0x8f, 48, 0x06, 0x23, 16, 0x06, 0x9f],
  );
  assert.deepEqual(
    [...decodeLocations(loc, text.attrs.get(2) as number)[0]!.expression],
    [0x8f, 48, 0x06, 0x23, 24],
  );
  assert.equal(named(unit, "gone").attrs.has(2), false);
  const tag = named(unit, "tag");
  assert.equal(tag.tag, 0x04);
  assert.deepEqual(
    tag.children.map((value) => [value.attrs.get(3), value.attrs.get(0x1c)]),
    [
      ["undefined", 0],
      ["number", 1],
    ],
  );
  assert.equal(named(unit, "payload").tag, 0x17);
});

test("inlined scopes reference abstract origins with call positions and ranges", () => {
  const result = buildDebugInfo(request());
  assert.ok(result.ok);
  const unit = decodeInfo(result.value.abbrev, result.value.info),
    origin = named(unit, "util.ts:helper");
  assert.equal(origin.tag, 0x2e);
  assert.equal(origin.attrs.get(0x20), 1);
  const main = named(unit, "main"),
    outer = main.children.find((die) => die.tag === 0x1d)!;
  assert.equal(outer.attrs.get(0x31), origin.offset);
  assert.equal(outer.attrs.get(0x59), 3);
  assert.equal(outer.attrs.get(0x57), 9);
  assert.deepEqual(
    decodeRanges(result.value.ranges, outer.attrs.get(0x55) as number),
    [
      { begin: 16, end: 24 },
      { begin: 28, end: 32 },
    ],
  );
  const inner = outer.children.find((die) => die.tag === 0x1d)!;
  assert.equal(inner.attrs.get(0x11), codeAddress + 20);
  assert.equal(inner.attrs.get(0x12), 4);
  assert.equal(
    outer.children.find((die) => die.tag === 0x05)!.attrs.get(3),
    "value",
  );
});

test("variable and scope metadata is validated", () => {
  const base = request(),
    fn = base.functions[0]!,
    variables = fn.variables!,
    scope = fn.inlined![0]!;
  const invalid: DebugRequest[] = [
    { ...base, types: [{ kind: "pointer", target: 9 }] },
    { ...base, origins: [""] },
    {
      ...base,
      functions: [
        { ...fn, variables: [{ ...variables[0]!, type: base.types!.length }] },
      ],
    },
    {
      ...base,
      functions: [
        {
          ...fn,
          variables: [
            {
              ...variables[0]!,
              locations: [
                {
                  offset: 52,
                  byteLength: 8,
                  pieces: [{ part: { kind: "register", register: 0 } }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      ...base,
      functions: [
        {
          ...fn,
          variables: [
            {
              ...variables[0]!,
              locations: [
                {
                  offset: 4,
                  byteLength: 4,
                  pieces: [
                    { part: { kind: "register", register: 0 } },
                    { part: { kind: "register", register: 1 }, byteSize: 8 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { ...base, functions: [{ ...fn, inlined: [{ ...scope, origin: 1 }] }] },
    {
      ...base,
      functions: [
        {
          ...fn,
          inlined: [
            {
              ...scope,
              inlined: [
                {
                  ...scope.inlined[0]!,
                  ranges: [{ offset: 24, byteLength: 4 }],
                },
              ],
            },
          ],
        },
      ],
    },
  ];
  for (const changed of invalid)
    assert.deepEqual(buildDebugInfo(changed), {
      ok: false,
      error: "INVALID_INPUT",
    });
});

test("llvm-dwarfdump verifies an executable with variables, types and inline scopes", (t) => {
  const tool = dwarfdump();
  if (tool === undefined) return t.skip("llvm-dwarfdump is unavailable");
  const {
    codeAddress: _,
    codeLength: __,
    maxByteLength: ___,
    ...debug
  } = request();
  const code = new Uint8Array(64);
  // ret at every word keeps the image executable; contents are irrelevant.
  for (let at = 0; at < code.length; at += 4)
    code.set([0xc0, 0x03, 0x5f, 0xd6], at);
  const built = buildAArch64Executable({
    code,
    entryOffset: 0,
    identifier: "tint.dwarf.test",
    minimumOS: { major: 14, minor: 0, patch: 0 },
    sdk: { major: 15, minor: 0, patch: 0 },
    maxByteLength: 1024 * 1024,
    debug,
  });
  assert.ok(built.ok);
  const directory = mkdtempSync(join(tmpdir(), "tint-dwarf-"));
  try {
    const image = join(directory, "image");
    writeFileSync(image, built.value.bytes);
    const verified = spawnSync(tool, ["--verify", image], { encoding: "utf8" });
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
    assert.match(verified.stdout, /No errors\./);
    const dumped = spawnSync(tool, ["--debug-info", image], {
      encoding: "utf8",
    });
    assert.equal(dumped.status, 0, dumped.stderr);
    assert.match(dumped.stdout, /DW_TAG_inlined_subroutine/);
    assert.match(dumped.stdout, /DW_AT_location\s+\(0x[0-9a-f]+:/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

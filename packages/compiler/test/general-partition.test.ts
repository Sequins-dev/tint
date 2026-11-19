import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import {
  boundaryExport,
  boundaryNumber,
  boundaryString,
  boundaryUndefined,
  boundaryUnknown,
  closeGeneralPartition,
  createBoundaryRecords,
} from "../src/native/general-partition.ts";

function module(
  id: string,
  text: string,
  dependencies: [string, string][] = [],
): SourceModule {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return { id, module: parsed.value, dependencies: new Map(dependencies) };
}

test("primitive functions and constants cross checked boundaries", () => {
  const lib = module(
    "lib",
    "export function f(a: number, b?: string, c: number | undefined = 1): void {}\nexport const k: number = 1;\nexport function g(a: number[]): number { return 0; }\nconst h = (x: number): number => x;\nexport { h };",
  );
  assert.deepEqual(boundaryExport(lib, "f"), {
    kind: "function",
    name: "f",
    local: "f",
    parameters: [
      boundaryNumber,
      boundaryString | boundaryUndefined,
      boundaryNumber | boundaryUndefined,
    ],
  });
  assert.deepEqual(boundaryExport(lib, "k"), {
    kind: "constant",
    name: "k",
    local: "k",
  });
  assert.equal(boundaryExport(lib, "g"), undefined);
  assert.equal(boundaryExport(lib, "h"), undefined);
});

test("general modules close over importers and unsafe typed imports", () => {
  const lib = module(
    "lib",
    "export function f(n: number): number { return n; }\nexport interface Shape { x: number }",
  );
  const records = module(
    "records",
    "export function make(): { x: number } { return { x: 1 }; }",
  );
  const mid = module(
    "mid",
    'import { make } from "./records";\nexport function g(): number { return make().x; }',
    [["./records", "records"]],
  );
  const main = module(
    "main",
    'import { f, Shape } from "./lib";\nimport { g } from "./mid";\nexport function run(): number { return f(g()); }',
    [
      ["./lib", "lib"],
      ["./mid", "mid"],
    ],
  );
  const leaf = module(
    "leaf",
    'import { f } from "./lib";\nexport function bad(): number { return f(1); }',
    [["./lib", "lib"]],
  );
  const application = [lib, records, mid, main, leaf];
  // `mid` is rejected: its importer `main` becomes general; `make` returns a
  // record, which cannot cross a checked boundary, so `records` becomes
  // general too. `lib` stays typed behind a checked entry for `f` (the
  // interface import needs none), and `leaf` is untouched.
  const partition = closeGeneralPartition(application, new Set(["mid"]));
  assert.deepEqual(partition.general.map((m) => m.id).sort(), [
    "main",
    "mid",
    "records",
  ]);
  assert.deepEqual(partition.boundaries, [
    {
      id: "lib",
      exports: [
        {
          kind: "function",
          name: "f",
          local: "f",
          parameters: [boundaryNumber],
        },
      ],
    },
  ]);
});

test("unknown parameters and results cross with their identity", () => {
  const lib = module(
    "lib",
    "export function identity(value: unknown): unknown { return value; }\nexport function kind(value: unknown, fallback?: string): string { return typeof value; }\nexport const seed: unknown = 1;",
  );
  assert.deepEqual(boundaryExport(lib, "identity"), {
    kind: "function",
    name: "identity",
    local: "identity",
    parameters: [boundaryUnknown],
  });
  assert.deepEqual(boundaryExport(lib, "kind"), {
    kind: "function",
    name: "kind",
    local: "kind",
    parameters: [boundaryUnknown, boundaryString | boundaryUndefined],
  });
  assert.deepEqual(boundaryExport(lib, "seed"), {
    kind: "constant",
    name: "seed",
    local: "seed",
  });
});

test("trusted modules stay typed behind checked boundaries", () => {
  const runtime = module(
    "runtime",
    "export function identity(value: unknown): unknown { return value; }\nexport function make(): { x: number } { return { x: 1 }; }",
  );
  const main = module(
    "main",
    'import { identity } from "runtime";\nexport function run(): unknown { return identity(1); }',
    [["runtime", "runtime"]],
  );
  const partition = closeGeneralPartition([main], new Set(["main"]), [runtime]);
  assert.deepEqual(
    partition.general.map((m) => m.id),
    ["main"],
  );
  assert.equal(partition.blocked, undefined);
  assert.deepEqual(partition.boundaries, [
    {
      id: "runtime",
      exports: [
        {
          kind: "function",
          name: "identity",
          local: "identity",
          parameters: [boundaryUnknown],
        },
      ],
    },
  ]);
  // An export whose type cannot cross is reported instead of making the
  // trusted module general.
  const records = module(
    "main",
    'import { make } from "runtime";\nexport function run(): number { return make().x; }',
    [["runtime", "runtime"]],
  );
  const blocked = closeGeneralPartition([records], new Set(["main"]), [
    runtime,
  ]);
  assert.deepEqual(
    blocked.general.map((m) => m.id),
    ["main"],
  );
  assert.deepEqual(blocked.blocked, { module: "runtime", exports: "make" });
});

test("exported interfaces cross boundaries as record views", () => {
  const shapes = module(
    "shapes",
    "export interface Point { x: number; readonly y: number; label?: string }",
  );
  const lib = module(
    "lib",
    'import type { Point } from "./shapes";\n' +
      "export interface Segment { readonly from: Point; to?: Point; next?: Segment }\n" +
      "interface Hidden { x: number }\n" +
      "export interface Box<T> { value: T }\n" +
      "export interface Shape { area(): number }\n" +
      "export function make(x: number): Point { return { x, y: 1 }; }\n" +
      "export function length(s: Segment, scale?: Point): number { return 0; }\n" +
      "export function hidden(h: Hidden): number { return h.x; }\n" +
      "export function boxed(b: Box<number>): number { return b.value; }\n" +
      "export function shape(s: Shape): number { return 0; }",
    [["./shapes", "shapes"]],
  );
  const main = module(
    "main",
    'import { make, length, hidden, boxed, shape } from "./lib";\nexport function run(): number { return 0; }',
    [["./lib", "lib"]],
  );
  // `hidden`, `boxed` and `shape` cannot cross (a non-exported, generic or
  // method-bearing interface), so `lib` itself becomes general.
  const blocked = closeGeneralPartition([shapes, lib, main], new Set(["main"]));
  assert.ok(blocked.general.some((m) => m.id === "lib"));
  const crossing = module(
    "main",
    'import { make, length } from "./lib";\nexport function run(): number { return 0; }',
    [["./lib", "lib"]],
  );
  const partition = closeGeneralPartition(
    [shapes, lib, crossing],
    new Set(["main"]),
  );
  assert.deepEqual(
    partition.general.map((m) => m.id),
    ["main"],
  );
  const point = "shapes\u0000Point",
    segment = "lib\u0000Segment";
  assert.deepEqual(partition.boundaries[0]?.exports, [
    {
      kind: "function",
      name: "make",
      local: "make",
      parameters: [boundaryNumber],
      records: {
        parameters: [undefined],
        result: { key: point, optional: false },
      },
    },
    {
      kind: "function",
      name: "length",
      local: "length",
      parameters: [0, 0],
      records: {
        parameters: [
          { key: segment, optional: false },
          { key: point, optional: true },
        ],
        result: undefined,
      },
    },
  ]);
  assert.deepEqual(
    partition.records?.map((record) => record.key).sort(),
    [segment, point].sort(),
  );
  const segmentRecord = partition.records?.find((r) => r.key === segment);
  assert.deepEqual(segmentRecord?.fields, [
    {
      name: "from",
      readonly: true,
      classes: 0,
      record: { key: point, optional: false },
    },
    {
      name: "to",
      readonly: false,
      classes: 0,
      record: { key: point, optional: true },
    },
    {
      name: "next",
      readonly: false,
      classes: 0,
      record: { key: segment, optional: true },
    },
  ]);
  const pointRecord = partition.records?.find((r) => r.key === point);
  assert.deepEqual(pointRecord?.fields, [
    { name: "x", readonly: false, classes: boundaryNumber },
    { name: "y", readonly: true, classes: boundaryNumber },
    {
      name: "label",
      readonly: false,
      classes: boundaryString | boundaryUndefined,
    },
  ]);
});

test("dynamic boundaries resolve imported aliases without a record view", () => {
  const types = module(
    "types",
    `export interface Counters { [key: string]: number; count: number }
export type MapOfCounters = Record<string, Counters>;`,
  );
  const lib = module(
    "lib",
    `import type { Counters, MapOfCounters } from "./types";
export function identity(value: Counters | undefined): Counters | undefined { return value; }
export function make(): MapOfCounters { return {}; }`,
    [["./types", "types"]],
  );
  const records = createBoundaryRecords(
    new Map([
      ["types", types],
      ["lib", lib],
    ]),
  );
  const identity = boundaryExport(lib, "identity", records);
  assert.ok(identity?.kind === "function");
  const use = identity.records?.parameters[0]?.dynamic;
  assert.ok(use);
  assert.match(use.declarations, /\[key:string\]:number/);
  assert.match(use.declarations, /undefined/);
  assert.ok(identity.records?.result?.dynamic);
  const make = boundaryExport(lib, "make", records);
  assert.ok(make?.kind === "function");
  assert.match(
    make.records?.result?.dynamic?.declarations ?? "",
    /Record<string,/,
  );
  assert.deepEqual(records.records(), []);
});

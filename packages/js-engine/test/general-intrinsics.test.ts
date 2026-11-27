import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule, type Module } from "@tint/typescript/syntax";
import {
  generalIntrinsics,
  intrinsicInstallers,
} from "../src/program/intrinsics.ts";

function parse(text: string): Module {
  const bytes = new TextEncoder().encode(text),
    decoded = createSourceText(bytes, bytes.length);
  assert.ok(decoded.ok);
  const parsed = parseModule(decoded.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
const core = [
  "installErrorIntrinsics",
  "installArrayIntrinsics",
  "installObjectIntrinsics",
  "installFunctionIntrinsics",
  "installPrimitiveIntrinsics",
  "installIteratorConstructor",
  "installSymbolIntrinsics",
];
function extra(text: string): string[] {
  return generalIntrinsics([parse(text)]).filter(
    (installer) => !core.includes(installer),
  );
}

test("plain code installs only the core, in installation order", () => {
  const selected = generalIntrinsics([
    parse(
      "export function run() { let t = 0; for (const x of [1, 2]) t += x; return `${t}`.length; }",
    ),
  ]);
  assert.deepEqual(
    selected,
    intrinsicInstallers.filter((installer) => core.includes(installer)),
  );
});

test("named globals select their installers", () => {
  assert.deepEqual(extra("export const m = new Map(), s = new Set();"), [
    "installMapIntrinsics",
    "installSetIntrinsics",
  ]);
  assert.deepEqual(extra("export const b = new Uint8Array(2);"), [
    "installArrayBufferIntrinsics",
    "installTypedArrayIntrinsics",
  ]);
  assert.deepEqual(
    extra("export const v = new DataView(new ArrayBuffer(1));"),
    ["installArrayBufferIntrinsics", "installDataViewIntrinsics"],
  );
  assert.deepEqual(extra("export const x = Math.max(1, 2);"), [
    "installMathIntrinsics",
  ]);
  assert.deepEqual(extra("export const r = Reflect.has({}, 'a');"), [
    "installReflectIntrinsics",
  ]);
  assert.deepEqual(extra("export const w = new WeakMap();"), [
    "installWeakCollectionIntrinsics",
  ]);
  assert.deepEqual(extra("export const s = new SharedArrayBuffer(16);"), [
    "installArrayBufferIntrinsics",
    "installSharedArrayBufferIntrinsics",
  ]);
  assert.deepEqual(extra("export const a = Atomics.isLockFree(4);"), [
    "installAtomicsIntrinsics",
  ]);
});

test("a local binding of the same name does not select the global", () => {
  assert.deepEqual(
    extra("const Map = 1; export function run() { return Map; }"),
    [],
  );
});

test("syntax that creates objects selects their installers", () => {
  assert.deepEqual(extra("export const r = /a/g;"), [
    "installRegExpIntrinsics",
  ]);
  for (const text of [
    "export async function f() { return 1; }",
    "export const f = async () => 1;",
    "export const o = { async m() { return 1; } };",
    "export class C { async m() { return 1; } }",
    "export async function* g() { yield 1; }",
    "export const p = import('./x.js');",
    "export const v = await 1;",
    "export async function f(xs) { for await (const x of xs) {} }",
  ])
    assert.deepEqual(extra(text), ["installPromiseIntrinsics"], text);
  assert.deepEqual(extra("export function f(r) { using x = r; }"), [
    "installDisposableStackIntrinsics",
  ]);
  assert.deepEqual(extra("export async function f(r) { await using x = r; }"), [
    "installAsyncDisposableStackIntrinsics",
    "installPromiseIntrinsics",
  ]);
});

test("member operations that create objects select their installers", () => {
  assert.deepEqual(extra("export const m = 'abc'.match('b');"), [
    "installRegExpIntrinsics",
  ]);
  assert.deepEqual(extra("export const a = Array.fromAsync([1]);"), [
    "installPromiseIntrinsics",
  ]);
});

test("dynamic access to globals installs everything", () => {
  for (const text of [
    "export const g = globalThis;",
    "export const v = eval('1');",
    "export const f = Function('return 1');",
  ])
    assert.deepEqual(
      generalIntrinsics([parse(text)]),
      intrinsicInstallers,
      text,
    );
});

test("installer requirements accumulate in installation order across replayed modules", async () => {
  const { createGeneralIntrinsicPlan } =
    await import("../src/program/intrinsics.ts");
  const plan = createGeneralIntrinsicPlan();
  const a = parse("export const promise = Promise.resolve(1);");
  const b = parse("export const map = new Map();");
  plan.addModule(a);
  plan.addModule(b);
  plan.addModule(a);
  assert.deepEqual(plan.installers(), generalIntrinsics([a, b]));
  plan.addModule(parse("export const realm = globalThis;"));
  assert.deepEqual(plan.installers(), intrinsicInstallers);
});

test("usesDate stays false until Date or dynamic global access is referenced", async () => {
  const { createGeneralIntrinsicPlan } =
    await import("../src/program/intrinsics.ts");
  const plain = createGeneralIntrinsicPlan();
  plain.addModule(parse("export function run() { return 1 + 2; }"));
  assert.equal(plain.usesDate(), false);
  const shadowed = createGeneralIntrinsicPlan();
  shadowed.addModule(parse("const Date = 1; export const x = Date;"));
  assert.equal(shadowed.usesDate(), false);
  const direct = createGeneralIntrinsicPlan();
  direct.addModule(parse("export const d = new Date(2024, 0, 15);"));
  assert.equal(direct.usesDate(), true);
  const dynamic = createGeneralIntrinsicPlan();
  dynamic.addModule(parse("export const g = globalThis;"));
  assert.equal(dynamic.usesDate(), true);
});

test("general lowering wires weak, shared-memory, and date capabilities selectively", async () => {
  const { createGeneralLowering } = await import("../src/program/index.ts");
  const lowering = createGeneralLowering({
    runtime: {
      objects: "objects",
      modules: "modules",
      globalEnvironment: "global",
      environmentRecords: "records",
    },
    weakStorage: "weak-mod",
    sharedMemory: {
      sharedBlocks: "shared-blocks-mod",
      sharedAtomics: "shared-atomics-mod",
      memory: "memory-mod",
      adoptExternal: "ffi-primitives-mod",
    },
    dateTime: {
      clock: "clock-mod",
      fs: "fs-mod",
      files: "files-mod",
      tzif: "tzif-mod",
      timeZonePath: "/etc/localtime",
    },
  });
  function lowerOne(source: string) {
    const main = { id: "main", module: parse(source), dependencies: new Map() };
    const result = lowering.lower({
      modules: [main],
      available: [main],
      entry: "main",
      start: "run",
      boundaries: [],
    });
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  }
  const plain = lowerOne("export function run() { return 1 + 2; }");
  assert.equal(plain.weakBindings, undefined);
  assert.equal(plain.hostBindings, undefined);
  assert.equal(plain.foreignMemoryBindings, undefined);
  assert.equal(plain.runtimes, undefined);

  const weak = lowerOne("export function run() { return new WeakMap(); }");
  assert.equal(weak.weakBindings?.length, 5);
  assert.equal(weak.hostBindings, undefined);
  assert.equal(weak.foreignMemoryBindings, undefined);

  const sab = lowerOne(
    "export function run() { return new SharedArrayBuffer(16); }",
  );
  assert.equal(sab.weakBindings, undefined);
  assert.equal(sab.hostBindings?.length, 8);
  assert.equal(sab.foreignMemoryBindings?.length, 1);

  const date = lowerOne(
    "export function run() { return new Date(2024, 0, 15).getFullYear(); }",
  );
  assert.equal(date.weakBindings, undefined);
  assert.equal(date.foreignMemoryBindings, undefined);
  assert.deepEqual(date.hostBindings, [
    {
      module: "clock-mod",
      name: "wallClockMilliseconds",
      operation: "wall-clock-time",
    },
  ]);
});

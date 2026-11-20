import assert from "node:assert/strict";
import { test } from "node:test";
import { createHostedSourceValidator } from "./source-validation.ts";

test("checks a typed sibling and a generator's return at original UTF-16 offsets", () => {
  const text = `// 😀
function* count(): Generator<number, number, unknown> { yield 1; return "bad"; }
export function run(): number { const invalid: number = "wrong"; return invalid; }`;
  const validate = createHostedSourceValidator([{ id: "main", text }]);
  const diagnostics = validate("main");
  assert.deepEqual(
    diagnostics.map(({ code, module, start, end }) => [
      code,
      module,
      text.slice(start, end),
    ]),
    [
      ["TS2322", "main", "return"],
      ["TS2322", "main", "invalid"],
    ],
  );
  assert.equal(validate("main"), diagnostics);
});

test("allows assignments to open inferred slots but diagnoses explicit constraints", () => {
  const text = `
export function run(): number {
  let value = 1;
  value = "open";
  const callback: (value: number) => void = (value) => { value = "open"; };
  callback(1);
  let fixed: number = 1;
  fixed = "closed";
  return fixed;
}`;
  const diagnostics = createHostedSourceValidator([{ id: "main", text }])(
    "main",
  );
  assert.deepEqual(
    diagnostics.map(({ code, start, end }) => [code, text.slice(start, end)]),
    [["TS2322", "fixed"]],
  );
});

test("keeps explicit destinations checked and recognizes a proven indexed read", () => {
  const text = `
export function run(): number {
  const bytes = new Uint8Array(2);
  const unproven: number = bytes[0];
  bytes[1] = 42;
  const proven: number = bytes[1];
  return proven;
}`;
  const diagnostics = createHostedSourceValidator([{ id: "main", text }])(
    "main",
  );
  assert.deepEqual(
    diagnostics.map(({ code, start, end }) => [code, text.slice(start, end)]),
    [["TS2322", "unproven"]],
  );
});

test("uses captured resolution, checks type-only dependencies and honors unchecked inputs", () => {
  const validate = createHostedSourceValidator([
    {
      id: "main",
      text: `import type { Value } from "virtual:types";
import { ignore } from "./helper.ts";
const value: Value = 42;
export function run(): number { ignore(value); return value; }`,
      dependencies: new Map([
        ["virtual:types", "original types"],
        ["./helper.ts", "helper"],
      ]),
    },
    {
      id: "original types",
      text: 'export type Value = number; const mistake: number = "bad";',
    },
    { id: "helper", text: "export function ignore(value) {}", unchecked: true },
    { id: "unreachable", text: 'const mistake: number = "also bad";' },
  ]);
  assert.deepEqual(
    validate("main").map(({ module, code }) => [module, code]),
    [["original types", "TS2322"]],
  );
});

test("rejects an unresolved host import and strict binding early errors", () => {
  const validate = createHostedSourceValidator([
    {
      id: "import",
      text: 'import { thing } from "node:unconfigured"; export const result = thing();',
    },
    {
      id: "strict",
      text: "export function run(): number { let x = 1; let x = 2; return x; }",
    },
  ]);
  assert.deepEqual(
    validate("import").map(({ code }) => code),
    ["TS2307"],
  );
  assert.match(
    validate("strict")[0]?.message ?? "",
    /duplicate|already|redeclar/i,
  );
});

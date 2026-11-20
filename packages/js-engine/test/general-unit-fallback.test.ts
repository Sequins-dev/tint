import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { bindJavaScriptModule } from "@tint/typescript/binding";
import { parseModule } from "@tint/typescript/syntax";
import { createGeneralLowering } from "../src/program/index.ts";

const body = `function kernel(): number { return 6 * 7; }
function read(): number { return kernel() - arguments.length; }`;
const text = body + "\nexport function run(): number { return read(); }";

function lower(text: string, sourceValidated = true) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok);
  const owner = parsed.value.statements.find(
    (statement) => statement.kind === "function" && statement.name === "read",
  );
  assert.ok(owner);
  const main = { id: "main", module: parsed.value, dependencies: new Map() };
  const lowering = createGeneralLowering({
    runtime: {
      objects: "objects",
      modules: "modules",
      globalEnvironment: "global",
      environmentRecords: "records",
    },
    functionFallback: true,
  });
  const result = lowering.lower({
    modules: [main],
    available: [main],
    entry: "main",
    start: "run",
    boundaries: [],
    sourceValidated,
    trigger: {
      phase: "link",
      code: "UNKNOWN_NAME",
      capability: "arguments-object",
      location: { module: "main", start: owner.start, end: owner.end },
      owner: {
        kind: "function",
        module: "main",
        start: owner.start,
        end: owner.end,
      },
    },
  });
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

test("an arguments fallback retains ordinary siblings and wires both call directions", () => {
  const mixed = lower(text);
  assert.deepEqual(mixed.functions, [
    {
      module: "main",
      name: "read",
      start: body.indexOf("function read"),
      end: body.length,
    },
  ]);
  const typed = mixed.modules.find(({ id }) => id === "$typed:main");
  assert.ok(typed);
  assert.deepEqual(
    typed.module.statements
      .filter((statement) => statement.kind === "function")
      .map(({ name }) => name),
    ["kernel", "run"],
  );
  assert.equal(typed.dependencies.get("$general-host:main"), mixed.entry);
  const host = mixed.modules.find(({ id }) => id === mixed.entry);
  assert.equal(host?.dependencies.get(typed.id), typed.id);
});

test("identity-sensitive uses retain the whole-module path", () => {
  const result = lower(
    body +
      "\nexport function run(): number { const escaped = read; return escaped(); }",
  );
  assert.equal(result.functions, undefined);
  assert.ok(!result.modules.some(({ id }) => id === "$typed:main"));
});

test("unit fallback requires successful original source validation", () => {
  assert.equal(lower(text, false).functions, undefined);
});

test("validated general functions carry primitive parameter and result contracts", () => {
  const source = `function read(value: number = 21): number {
  if (arguments.length > 1) throw { value };
  return value * 2;
}
export function run(): number { return read(); }`;
  for (const validated of [true, false]) {
    const lowered = lower(source, validated);
    const general = lowered.modules.find(({ id }) => id === "$general:main");
    const helpers = general?.module.imports.flatMap(({ bindings }) =>
      bindings.map(({ imported }) => imported),
    );
    assert.equal(helpers?.includes("checkPrimitiveContract"), validated);
    assert.equal(helpers?.includes("createCheckedSourceFunction"), validated);
  }
});

test("a mixed unit with defaults keeps omitted and explicit arguments distinct", () => {
  const mixed = lower(`function kernel(): number { return 20; }
function read(value: number = kernel()): number {
  const observed = arguments.length;
  return value + observed;
}
export function run(): number { return read() + read(undefined) + 1; }`);
  assert.equal(mixed.functions?.[0]?.name, "read");
  const host = mixed.modules.find(({ id }) => id === mixed.entry);
  const adapters = host?.module.statements.filter(
    (statement) =>
      statement.kind === "function" &&
      /^\$tintCallUnit\d$/.test(statement.name),
  );
  assert.equal(adapters?.length, 2);
});

test("a reassignable typed callee retains the whole-module path", () => {
  const result = lower(
    body +
      "\nexport function run(): number { kernel = (): number => 42; return read(); }",
  );
  assert.equal(result.functions, undefined);
});

test("numeric rest arguments retain their annotation in the typed entry", () => {
  const mixed =
    lower(`function read(...values: number[]): number { return arguments.length; }
export function run(): number { return read(11, 12) - read(); }`);
  assert.equal(mixed.functions?.[0]?.name, "read");
  assert.equal(mixed.runtimes, undefined);
  const host = mixed.modules.find(({ id }) => id === mixed.entry);
  const call = host?.module.statements.find(
    (statement) =>
      statement.kind === "function" && statement.name === "$tintCallUnit",
  );
  assert.ok(call?.kind === "function");
  assert.equal(call.parameters[0]?.rest, true);
  assert.equal(call.parameters[0]?.type?.kind, "array");
});

test("a reentrant call can select a branch using the captured argument count", () => {
  const mixed = lower(`function kernel(): number { return read() + 22; }
function read(...values: number[]): number { return arguments.length === 0 ? 17 : kernel() + arguments.length; }
export function run(): number { return read(1, 2, 3); }`);
  assert.equal(mixed.functions?.[0]?.name, "read");
});

test("numeric arguments cross in both call directions", () => {
  const mixed =
    lower(`function kernel(left: number, right: number): number { return left * 10 + right; }
function read(value: number): number { return kernel(value, arguments.length) + 1; }
export function run(): number { return read(4); }`);
  assert.equal(mixed.functions?.[0]?.name, "read");
  assert.equal(mixed.runtimes, undefined);
  const host = mixed.modules.find(({ id }) => id === mixed.entry);
  const call = host?.module.statements.find(
    (statement) =>
      statement.kind === "function" && statement.name === "$tintCallUnit",
  );
  assert.ok(call?.kind === "function");
  assert.equal(call.parameters.length, 1);
  assert.equal(call.parameters[0]?.type?.kind, "named");
  assert.ok(host);
  const bound = bindJavaScriptModule(host.module);
  assert.ok(bound.ok);
  assert.equal(
    bound.value.references.some(({ global }) => global === "toRealmError"),
    false,
  );
  const general = mixed.modules.find(({ id }) => id === "$general:main");
  assert.equal(general?.dependencies.get("$typed:main"), "$typed:main");
});

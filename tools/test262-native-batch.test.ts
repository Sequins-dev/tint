import { test } from "node:test";
import assert from "node:assert/strict";
import * as native from "./test262-native.ts";
import { executionPlan } from "./test262-execution.ts";

const metadata = { flags: ["raw"], features: [], includes: [] };
function scripts(source: string) {
  const prepared = native.prepareNativeScripts(
    executionPlan(source, "raw", metadata),
    "raw",
    [],
  );
  assert.ok(prepared.ok);
  return prepared.modules;
}

test("batch preparation isolates colliding Script IDs and builds a selector entry", () => {
  assert.equal(typeof native.prepareNativeBatch, "function");
  const first = scripts("var shared = 42;"),
    second = scripts("if(typeof shared !== 'undefined') throw 1;");
  const modules = native.prepareNativeBatch([
    { scripts: first, asynchronous: false },
    { scripts: second, asynchronous: true },
  ]);
  assert.equal(
    new Set(modules.map((module) => module.id)).size,
    modules.length,
  );
  assert.equal(
    modules.filter((module) => module.id.endsWith("-host")).length,
    3,
  );
  for (const module of modules)
    for (const dependency of module.dependencies.values()) {
      if (dependency.startsWith("test262-"))
        assert.ok(modules.some((item) => item.id === dependency));
    }
  assert.equal(first[0]!.id, "test262-script-0");
  assert.equal(second[0]!.id, "test262-script-0");
});

test("empty batches and cases are rejected before compilation", () => {
  assert.equal(typeof native.prepareNativeBatch, "function");
  assert.throws(() => native.prepareNativeBatch([]), /empty/);
  assert.throws(
    () => native.prepareNativeBatch([{ scripts: [], asynchronous: false }]),
    /missing test/,
  );
});

test("invalid batch selectors cannot become debugger commands", async () => {
  const { executeNativeImage } = await import("./test262-native-process.ts");
  for (const index of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () => executeNativeImage(new Uint8Array(), 1, index),
      /selector/,
    );
});

test("run journals preserve partial observations and refuse to overwrite earlier runs", async () => {
  const nativeProcess = await import("./test262-native-process.ts");
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  assert.equal(typeof nativeProcess.createNativeRunJournal, "function");
  const directory = mkdtempSync(join(tmpdir(), "tint-journal-test-"));
  try {
    const path = join(directory, "run.jsonl");
    const { append } = nativeProcess.createNativeRunJournal(path, {
      kind: "start",
      revision: "pinned",
    });
    append({ kind: "observation", status: "crash", detail: "first\nsecond" });
    const records = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(records, [
      { kind: "start", revision: "pinned" },
      { kind: "observation", status: "crash", detail: "first\nsecond" },
    ]);
    assert.throws(
      () => nativeProcess.createNativeRunJournal(path, { kind: "start" }),
      /EEXIST/,
    );
    assert.equal(readFileSync(path, "utf8").trim().split("\n").length, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("identical Script code is shared without merging its execution entries", () => {
  const first = scripts("var shared=42;");
  const second = scripts("var shared=42;");
  const modules = native.prepareNativeBatch([
    { scripts: first, asynchronous: false },
    { scripts: second, asynchronous: false },
  ]);
  const entries = modules.filter((module) =>
    module.module.statements.some(
      (statement) =>
        statement.kind === "function" && statement.name === "execute",
    ),
  );
  assert.equal(entries.length, 1);
  assert.equal(
    modules.filter((module) => module.id.endsWith("-host")).length,
    3,
  );
});

test("native image runner retains immutable bytes until explicit disposal", async () => {
  const process = await import("./test262-native-process.ts");
  const fs = await import("node:fs");
  assert.equal(typeof process.NativeImageRunner, "function");
  const bytes = new Uint8Array([1, 2, 3]);
  const image = new process.NativeImageRunner(bytes, 1000);
  const path = image.path;
  try {
    bytes[0] = 9;
    assert.deepEqual([...fs.readFileSync(path)], [1, 2, 3]);
    assert.throws(() => image.run(-1), /selector/);
    assert.equal(fs.existsSync(path), true);
  } finally {
    image.close();
  }
  image.close();
  assert.equal(fs.existsSync(path), false);
  assert.throws(() => image.run(0), /closed/);
});

test("existing native artifacts can use containment without staging another image", async () => {
  const process = await import("./test262-native-process.ts");
  assert.equal(typeof process.executeNativeFile, "function");
  for (const index of [-1, 1.5, Number.NaN])
    assert.throws(
      () => process.executeNativeFile("missing-native-artifact", 1, index),
      /invalid native batch selector/,
    );
});

test("module batches retain named factories and permit an empty raw harness", () => {
  const plan = executionPlan("export const value=42;", "module", {
    flags: ["raw"],
    includes: [],
    features: [],
  });
  const prepared = native.prepareNativeModuleProgram(
    plan,
    [],
    "root.js",
    () => ({ root: "root.js", nodes: [], absent: [], siblings: ["root.js"] }),
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const evaluation = {
    evaluation: "packages/js-engine/src/script-evaluation.ts",
    compile: "packages/js-engine/src/native/script-compile.ts",
    indirectEval: true,
    directEval: true,
  } as const;
  const batch = native.prepareNativeBatch(
    [
      {
        scripts: prepared.harness,
        modules: prepared.entries,
        asynchronous: false,
      },
    ],
    true,
    true,
    false,
    false,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    false,
    false,
    evaluation,
    true,
  );
  const host = batch.find((module) => module.id === "test262-case-0-host");
  assert.ok(host);
  const runtimeImport = host.module.imports.find(
    (declaration) => declaration.specifier === "runtime",
  );
  assert.equal(runtimeImport?.bindings[0]?.imported, "runNativeModuleTest");
  assert.equal(
    host.module.imports.filter((declaration) =>
      declaration.bindings.some((binding) => binding.imported === "create"),
    ).length,
    1,
  );
  assert.equal(
    batch[0]?.dependencies.get("modules"),
    "packages/js-runtime/src/modules/index.ts",
  );
});
test("module factory sharing preserves file identity for identical source", () => {
  const script = scripts("42;")[0]!;
  const entry = { ...script, module: { ...script.module, statements: [] } };
  const evaluation = {
    evaluation: "packages/js-engine/src/script-evaluation.ts",
    compile: "packages/js-engine/src/native/script-compile.ts",
    indirectEval: true,
    directEval: true,
  } as const;
  const batch = native.prepareNativeBatch(
    [
      {
        scripts: [],
        modules: [{ name: "a.js", module: entry }],
        asynchronous: false,
      },
      {
        scripts: [],
        modules: [{ name: "b.js", module: entry }],
        asynchronous: false,
      },
    ],
    true,
    true,
    false,
    false,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    false,
    false,
    evaluation,
    true,
  );
  assert.equal(
    batch.filter((module) => module.id.startsWith("test262-shared-script-"))
      .length,
    2,
  );
});

test("native fixture verdicts survive batch remapping and are called lazily by the loader", async () => {
  const { createHash } = await import("node:crypto");
  const source = "0++;",
    sha256 = createHash("sha256").update(source).digest("hex");
  const p = native.prepareNativeModuleProgram(
    {
      source: 'import "./dep.js";',
      goal: "module",
      harness: [],
      asynchronous: false,
      canSuspend: true,
    },
    [],
    "root.js",
    () => ({
      root: "root.js",
      absent: [],
      siblings: [],
      nodes: [
        { name: "dep.js", kind: "javascript", source, sha256, parsed: false },
      ],
    }),
  );
  assert.ok(p.ok, JSON.stringify(p));
  const evaluation = {
    evaluation: "eval",
    compile: "compile",
    indirectEval: true,
    directEval: true,
  } as const;
  const batch = native.prepareNativeBatch(
    [{ scripts: [], modules: p.entries, asynchronous: false }],
    true,
    true,
    false,
    false,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    false,
    false,
    evaluation,
    true,
  );
  const host = batch.find((module) => module.id === "test262-case-0-host")!;
  assert.ok(
    host.module.imports.some((declaration) =>
      declaration.bindings.some(
        (binding) => binding.imported === "run" && binding.local === "verdict1",
      ),
    ),
  );
  const run = host.module.statements.find(
    (statement) => statement.kind === "function" && statement.name === "run",
  );
  assert.ok(run && run.kind === "function" && run.body.kind === "block");
  const returned = run.body.statements[0];
  assert.ok(
    returned?.kind === "return" && returned.expression?.kind === "call",
  );
  assert.equal(returned.expression.arguments.length, 6);
  assert.deepEqual(returned.expression.arguments[5]?.kind, "array");
});

test("module case hosts without verdict entries retain the v10 bytes", async () => {
  const { createHash } = await import("node:crypto"),
    source = "export const value=42;";
  const p = native.prepareNativeModuleProgram(
    {
      source,
      goal: "module",
      harness: [],
      asynchronous: false,
      canSuspend: true,
    },
    [],
    "root.js",
    () => ({ root: "root.js", nodes: [], absent: [], siblings: [] }),
  );
  assert.ok(p.ok);
  const evaluation = {
    evaluation: "eval",
    compile: "compile",
    indirectEval: true,
    directEval: true,
  } as const;
  const batch = native.prepareNativeBatch(
    [{ scripts: p.harness, modules: p.entries, asynchronous: false }],
    true,
    true,
    false,
    false,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    false,
    false,
    evaluation,
    true,
  );
  const host = batch.find((module) => module.id === "test262-case-0-host")!;
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify([host.module, [...host.dependencies]]))
      .digest("hex"),
    "09f85ccda3fd4598a33328b687be87a73c029c60c4f0fef01b3bbaf1c8a71553",
  );
});

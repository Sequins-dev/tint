import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nativeExitOutcome,
  prepareNativeBatch,
  prepareNativeScripts,
} from "./test262-native.ts";

test("native harness failures retain their error type without becoming runtime failures", () => {
  for (const [offset, type] of [
    "TypeError",
    "ReferenceError",
    "SyntaxError",
    "RangeError",
    "EvalError",
    "URIError",
  ].entries()) {
    assert.deepEqual(nativeExitOutcome(21 + offset), {
      kind: "error",
      phase: "harness",
      type,
      message: "native harness threw",
    });
  }
});
import { executionPlan } from "./test262-execution.ts";
const metadata = { flags: [], features: [], includes: [] };
test("native outcomes distinguish completion, unsupported and exception phases", () => {
  assert.deepEqual(nativeExitOutcome(42), { kind: "completed" });
  assert.equal(nativeExitOutcome(10).kind, "unsupported");
  assert.deepEqual(nativeExitOutcome(31), {
    kind: "error",
    phase: "runtime",
    type: "TypeError",
    message: "native Script threw",
  });
  assert.deepEqual(nativeExitOutcome(20), {
    kind: "error",
    phase: "harness",
    type: "",
    message: "native harness threw",
  });
  assert.equal(nativeExitOutcome(99).kind, "crash");
});
test("native preparation retains separate Script entries and rejects unavailable goals", () => {
  const plan = executionPlan("assert(true);", "strict", metadata);
  const harness = [
    { filename: "assert.js", source: "function assert(x){if(!x)throw 1;}" },
    { filename: "sta.js", source: "var shared=42;" },
  ];
  const prepared = prepareNativeScripts(plan, "strict", harness);
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.equal(prepared.modules.length, 3);
  assert.equal(prepareNativeScripts(plan, "sloppy", harness).ok, true);
  assert.equal(
    prepareNativeScripts({ ...plan, asynchronous: true }, "strict", harness).ok,
    true,
  );
  assert.equal(
    prepareNativeScripts({ ...plan, goal: "module" }, "module", harness).ok,
    false,
  );
});
test("parser limitations never masquerade as successful negative conformance", () => {
  const prepared = prepareNativeScripts(
    executionPlan("const = ;", "strict", {
      ...metadata,
      negative: { phase: "parse", type: "SyntaxError" },
    }),
    "strict",
    [],
  );
  assert.ok(!prepared.ok);
  assert.equal(prepared.outcome.kind, "unsupported");
});

test("native debugger protocol requires verified normal termination", async () => {
  const { nativeDebuggerOutcome } = await import("./test262-native-process.ts");
  assert.deepEqual(nativeDebuggerOutcome({ state: "exited", exitStatus: 42 }), {
    kind: "completed",
  });
  assert.equal(
    nativeDebuggerOutcome({ state: "stopped", exitStatus: 42 }).kind,
    "crash",
  );
  assert.equal(
    nativeDebuggerOutcome({ state: "exited", exitStatus: "42" }).kind,
    "crash",
  );
  assert.equal(nativeDebuggerOutcome(null).kind, "crash");
});

test("native preparation accepts synchronous sloppy and raw Script goals", () => {
  for (const variant of ["sloppy", "raw"] as const) {
    const plan = executionPlan("function f(a,a){return a;}f(1,42);", variant, {
      ...metadata,
      flags: variant === "raw" ? ["raw"] : [],
    });
    const harness = plan.harness.map((filename) => ({
      filename,
      source: "function assert(x){if(!x)throw 1;}",
    }));
    const prepared = prepareNativeScripts(plan, variant, harness);
    assert.ok(prepared.ok, JSON.stringify(prepared));
  }
});

test("native async exit outcomes preserve completion failures", () => {
  assert.deepEqual(nativeExitOutcome(11), { kind: "timeout" });
  assert.deepEqual(nativeExitOutcome(12), {
    kind: "error",
    phase: "runtime",
    type: "Test262Error",
    message: "$DONE called more than once",
  });
  assert.deepEqual(nativeExitOutcome(53), {
    kind: "error",
    phase: "runtime",
    type: "SyntaxError",
    message: "native $DONE reported failure",
  });
});

test("native AggregateError outcomes retain their constructor", () => {
  assert.deepEqual(nativeExitOutcome(37), {
    kind: "error",
    phase: "runtime",
    type: "AggregateError",
    message: "native Script threw",
  });
  assert.deepEqual(nativeExitOutcome(58), {
    kind: "error",
    phase: "runtime",
    type: "AggregateError",
    message: "native $DONE reported failure",
  });
});

test("native parser rejection has a distinct parse-phase exit code", () => {
  assert.deepEqual(nativeExitOutcome(40), {
    kind: "error",
    phase: "parse",
    type: "SyntaxError",
    message: "native parser rejected source",
  });
  assert.equal(nativeExitOutcome(42).kind, "completed");
});

test("native debugger protocol requires a confirmed initial stop and a valid inferior PID", async () => {
  const { nativeDebuggerInitialState } =
    await import("./test262-native-process.ts");
  assert.equal(
    nativeDebuggerInitialState({ state: "stopped", pid: 123 }),
    true,
  );
  for (const value of [
    undefined,
    null,
    {},
    { state: "running", pid: 123 },
    { state: "exited", pid: 123 },
    { state: "stopped", pid: 0 },
    { state: "stopped", pid: -1 },
    { state: "stopped", pid: "123" },
    { state: "stopped", pid: Infinity },
  ])
    assert.equal(nativeDebuggerInitialState(value), false);
});

test("debugger launch experiments are explicit and reject invalid platform modes", async () => {
  const { selectNativeDebuggerLaunch } =
    await import("./test262-native-process.ts");
  assert.equal(
    selectNativeDebuggerLaunch("darwin", undefined),
    "debugserver-direct",
  );
  assert.equal(selectNativeDebuggerLaunch("linux", undefined), "lldb-local");
  assert.equal(
    selectNativeDebuggerLaunch("darwin", "lldb-local"),
    "lldb-local",
  );
  assert.equal(
    selectNativeDebuggerLaunch("darwin", "debugserver-direct"),
    "debugserver-direct",
  );
  assert.throws(() =>
    selectNativeDebuggerLaunch("linux", "debugserver-direct"),
  );
  assert.equal(
    selectNativeDebuggerLaunch("darwin", "debugserver-connected"),
    "debugserver-connected",
  );
  assert.throws(() =>
    selectNativeDebuggerLaunch("linux", "debugserver-connected"),
  );
  assert.throws(() => selectNativeDebuggerLaunch("darwin", "unknown"));
});

test("frozen native hosts omit optional disposal imports when their source graph predates the intrinsic", () => {
  const plan = executionPlan("42;", "raw", {
    flags: ["raw"],
    features: [],
    includes: [],
  });
  const prepared = prepareNativeScripts(plan, "raw", []);
  assert.ok(prepared.ok);
  for (const [available, asyncAvailable] of [
    [false, false],
    [true, false],
    [true, true],
  ] as const) {
    const modules = prepareNativeBatch(
      [{ scripts: prepared.modules, asynchronous: false }],
      available,
      asyncAvailable,
    );
    const host = modules.find((module) => module.id === "test262-runtime");
    assert.ok(host);
    const imports = host.module.imports.flatMap((declaration) =>
      declaration.bindings.map((binding) => binding.imported),
    );
    assert.equal(
      imports.includes("installDisposableStackIntrinsics"),
      available,
    );
    assert.equal(
      imports.includes("installAsyncDisposableStackIntrinsics"),
      asyncAvailable,
    );
  }
});

test("native batches share one runtime while retaining separate ordered Script entry lists", () => {
  const plan = executionPlan("globalThis.value=42;", "raw", {
    flags: ["raw"],
    features: [],
    includes: [],
  });
  const prepared = prepareNativeScripts(plan, "raw", []);
  assert.ok(prepared.ok);
  const modules = prepareNativeBatch([
    { scripts: prepared.modules, asynchronous: false },
    { scripts: prepared.modules, asynchronous: true },
  ]);
  const runtimes = modules.filter((m) => m.id === "test262-runtime");
  assert.equal(runtimes.length, 1);
  const runtime = runtimes[0];
  assert.ok(runtime);
  const entry = runtime.module.statements.find(
    (s) => s.kind === "function" && s.name === "runNativeScripts",
  );
  assert.ok(entry);
  const hosts = modules.filter((m) => /^test262-case-\d+-host$/.test(m.id));
  assert.equal(hosts.length, 2);
  for (const host of hosts) {
    assert.ok([...host.dependencies.values()].includes(runtime.id));
    assert.equal(
      host.module.statements.filter((s) => s.kind === "function").length,
      1,
    );
  }
});

test("native Test262Error outcomes preserve intentional runtime negatives", () => {
  for (const [code, phase, message] of [
    [28, "harness", "native harness threw"],
    [38, "runtime", "native Script threw"],
  ] as const) {
    assert.deepEqual(nativeExitOutcome(code), {
      kind: "error",
      phase,
      type: "Test262Error",
      message,
    });
  }
});

test("shared backing host imports require an explicit enabled public capability", () => {
  const prepared = prepareNativeScripts(
    executionPlan("42;", "raw", { flags: ["raw"], features: [], includes: [] }),
    "raw",
    [],
  );
  assert.ok(prepared.ok);
  for (const enabled of [false, true]) {
    const modules = prepareNativeBatch(
      [{ scripts: prepared.modules, asynchronous: false }],
      true,
      true,
      enabled,
    );
    const host = modules.find((module) => module.id === "test262-runtime")!;
    const names = host.module.imports.flatMap((declaration) =>
      declaration.bindings.map((binding) => binding.imported),
    );
    assert.equal(names.includes("installSharedArrayBufferIntrinsics"), enabled);
    assert.equal(names.includes("createNativeSharedBlockService"), enabled);
    assert.equal(host.dependencies.has("shared-service"), enabled);
  }
});

test("Atomics query host installation requires its captured public capability", () => {
  const prepared = prepareNativeScripts(
    executionPlan("42;", "raw", { flags: ["raw"], features: [], includes: [] }),
    "raw",
    [],
  );
  assert.ok(prepared.ok);
  for (const enabled of [false, true]) {
    const modules = prepareNativeBatch(
      [{ scripts: prepared.modules, asynchronous: false }],
      true,
      true,
      true,
      enabled,
    );
    const runtime = modules.find((module) => module.id === "test262-runtime")!;
    const names = runtime.module.imports.flatMap((declaration) =>
      declaration.bindings.map((binding) => binding.imported),
    );
    assert.equal(names.includes("installAtomicsIntrinsics"), enabled);
  }
});

test("native pause hint uses an explicit captured provider role", () => {
  const prepared = prepareNativeScripts(
    executionPlan("42;", "raw", { flags: ["raw"], features: [], includes: [] }),
    "raw",
    [],
  );
  assert.ok(prepared.ok);
  const modules = prepareNativeBatch(
    [{ scripts: prepared.modules, asynchronous: false }],
    true,
    true,
    true,
    true,
    "target/spin.ts",
  );
  const runtime = modules.find((module) => module.id === "test262-runtime")!;
  assert.equal(runtime.dependencies.get("spin-hint"), "target/spin.ts");
  assert.ok(
    runtime.module.imports.some((declaration) =>
      declaration.bindings.some((binding) => binding.imported === "cpuPause"),
    ),
  );
});

test("atomic backing requires an explicit captured host capability", () => {
  const prepared = prepareNativeScripts(
    executionPlan("42;", "raw", { flags: ["raw"], features: [], includes: [] }),
    "raw",
    [],
  );
  assert.ok(prepared.ok);
  for (const enabled of [false, true]) {
    const modules = prepareNativeBatch(
      [{ scripts: prepared.modules, asynchronous: false }],
      true,
      true,
      true,
      true,
      undefined,
      enabled,
    );
    const runtime = modules.find((module) => module.id === "test262-runtime")!;
    const names = runtime.module.imports.flatMap((declaration) =>
      declaration.bindings.map((binding) => binding.imported),
    );
    assert.equal(names.includes("nativeSharedAtomicMemoryHost"), enabled);
  }
});

test("native batch cases retain independent agent suspension policies", () => {
  const plan = executionPlan("42;", "raw", {
    flags: ["raw"],
    features: [],
    includes: [],
  });
  const prepared = prepareNativeScripts(plan, "raw", []);
  assert.ok(prepared.ok);
  const modules = prepareNativeBatch(
    [true, false].map((canSuspend) => ({
      scripts: prepared.modules,
      asynchronous: false,
      canSuspend,
    })),
  );
  for (const [index, allowed] of [true, false].entries()) {
    const host = modules.find(
      (module) => module.id === `test262-case-${index}-host`,
    )!;
    const fn = host.module.statements.find(
      (statement) => statement.kind === "function",
    );
    assert.ok(fn?.kind === "function");
    assert.ok(fn.body.kind === "block");
    const statement = fn.body.statements[0];
    assert.ok(
      statement?.kind === "return" && statement.expression?.kind === "call",
    );
    const policy = statement.expression.arguments[2];
    assert.ok(policy?.kind === "boolean");
    assert.equal(policy.value, allowed);
  }
});

test("native engine publication resolves its explicit public storage contract", () => {
  const prepared = prepareNativeScripts(
    executionPlan("42;", "raw", { flags: ["raw"], features: [], includes: [] }),
    "raw",
    [],
  );
  assert.ok(prepared.ok);
  const runtime = prepareNativeBatch([
    { scripts: prepared.modules, asynchronous: false },
  ]).find((module) => module.id === "test262-runtime");
  assert.ok(runtime);
  const storage = runtime.module.imports.find(
    (declaration) =>
      declaration.specifier === "@tint/js-engine/native/code-storage",
  );
  assert.ok(
    storage,
    "engine storage must be a production module rather than generated implementation text",
  );
  assert.ok(
    storage.bindings.some(
      (binding) => binding.imported === "createEngineCodeStorage",
    ),
  );
  assert.equal(
    runtime.dependencies.get(storage.specifier),
    "packages/js-engine/src/native/code-storage.ts",
  );
});

test("an unused captured engine entry is available to the generated host without a package grant", async () => {
  const { workspaceSources } = await import("./workspace-sources.ts");
  const { createNativeBatchBuilder } = await import("./test262-native.ts");
  const snapshot = workspaceSources();
  assert.equal(
    snapshot.mappings.some(
      (mapping) => mapping.specifier === "@tint/js-engine/native/code-storage",
    ),
    false,
  );
  assert.doesNotThrow(() => createNativeBatchBuilder(snapshot));
});

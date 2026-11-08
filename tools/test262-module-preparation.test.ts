import assert from "node:assert/strict";
import test from "node:test";
import * as native from "./test262-native.ts";
import type { ExecutionPlan } from "./test262-execution.ts";
import type { ModuleGraph } from "./test262-module-graph.ts";
const plan = (source: string): ExecutionPlan => ({
  source,
  goal: "module",
  harness: [],
  asynchronous: false,
  canSuspend: true,
});

test("resource preparation keeps JavaScript and text identities separate for a self import", () => {
  const source = 'import value from "./root.js" with {type:"text"};';
  const result = native.prepareNativeModuleProgram(
    plan(source),
    [],
    "root.js",
    () => ({
      root: "root.js",
      absent: [],
      siblings: ["root.js"],
      nodes: [
        {
          name: "root.js",
          kind: "javascript",
          source,
          sha256: "hash",
          parsed: true,
          bytes: new TextEncoder().encode(source),
        },
      ],
    }),
    true,
    true,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["root.js", "\0text\0root.js", "\0bytes\0root.js"],
  );
});
const graph = (source: string): ModuleGraph => ({
  root: "root.js",
  absent: [],
  siblings: ["root.js", "dep.js"],
  nodes: [
    {
      name: "dep.js",
      kind: "javascript",
      source: "export const value=42;",
      sha256: "dep-hash",
      parsed: true,
    },
    {
      name: "root.js",
      kind: "javascript",
      source,
      sha256: "root-hash",
      parsed: true,
    },
  ],
});
test("module preparation lowers the root once and preserves named fixture identities", () => {
  const source =
    'import {value} from "./dep.js";import "./root.js";export {value};';
  const result = native.prepareNativeModuleProgram(
    plan(source),
    [],
    "root.js",
    () => graph(source),
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["root.js", "dep.js"],
  );
  assert.deepEqual(result.fixtures, [{ name: "dep.js", sha256: "dep-hash" }]);
  assert.equal(result.harness.length, 0);
  for (const entry of result.entries)
    assert.equal(
      entry.module.dependencies.get("@tint/js-runtime/modules"),
      "packages/js-runtime/src/modules/index.ts",
    );
});
test("module preparation screens unsupported attributes before discovery", () => {
  for (const source of ['import data from "./data.png" with {type:"bytes"};']) {
    let calls = 0;
    const result = native.prepareNativeModuleProgram(
      plan(source),
      [],
      "root.js",
      () => {
        calls++;
        throw Error("discovery must not run");
      },
    );
    assert.ok(
      !result.ok && result.outcome.kind === "unsupported",
      JSON.stringify(result),
    );
    assert.equal(calls, 0);
  }
});
test("module preparation keeps JSON and import attributes unsupported", () => {
  for (const node of [
    {
      name: "dep.json",
      kind: "json" as const,
      source: "{}",
      sha256: "hash",
      parsed: false,
    },
    {
      name: "dep.js",
      kind: "javascript" as const,
      source: 'import "./x" with {type:"json"};',
      sha256: "hash",
      parsed: true,
    },
  ]) {
    const result = native.prepareNativeModuleProgram(
      plan('import "./dep.js";'),
      [],
      "root.js",
      () => ({ root: "root.js", absent: [], siblings: [], nodes: [node] }),
    );
    assert.ok(
      !result.ok && result.outcome.kind === "unsupported",
      JSON.stringify(result),
    );
  }
  assert.throws(
    () =>
      native.prepareNativeModuleProgram(
        plan("export const x=1;"),
        [],
        "root.js",
        () => {
          throw Error("discovery invariant");
        },
      ),
    /discovery invariant/,
  );
});
test("module harnesses use the same Script lowering and validate plan inputs", () => {
  const source = "export const value=42;",
    input = { filename: "assert.js", source: "var marker=1;" };
  const modulePlan = { ...plan(source), harness: [input.filename] };
  const result = native.prepareNativeModuleProgram(
    modulePlan,
    [input],
    "root.js",
    () => ({ root: "root.js", absent: [], siblings: [], nodes: [] }),
  );
  assert.ok(result.ok, JSON.stringify(result));
  const scripts = native.prepareNativeScripts(
    { ...modulePlan, source: "", goal: "script" },
    "sloppy",
    [input],
  );
  assert.ok(scripts.ok);
  assert.deepEqual(result.harness, [scripts.modules[0]]);
  const mismatch = native.prepareNativeModuleProgram(
    modulePlan,
    [],
    "root.js",
    () => {
      throw Error("must not discover");
    },
  );
  assert.ok(!mismatch.ok && mismatch.outcome.kind === "unsupported");
});

test("module preparation discovers unchanged cyclic sibling fixtures and hashes their source", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { createHash } = await import("node:crypto");
  const directory = mkdtempSync(join(tmpdir(), "tint-module-preparation-"));
  const source = 'import "./dep.js";import "./root.js";export const root=42;';
  const fixture = 'import "./root.js";export const dep=1;';
  try {
    writeFileSync(join(directory, "root.js"), source);
    writeFileSync(join(directory, "dep.js"), fixture);
    const result = native.prepareNativeModuleProgram(
      plan(source),
      [],
      join(directory, "root.js"),
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(
      result.entries.map((entry) => entry.name),
      ["root.js", "dep.js"],
    );
    assert.deepEqual(result.fixtures, [
      {
        name: "dep.js",
        sha256: createHash("sha256").update(fixture).digest("hex"),
      },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("module preparation rejects requests outside the closed graph with a precise unsupported reason", () => {
  for (const specifier of ["./missing.js", "./sub/x.js"]) {
    const source = "import " + JSON.stringify(specifier) + ";";
    const result = native.prepareNativeModuleProgram(
      plan(source),
      [],
      "root.js",
      () => ({ root: "root.js", nodes: [], absent: [], siblings: [] }),
    );
    assert.deepEqual(result, {
      ok: false,
      outcome: {
        kind: "unsupported",
        reason:
          "module request outside the discovered fixture graph: " + specifier,
      },
    });
  }
  const result = native.prepareNativeModuleProgram(
    plan('import "./dep.js";'),
    [],
    "root.js",
    () => ({
      root: "root.js",
      absent: [],
      siblings: ["dep.js"],
      nodes: [
        {
          name: "dep.js",
          source: 'import "./gone.js";',
          sha256: "hash",
          kind: "javascript",
          parsed: true,
        },
      ],
    }),
  );
  assert.deepEqual(result, {
    ok: false,
    outcome: {
      kind: "unsupported",
      reason: "module request outside the discovered fixture graph: ./gone.js",
    },
    fixtures: [{ name: "dep.js", sha256: "hash" }],
  });
});

test("a fixture byte mismatch is unsupported and retains its discovered identity", () => {
  const source = 'import "./dep.js";';
  const result = native.prepareNativeModuleProgram(
    plan(source),
    [],
    "root.js",
    () => ({
      root: "root.js",
      absent: [],
      siblings: ["dep.js"],
      nodes: [
        {
          name: "dep.js",
          source: "export {",
          sha256: "invalid-fixture-hash",
          kind: "javascript",
          parsed: false,
        },
      ],
    }),
  );
  assert.ok(!result.ok);
  assert.deepEqual(result.fixtures, [
    { name: "dep.js", sha256: "invalid-fixture-hash" },
  ]);
  assert.equal(result.outcome.kind, "unsupported");
  if (result.outcome.kind === "unsupported")
    assert.equal(
      result.outcome.reason,
      "fixture bytes differ from discovery hash",
    );
});

test("parse and early negatives always route to native syntax validation", () => {
  const metadata = { flags: [], features: [], includes: [] };
  for (const phase of ["parse", "early"] as const)
    assert.equal(
      native.nativeVariantRoute(
        { ...metadata, negative: { phase, type: "SyntaxError" } },
        "module",
        true,
      ),
      "syntax",
    );
  for (const phase of ["resolution", "runtime"] as const)
    assert.equal(
      native.nativeVariantRoute(
        { ...metadata, negative: { phase, type: "SyntaxError" } },
        "module",
        true,
      ),
      "module",
    );
  assert.equal(native.nativeVariantRoute(metadata, "module", true), "module");
  assert.equal(native.nativeVariantRoute(metadata, "module", false), "script");
  assert.equal(native.nativeVariantRoute(metadata, "strict", true), "script");
  assert.deepEqual(
    native.prepareNativeScripts(plan("export const x=1;"), "module", []),
    {
      ok: false,
      outcome: {
        kind: "unsupported",
        reason: "native module execution is not implemented",
      },
    },
  );
});

test("unparsed JavaScript fixtures become native verdict entries without a bootstrap verdict", async () => {
  const { createHash } = await import("node:crypto");
  for (const source of ["0++;", "export {"]) {
    const sha256 = createHash("sha256").update(source).digest("hex");
    const result = native.prepareNativeModuleProgram(
      plan('import "./dep.js";'),
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
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(
      result.entries.map((entry) => entry.name),
      ["root.js", "dep.js"],
    );
    assert.equal(result.entries[1]?.verdict, true);
    assert.equal(
      result.entries[1]?.module.id,
      "test262-fixture-verdict-dep.js",
    );
    assert.deepEqual(result.fixtures, [{ name: "dep.js", sha256 }]);
    const proof = result.entries[1]!.module;
    assert.ok(
      proof.module.statements.some(
        (statement) =>
          statement.kind === "function" && statement.name === "run",
      ),
    );
    assert.equal(
      proof.module.statements.some(
        (statement) =>
          statement.kind === "function" && statement.name === "create",
      ),
      false,
    );
  }
});

test("parsed fixtures with binding early errors require a native syntax verdict", async () => {
  const { createHash } = await import("node:crypto");
  const source = "var smoosh; function smoosh() {}";
  const sha256 = createHash("sha256").update(source).digest("hex");
  const discover = () => ({
    root: "root.js",
    absent: [],
    siblings: ["dep.js"],
    nodes: [
      {
        name: "dep.js",
        kind: "javascript" as const,
        source,
        sha256,
        parsed: true,
      },
    ],
  });
  for (const scriptRoot of [false, true]) {
    const result = scriptRoot
      ? native.prepareNativeScriptProgram(
          { ...plan('import("./dep.js");'), goal: "script" },
          "sloppy",
          [],
          "root.js",
          discover,
        )
      : native.prepareNativeModuleProgram(
          plan('import "./dep.js";'),
          [],
          "root.js",
          discover,
        );
    assert.ok(result.ok, JSON.stringify(result));
    const entries = "entries" in result ? result.entries : result.root!.entries;
    const entry = entries.find((item) => item.name === "dep.js");
    assert.equal(entry?.verdict, true);
    assert.equal(entry?.module.id, "test262-fixture-verdict-dep.js");
  }
});

test("native fixture proofs retain executable class decorators", () => {
  for (const source of ["@decorator class C {}"]) {
    const result = native.prepareNativeModuleProgram(
      plan('import "./dep.js";'),
      [],
      "root.js",
      () => ({
        root: "root.js",
        absent: [],
        siblings: [],
        nodes: [
          {
            name: "dep.js",
            kind: "javascript",
            source,
            sha256: "unused-for-unsupported",
            parsed: true,
          },
        ],
      }),
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(
      result.entries.some(
        (entry) =>
          entry.name === "dep.js" &&
          entry.module.module.imports.some((declaration) =>
            declaration.bindings.some(
              (binding) => binding.imported === "decorateClass",
            ),
          ),
      ),
    );
  }
});

test("module preparation accepts async roots and fixtures through the continuation factory", () => {
  const source = 'import "./dep.js"; export const value=await 1;';
  const result = native.prepareNativeModuleProgram(
    plan(source),
    [],
    "root.js",
    () => ({
      root: "root.js",
      absent: [],
      siblings: ["dep.js"],
      nodes: [
        {
          name: "dep.js",
          kind: "javascript",
          source: "await 0;",
          sha256: "async-fixture",
          parsed: true,
        },
      ],
    }),
  );
  assert.ok(result.ok);
  assert.equal(result.entries.length, 2);
  for (const entry of result.entries)
    assert.ok(
      entry.module.module.imports.some((declaration) =>
        declaration.bindings.some(
          (binding) => binding.imported === "createLoweredAsyncSourceModule",
        ),
      ),
    );
  assert.deepEqual(result.fixtures, [
    { name: "dep.js", sha256: "async-fixture" },
  ]);
});

test("generated syntax limits stay unsupported per module and preserve fixture hashes", () => {
  const limited = "await 0;".repeat(100);
  const root = native.prepareNativeModuleProgram(
    plan(limited),
    [],
    "root.js",
    () => graph(limited),
  );
  assert.equal(root.ok, false);
  if (!root.ok) {
    assert.equal(root.outcome.kind, "unsupported");
    assert.match(
      JSON.stringify(root.outcome),
      /LIMIT.*generated module syntax/,
    );
  }
  const source = 'import "./dep.js"; export const value=42;';
  const fixture = native.prepareNativeModuleProgram(
    plan(source),
    [],
    "root.js",
    () => ({
      ...graph(source),
      nodes: [
        {
          name: "dep.js",
          kind: "javascript",
          source: limited,
          sha256: "limited-fixture",
          parsed: true,
        },
      ],
    }),
  );
  assert.equal(fixture.ok, false);
  if (!fixture.ok) {
    assert.equal(fixture.outcome.kind, "unsupported");
    assert.match(JSON.stringify(fixture.outcome), /dep.js.*LIMIT/);
    assert.deepEqual(fixture.fixtures, [
      { name: "dep.js", sha256: "limited-fixture" },
    ]);
  }
  assert.ok(
    native.prepareNativeModuleProgram(plan(source), [], "root.js", () =>
      graph(source),
    ).ok,
  );
});

test("module direct eval prepares existing sites in both root and hoisted fixture functions", () => {
  const source = 'import {read} from "./dep.js";eval("read()");';
  const result = native.prepareNativeModuleProgram(
    plan(source),
    [],
    "root.js",
    () => ({
      ...graph(source),
      nodes: [
        {
          name: "dep.js",
          kind: "javascript",
          source: 'export function read(){return eval("40+2");}',
          sha256: "eval-fixture",
          parsed: true,
        },
      ],
    }),
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.fixtures, [
    { name: "dep.js", sha256: "eval-fixture" },
  ]);
});

test("JSON-enabled module preparation emits a native parser factory and retains fixture identity", () => {
  const source =
    'import value from "./dep.json" with {type:"json"};export default value;';
  const result = native.prepareNativeModuleProgram(
    plan(source),
    [],
    "root.js",
    () => ({
      root: "root.js",
      absent: [],
      siblings: ["root.js", "dep.json"],
      nodes: [
        {
          name: "root.js",
          kind: "javascript",
          source,
          parsed: true,
          sha256: "root-hash",
        },
        {
          name: "dep.json",
          kind: "json",
          source: '{"x":42}',
          parsed: false,
          sha256: "json-hash",
        },
      ],
    }),
    true,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.fixtures, [
    { name: "dep.json", sha256: "json-hash" },
  ]);
  const entry = result.entries[1];
  assert.equal(entry?.json, true);
  assert.equal(entry?.verdict, undefined);
  assert.ok(entry?.module.module.statements.length);
  assert.equal(
    entry?.module.dependencies.get("@tint/js-runtime/modules"),
    "packages/js-runtime/src/modules/index.ts",
  );
});

test("JSON-enabled preparation preserves invalid JSON for a native load-time verdict", () => {
  const source = 'import "./dep.json" with {type:"json"};';
  for (const text of ["[1,]", "undefined"]) {
    const result = native.prepareNativeModuleProgram(
      plan(source),
      [],
      "root.js",
      () => ({
        root: "root.js",
        absent: [],
        siblings: [],
        nodes: [
          {
            name: "dep.json",
            kind: "json",
            source: text,
            parsed: false,
            sha256: "invalid-hash",
          },
        ],
      }),
      true,
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.entries[1]?.json, true);
  }
});

test("JSON support screens binary and text proposals before fixture discovery", () => {
  for (const type of ["text", "bytes"]) {
    let discovered = false;
    const source = 'import value from "./file.png" with {type:"' + type + '"};';
    const result = native.prepareNativeModuleProgram(
      plan(source),
      [],
      "root.js",
      () => {
        discovered = true;
        throw Error("binary fixture must not be decoded");
      },
      true,
    );
    assert.equal(discovered, false);
    assert.ok(!result.ok && result.outcome.kind === "unsupported");
  }
});

test("source-phase host placeholders survive preparation for resolution by the module loader", () => {
  const source = 'import source value from "<module source>"; export {value};';
  const result = native.prepareNativeModuleProgram(
    plan(source),
    [],
    "root.js",
    () => ({ root: "root.js", nodes: [], siblings: ["root.js"], absent: [] }),
    true,
  );
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) assert.equal(result.entries.length, 1);
});

test("runtime-compiled source imports retain a Script-root loader", () => {
  const source = "eval(\"import.source('<module source>')\");";
  const result = native.prepareNativeScriptProgram(
    {
      source,
      goal: "script",
      harness: [],
      asynchronous: false,
      canSuspend: true,
    },
    "sloppy",
    [],
    "root.js",
    () => ({ root: "root.js", nodes: [], siblings: [], absent: [] }),
    true,
    true,
  );
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) assert.ok(result.root);
});

test("a discovered absent static dependency reaches the native host and remains in input identity", () => {
  const source = 'import defer * as ns from "./missing.js";';
  const result = native.prepareNativeModuleProgram(
    plan(source),
    [],
    "root.js",
    () => ({
      root: "root.js",
      nodes: [],
      siblings: ["root.js"],
      absent: ["missing.js"],
    }),
    true,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.absent, ["missing.js"]);
});

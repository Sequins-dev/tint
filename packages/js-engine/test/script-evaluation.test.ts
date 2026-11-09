import assert from "node:assert/strict";
import test from "node:test";
import type { Module } from "@tint/typescript/syntax";
import { parseDynamicFunction, rewriteModule } from "@tint/typescript/syntax";
import type {
  ScriptCompletionRecord,
  ScriptPropertyKey,
  ObjectHooks,
  ScriptAgent,
} from "@tint/js-runtime/objects";
import { bindHostRecordViews } from "../../js-runtime/test/ordinary-object-host-record-views.ts";
import type { ScriptEntryFrame } from "../src/native/script-entry.ts";
import type {
  ScriptCompileFailure,
  ScriptEvaluationFault,
  ScriptEvaluationHost,
} from "../src/script-evaluation.ts";
bindHostRecordViews();
const runtime = await import("@tint/js-runtime/objects");
const { createGlobalEnvironment } =
  await import("@tint/js-runtime/environments/global");
const records = await import("@tint/js-runtime/environments/records");
const { emptyUpdate } = await import("@tint/js-runtime/descriptors");
const evaluation = await import("../src/script-evaluation.ts");
const { createScriptEvaluator, createIndirectEvaluator } = evaluation;
function caught(action: () => unknown): unknown {
  let threw = false,
    value: unknown;
  try {
    action();
  } catch (error) {
    threw = true;
    value = error;
  }
  assert.ok(threw, "expected a throw");
  return value;
}
function fixture(
  kind: "script" | "indirect-eval" = "script",
  agent?: ScriptAgent,
  reusable = false,
) {
  const object = runtime.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (callee, receiver, args) => {
      const result = runtime.callObjectValue(callee, receiver, args, object);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const realm = runtime.createErrorRealm(object, hooks, undefined, agent);
  runtime.installErrorIntrinsics(object, realm, hooks);
  runtime.installFunctionIntrinsics(object, realm, hooks);
  const global = createGlobalEnvironment<ScriptPropertyKey, unknown>(
      object,
      object,
      object,
      (name) => name,
      hooks,
    ),
    table = {};
  const modules: Module[] = [],
    frames: ScriptEntryFrame[] = [],
    faults: ScriptEvaluationFault[] = [];
  const state: {
    domain: number;
    stage: ScriptCompileFailure | undefined;
    result: ScriptCompletionRecord | undefined;
    compileAction: (() => void) | undefined;
    invokeAction: ((frame: ScriptEntryFrame) => void) | undefined;
    invokeError: unknown;
    throws: boolean;
  } = {
    domain: 17,
    stage: undefined,
    result: { error: "none", value: 42 },
    compileAction: undefined,
    invokeAction: undefined,
    invokeError: undefined,
    throws: false,
  };
  const host: ScriptEvaluationHost = {
    domain: () => state.domain,
    storage: {
      domain: 17,
      publish: () => assert.fail("evaluator must not publish code"),
    },
    table: () => table,
    compile: (module) => {
      modules.push(module);
      state.compileAction?.();
      if (state.stage !== undefined) return { ok: false, stage: state.stage };
      return reusable
        ? { ok: true, address: 4096, reusable: true }
        : { ok: true, address: 4096 };
    },
    invoke: (address, frame) => {
      assert.equal(address, 4096);
      frames.push(frame);
      state.invokeAction?.(frame);
      if (state.throws) throw state.invokeError;
      return state.result;
    },
    completion: (value) => (value === state.result ? state.result : undefined),
    fault: (reason) => {
      faults.push(reason);
    },
  };
  const indirect =
    kind === "indirect-eval"
      ? createIndirectEvaluator({ realm, global }, host)
      : undefined;
  const evaluate =
    indirect === undefined
      ? createScriptEvaluator({ realm, global }, host)
      : (source: unknown): unknown => {
          assert.ok(typeof source === "string");
          return indirect(source);
        };
  return {
    object,
    hooks,
    realm,
    global,
    table,
    modules,
    frames,
    faults,
    state,
    evaluate,
    host,
  };
}
for (const source of [undefined, 7, {}])
  test(
    "non-string Script input is sticky unsupported: " + String(source),
    () => {
      const f = fixture();
      assert.equal(
        caught(() => f.evaluate(source)),
        undefined,
      );
      assert.equal(f.realm.unsupported, true);
      assert.equal(
        caught(() => f.evaluate("42")),
        undefined,
      );
      assert.equal(f.modules.length, 0);
    },
  );
for (const source of ["var", "let a;let a;", "return 1;", "\ud800"])
  test(
    "real Script grammar errors use the owning SyntaxError realm: " +
      JSON.stringify(source),
    () => {
      const f = fixture();
      const error = caught(() => f.evaluate(source));
      assert.equal(
        runtime.viewObjectValue(error, f.object)?.prototype,
        f.realm.prototypes.get("syntax"),
      );
      assert.equal(f.realm.unsupported, false);
      assert.equal(f.modules.length, 0);
    },
  );
test("parser resource limits are unsupported rather than SyntaxError", () => {
  const f = fixture();
  assert.equal(
    caught(() => f.evaluate("(".repeat(200) + "0" + ")".repeat(200))),
    undefined,
  );
  assert.equal(f.realm.unsupported, true);
  assert.equal(f.modules.length, 0);
});
test("Script source retains raw UTF-16 units without TextEncoder replacement", () => {
  const f = fixture(),
    unit = "\ud800",
    retained = "function f(){return '" + unit + "';}",
    source = retained + "f();";
  assert.equal(f.evaluate(source), 42);
  const strings: string[] = [];
  rewriteModule(f.modules[0]!, {
    expression: (node) => {
      if (node.kind === "string") strings.push(node.value);
      return node;
    },
  });
  assert.ok(strings.includes(unit));
  assert.ok(strings.includes(retained));
  assert.ok(!strings.includes("\ufffd"));
});
for (const stage of [
  "profile",
  "prepare",
  "lower",
  "emit",
  "select",
  "link",
  "budget",
  "publish",
] as const)
  test("compile failure is unsupported before invoke: " + stage, () => {
    const f = fixture();
    f.state.stage = stage;
    assert.equal(
      caught(() => f.evaluate("42")),
      undefined,
    );
    assert.equal(f.realm.unsupported, true);
    assert.equal(f.frames.length, 0);
  });
test("successful evaluations share the environment and table but get fresh Script records", () => {
  const f = fixture();
  assert.equal(f.evaluate("42"), 42);
  assert.equal(f.evaluate("42"), 42);
  assert.equal(f.modules.length, 2);
  assert.equal(f.frames.length, 2);
  const a = f.frames[0]!,
    b = f.frames[1]!;
  assert.notEqual(a.$argument1, b.$argument1);
  for (const frame of f.frames) {
    assert.equal(frame.$argument0, f.global);
    assert.equal(frame.$imports, f.table);
    assert.equal(frame.$argument1.realm, f.realm);
    assert.equal(frame.$argument1.kind, "script");
    assert.equal(frame.$argument1.hostDefined, undefined);
  }
});
test("Script completions preserve result and thrown-value identity", () => {
  const f = fixture();
  f.state.result = { error: "none", value: 7 };
  assert.equal(f.evaluate("7"), 7);
  const marker = {};
  f.state.result = { error: "throw", value: marker };
  assert.equal(
    caught(() => f.evaluate("throw 1")),
    marker,
  );
  assert.equal(f.realm.unsupported, false);
  f.state.result = { error: "unsupported", value: undefined };
  assert.equal(
    caught(() => f.evaluate("42")),
    undefined,
  );
  assert.equal(f.realm.unsupported, true);
});
test("invalid completion views and kinds are host faults", () => {
  for (const result of [undefined, { error: "unexpected", value: undefined }]) {
    const f = fixture();
    f.state.result = result;
    assert.equal(
      caught(() => f.evaluate("42")),
      undefined,
    );
    assert.equal(f.realm.unsupported, true);
    assert.deepEqual(f.faults, [
      result === undefined ? "completion-view" : "completion-kind",
    ]);
  }
});
test("an exception escaping the entry is a host fault rather than a Script throw", () => {
  const f = fixture();
  f.state.throws = true;
  f.state.invokeError = {};
  assert.equal(
    caught(() => f.evaluate("42")),
    undefined,
  );
  assert.equal(f.realm.unsupported, true);
  assert.deepEqual(f.faults, ["invoke-threw"]);
});
test("changed domains reject before parsing and again after compilation", () => {
  const a = fixture();
  a.state.domain = 18;
  assert.equal(
    caught(() => a.evaluate("var")),
    undefined,
  );
  assert.equal(a.modules.length, 0);
  const b = fixture();
  b.state.compileAction = () => {
    b.state.domain = 18;
  };
  assert.equal(
    caught(() => b.evaluate("42")),
    undefined,
  );
  assert.equal(b.modules.length, 1);
  assert.equal(b.frames.length, 0);
});
test("an entry must restore the outer execution context", () => {
  const f = fixture();
  f.state.invokeAction = (frame) => {
    f.realm.agent.activeContext = {
      realm: f.realm,
      scriptOrModule: frame.$argument1,
    };
  };
  assert.equal(
    caught(() => f.evaluate("42")),
    undefined,
  );
  assert.deepEqual(f.faults, ["context-leak"]);
  assert.equal(f.realm.unsupported, true);
});
test("evaluation leaves queued jobs and kept objects to the host checkpoint", () => {
  const f = fixture();
  let jobs = 0;
  f.realm.agent.keptAlive.push(f.object);
  f.state.invokeAction = () =>
    runtime.enqueueScriptJob(
      f.realm.agent,
      () => {
        jobs++;
      },
      undefined,
    );
  assert.equal(f.evaluate("42"), 42);
  assert.equal(jobs, 0);
  assert.equal(f.realm.agent.keptAlive.length, 1);
  runtime.drainScriptJobs(f.realm.agent, () => assert.fail());
  assert.equal(jobs, 1);
});
test("separate evaluators use their own realms and source strictness", () => {
  const a = fixture(),
    b = fixture();
  assert.equal(b.evaluate("with({}){}"), 42);
  assert.equal(a.frames.length, 0);
  assert.equal(b.frames[0]?.$argument1.realm, b.realm);
  const error = caught(() => b.evaluate('"use strict";with({}){}'));
  assert.equal(
    runtime.viewObjectValue(error, b.object)?.prototype,
    b.realm.prototypes.get("syntax"),
  );
  assert.equal(a.realm.unsupported, false);
});

test("compiler invariant exceptions are host faults rather than Script exceptions", () => {
  const f = fixture();
  f.state.compileAction = () => {
    throw new RangeError("compiler invariant");
  };
  assert.equal(
    caught(() => f.evaluate("42")),
    undefined,
  );
  assert.equal(f.realm.unsupported, true);
  assert.deepEqual(f.faults, ["compile-threw"]);
  assert.equal(f.frames.length, 0);
});
test("managed heap exhaustion while compiling is the code budget's resource failure", () => {
  // The embedded compiler runs in the managed heap; exhausting it is a resource
  // limit like the per-entry code budget, not a compiler invariant fault.
  for (const kind of ["script", "indirect-eval"] as const) {
    const budget = fixture(kind);
    budget.state.stage = "budget";
    assert.equal(
      caught(() => budget.evaluate("42")),
      undefined,
    );
    const exhausted = fixture(kind);
    exhausted.state.compileAction = () => {
      throw "MANAGED_HEAP_EXHAUSTED";
    };
    assert.equal(
      caught(() => exhausted.evaluate("42")),
      undefined,
    );
    for (const f of [budget, exhausted]) {
      assert.equal(f.realm.unsupported, true);
      assert.deepEqual(f.faults, []);
      assert.equal(f.frames.length, 0);
    }
  }
});
test("indirect eval empty bodies do not compile, while directives still do", () => {
  const f = fixture("indirect-eval");
  for (const source of ["", " \n\t", "// comment", "/* comment */"])
    assert.equal(f.evaluate(source), undefined);
  assert.equal(f.modules.length, 0);
  assert.equal(f.frames.length, 0);
  assert.equal(f.evaluate('"use strict"'), 42);
  assert.equal(f.modules.length, 1);
});
test("indirect eval selects eval declarations without a Script declaration import", () => {
  const f = fixture("indirect-eval");
  f.evaluate("var v;let local;");
  const imports = f.modules[0]!.imports.flatMap((x) =>
    x.bindings.map((y) => y?.imported),
  );
  assert.ok(imports.includes("instantiateEvalDeclarations"));
  assert.ok(!imports.includes("instantiateGlobalDeclarations"));
  assert.equal(
    (f.frames[0]?.$argument1 as { hostDefined: unknown } | undefined)
      ?.hostDefined,
    undefined,
  );
});
test("cross-realm indirect eval carries the effective record through a real builtin context", () => {
  const a = fixture(),
    b = fixture("indirect-eval", a.realm.agent),
    record = runtime.createScriptRecord(a.realm, undefined);
  let sourceFunction: unknown;
  const jobs: unknown[] = [];
  b.state.invokeAction = (frame) => {
    assert.ok(
      b.realm.agent.activeContext?.realm === b.realm,
      "builtin owns eval realm",
    );
    assert.ok(
      b.realm.agent.activeContext?.scriptOrModule === record,
      "builtin preserves effective identity",
    );
    assert.ok(frame.$argument1.realm === b.realm, "carrier owns eval realm");
    assert.ok(
      frame.$argument1.hostDefined === record,
      "carrier preserves inherited identity",
    );
    assert.ok(frame.$argument1 !== record, "carrier is distinct from identity");
    const created = runtime.createSourceFunction(
      () => b.realm.agent.activeContext?.scriptOrModule,
      false,
      b.realm,
      b.hooks,
    );
    sourceFunction = created;
    runtime.enqueueScriptJob(
      b.realm.agent,
      () => {
        jobs.push(b.realm.agent.activeContext?.scriptOrModule);
      },
      created.internalExecutionContext,
    );
  };
  const fn = runtime.createCallableObject<ScriptPropertyKey, unknown>(
    b.realm.functionPrototype,
    (_receiver, args) => b.evaluate(args[0]),
  );
  runtime.runScriptContext(
    a.realm.agent,
    { realm: a.realm, scriptOrModule: record },
    () => {
      for (let i = 0; i < 2; i++)
        assert.deepEqual(
          runtime.callObjectValue(fn, undefined, ["42"], a.object),
          { error: "none", value: 42 },
        );
    },
  );
  assert.equal(a.realm.agent.activeContext, undefined);
  assert.notEqual(b.frames[0]?.$argument1, b.frames[1]?.$argument1);
  assert.equal(jobs.length, 0);
  const invoked = runtime.callObjectValue(
    sourceFunction,
    undefined,
    [],
    b.object,
  );
  assert.equal(invoked.error, "none");
  assert.ok(
    invoked.value === record,
    "source function retains inherited identity",
  );
  runtime.drainScriptJobs(a.realm.agent, () => assert.fail());
  assert.equal(jobs.length, 2);
  assert.ok(
    jobs.every((value) => value === record),
    "jobs retain inherited identity",
  );
});
test("indirect eval grammar errors belong to its realm without compilation", () => {
  const a = fixture(),
    b = fixture("indirect-eval", a.realm.agent),
    record = runtime.createScriptRecord(a.realm, undefined);
  const fn = runtime.createCallableObject<ScriptPropertyKey, unknown>(
    b.realm.functionPrototype,
    (_receiver, args) => b.evaluate(args[0]),
  );
  for (const source of ["var", "let a;let a;"]) {
    const error = caught(() =>
      runtime.runScriptContext(
        a.realm.agent,
        { realm: a.realm, scriptOrModule: record },
        () => runtime.callObjectValue(fn, undefined, [source], a.object),
      ),
    );
    assert.equal(
      runtime.viewObjectValue(error, b.object)?.prototype,
      b.realm.prototypes.get("syntax"),
    );
    assert.equal(a.realm.unsupported, false);
    assert.equal(b.realm.unsupported, false);
  }
  assert.equal(b.modules.length, 0);
  assert.equal(b.frames.length, 0);
});
for (const stage of [
  "profile",
  "prepare",
  "lower",
  "emit",
  "select",
  "link",
  "budget",
  "publish",
] as const)
  test("indirect eval compilation failure stays unsupported: " + stage, () => {
    const f = fixture("indirect-eval");
    f.state.stage = stage;
    assert.equal(
      caught(() => f.evaluate("42")),
      undefined,
    );
    assert.equal(f.realm.unsupported, true);
    assert.equal(f.frames.length, 0);
  });
test("indirect eval shares fault classification, domain checks and thrown completion identity", () => {
  const f = fixture("indirect-eval"),
    marker = {};
  f.state.result = { error: "throw", value: marker };
  assert.equal(
    caught(() => f.evaluate("throw 1")),
    marker,
  );
  assert.equal(f.realm.unsupported, false);
  const fault = fixture("indirect-eval");
  fault.state.compileAction = () => {
    throw marker;
  };
  assert.equal(
    caught(() => fault.evaluate("42")),
    undefined,
  );
  assert.deepEqual(fault.faults, ["compile-threw"]);
  const domain = fixture("indirect-eval");
  domain.state.compileAction = () => {
    domain.state.domain = 18;
  };
  assert.equal(
    caught(() => domain.evaluate("42")),
    undefined,
  );
  assert.equal(domain.frames.length, 0);
});
test("indirect eval source retains lone UTF-16 surrogates", () => {
  const f = fixture("indirect-eval"),
    source = "function f(){return '\ud800'}";
  assert.equal(f.evaluate(source), 42);
  const strings: string[] = [];
  rewriteModule(f.modules[0]!, {
    expression(node) {
      if (node.kind === "string") strings.push(node.value);
      return node;
    },
  });
  assert.ok(strings.some((s) => s.includes("\ud800")));
});
test("indirect eval shares invalid-completion, invocation and context-leak fault handling", () => {
  for (const mode of ["view", "kind", "invoke", "context"] as const) {
    const f = fixture("indirect-eval");
    if (mode === "view") f.state.result = undefined;
    if (mode === "kind")
      f.state.result = { error: "invalid", value: undefined };
    if (mode === "invoke") f.state.throws = true;
    if (mode === "context")
      f.state.invokeAction = (frame) => {
        f.realm.agent.activeContext = {
          realm: f.realm,
          scriptOrModule: frame.$argument1,
        };
      };
    assert.equal(
      caught(() => f.evaluate("42")),
      undefined,
    );
    assert.equal(f.realm.unsupported, true);
    assert.deepEqual(f.faults, [
      mode === "view"
        ? "completion-view"
        : mode === "kind"
          ? "completion-kind"
          : mode === "invoke"
            ? "invoke-threw"
            : "context-leak",
    ]);
  }
});
test("indirect eval checks domain before syntax and keeps parser limits unsupported", () => {
  const f = fixture("indirect-eval");
  f.state.domain = 18;
  assert.equal(
    caught(() => f.evaluate("var")),
    undefined,
  );
  assert.equal(f.realm.unsupported, true);
  assert.equal(f.modules.length, 0);
  const a = fixture(),
    b = fixture("indirect-eval", a.realm.agent);
  assert.equal(
    caught(() => b.evaluate("(".repeat(200) + "0" + ")".repeat(200))),
    undefined,
  );
  assert.equal(b.realm.unsupported, true);
  assert.equal(a.realm.unsupported, false);
  assert.equal(b.modules.length, 0);
});

function dynamicSyntax(
  kind: "normal" | "generator" | "async-generator" = "normal",
) {
  const syntax = parseDynamicFunction(kind, ["a=1"], "return a");
  assert.ok(syntax.ok);
  return syntax.value;
}
test("dynamic body service uses a supplied creation identity and returns its checked carrier", () => {
  const f = fixture(),
    identity = { creation: true };
  assert.equal(typeof evaluation.createDynamicFunctionBodyCompiler, "function");
  const carrier = runtime.createSourceFunction(
    (receiver, args, callee, newTarget) => 42,
    false,
    f.realm,
    f.hooks,
    "",
    0,
    undefined,
  );
  f.state.result = { error: "none", value: carrier };
  const compile = evaluation.createDynamicFunctionBodyCompiler(
    { realm: f.realm, global: f.global },
    f.host,
  );
  assert.equal(compile(dynamicSyntax(), identity), carrier);
  assert.ok(
    (f.frames[0]?.$argument1 as { hostDefined: unknown } | undefined)
      ?.hostDefined === identity,
  );
  assert.ok(f.frames[0]?.$argument0 === f.global);
  assert.deepEqual(f.faults, []);
});
for (const value of [undefined, {}, 7])
  test(
    "dynamic body service rejects a non-callable carrier " + String(value),
    () => {
      const f = fixture();
      assert.equal(
        typeof evaluation.createDynamicFunctionBodyCompiler,
        "function",
      );
      f.state.result = { error: "none", value };
      const compile = evaluation.createDynamicFunctionBodyCompiler(
        { realm: f.realm, global: f.global },
        f.host,
      );
      assert.equal(
        caught(() => compile(dynamicSyntax(), undefined)),
        undefined,
      );
      assert.deepEqual(f.faults, ["completion-view"]);
      assert.equal(f.realm.unsupported, true);
    },
  );
test("dynamic entry throws are host faults rather than user body exceptions", () => {
  const f = fixture();
  assert.equal(typeof evaluation.createDynamicFunctionBodyCompiler, "function");
  f.state.result = { error: "throw", value: 7 };
  const compile = evaluation.createDynamicFunctionBodyCompiler(
    { realm: f.realm, global: f.global },
    f.host,
  );
  assert.equal(
    caught(() => compile(dynamicSyntax(), undefined)),
    undefined,
  );
  assert.deepEqual(f.faults, ["completion-kind"]);
});
test("decorated dynamic classes reach the native module compiler", () => {
  const f = fixture();
  assert.equal(typeof evaluation.createDynamicFunctionBodyCompiler, "function");
  const carrier = runtime.createSourceFunction(
    (receiver, args, callee, newTarget) => 42,
    false,
    f.realm,
    f.hooks,
    "",
    0,
    undefined,
  );
  f.state.result = { error: "none", value: carrier };
  const compile = evaluation.createDynamicFunctionBodyCompiler(
    { realm: f.realm, global: f.global },
    f.host,
  );
  const syntax = parseDynamicFunction(
    "normal",
    [],
    "return @decorator class {}",
  );
  assert.ok(syntax.ok);
  assert.equal(compile(syntax.value, undefined), carrier);
  assert.equal(f.realm.unsupported, false);
  assert.equal(f.modules.length, 1);
  assert.deepEqual(f.faults, []);
});

test("indirect eval sees its calling function's definition Script across an outside Script call", () => {
  const a = fixture(),
    b = fixture("indirect-eval", a.realm.agent);
  const definition = runtime.createScriptRecord(a.realm, undefined),
    outside = runtime.createScriptRecord(a.realm, undefined);
  const intrinsic = runtime.installEvalIntrinsic(b.object, b.realm, b.hooks);
  runtime.installEvalCompiler(
    b.realm,
    createIndirectEvaluator({ realm: b.realm, global: b.global }, b.host),
  );
  b.state.invokeAction = (frame) => {
    assert.ok(frame.$argument1.hostDefined === definition);
    assert.ok(b.realm.agent.activeContext?.realm === b.realm);
    assert.ok(b.realm.agent.activeContext?.scriptOrModule === definition);
  };
  const source = runtime.runScriptContext(
    a.realm.agent,
    { realm: a.realm, scriptOrModule: definition },
    () =>
      runtime.createSourceFunction(
        () => {
          const result = runtime.callObjectValue(
            intrinsic,
            undefined,
            ["42"],
            a.object,
          );
          assert.equal(result.error, "none");
          return result.value;
        },
        false,
        a.realm,
        a.hooks,
      ),
  );
  const caller = { realm: a.realm, scriptOrModule: outside };
  runtime.runScriptContext(a.realm.agent, caller, () => {
    const result = runtime.callObjectValue(source, undefined, [], a.object);
    assert.equal(result.error, "none");
    assert.equal(result.value, 42);
    assert.ok(a.realm.agent.activeContext === caller);
  });
  assert.equal(b.frames.length, 1);
  assert.equal(a.realm.agent.activeContext, undefined);
});

function directFixture(reusable = false) {
  const f = fixture("script", undefined, reusable);
  assert.equal(typeof evaluation.createDirectEvaluator, "function");
  return {
    ...f,
    direct: evaluation.createDirectEvaluator(
      { realm: f.realm, global: f.global },
      f.host,
    ),
  };
}
test("direct eval carries the site rather than inheriting the active identity", () => {
  const f = directFixture(),
    site = {},
    identity = {};
  const outer = { realm: f.realm, scriptOrModule: identity };
  f.realm.agent.activeContext = outer;
  assert.equal(f.direct("1", 2, site), 42);
  assert.equal(f.modules.length, 1);
  assert.equal(
    (f.frames[0]?.$argument1 as { hostDefined: unknown } | undefined)
      ?.hostDefined,
    site,
  );
  assert.equal(f.frames[0]?.$argument1.realm, f.realm);
  assert.equal(f.realm.agent.activeContext, outer);
});
test("direct eval flags control strict declarations and new.target parsing", () => {
  for (const flags of [2, 3]) {
    const f = directFixture();
    assert.equal(f.direct("var v=1;new.target", flags, {}), 42);
    let target: unknown;
    rewriteModule(f.modules[0]!, {
      expression(node) {
        if (
          node.kind === "call" &&
          node.callee.kind === "identifier" &&
          node.callee.name === "instantiateDirectEvalDeclarations"
        )
          target = node.arguments[1];
        return node;
      },
    });
    assert.equal((target as any).kind, flags === 3 ? "identifier" : "member");
  }
  const f = directFixture();
  const error = caught(() => f.direct("new.target", 0, {}));
  assert.equal(
    runtime.viewObjectValue(error, f.object)?.prototype,
    f.realm.prototypes.get("syntax"),
  );
  assert.equal(f.modules.length, 0);
  assert.equal(f.realm.unsupported, false);
});
test("direct eval rejects unavailable caller capabilities before syntax errors", () => {
  for (const flags of [4, 8, 16, 20, 24, 32, 10, 46, 64]) {
    const f = directFixture();
    assert.equal(
      caught(() => f.direct("super.x", flags, {})),
      undefined,
    );
    assert.equal(f.realm.unsupported, true);
    assert.equal(f.modules.length, 0);
  }
  const f = directFixture();
  assert.equal(
    caught(() => f.direct("return 1", 2, undefined)),
    undefined,
  );
  assert.equal(f.realm.unsupported, true);
  assert.equal(f.modules.length, 0);
});
test("direct eval syntax and binding errors belong to its owning realm", () => {
  for (const [source, flags] of [
    ["super.x", 2],
    ["super()", 2],
    ["with(o){}", 1],
    ["return 1", 2],
    ["#x in o", 2],
    ["let a;let a", 2],
  ] as const) {
    const f = directFixture(),
      error = caught(() => f.direct(source, flags, {}));
    assert.equal(
      runtime.viewObjectValue(error, f.object)?.prototype,
      f.realm.prototypes.get("syntax"),
      source,
    );
    assert.equal(f.realm.unsupported, false);
    assert.equal(f.modules.length, 0);
  }
});
test("empty direct eval skips compilation while directives retain completion", () => {
  const f = directFixture();
  for (const source of ["", " /* c */ "]) {
    assert.equal(f.direct(source, 2, {}), undefined);
  }
  assert.equal(f.modules.length, 0);
  assert.equal(f.direct("'use strict'", 2, {}), 42);
  assert.equal(f.modules.length, 1);
});
test("direct eval completion and host-fault mapping matches other entries", () => {
  const thrown = directFixture(),
    marker = {};
  thrown.state.result = { error: "throw", value: marker };
  assert.equal(
    caught(() => thrown.direct("throw 1", 2, {})),
    marker,
  );
  assert.equal(thrown.realm.unsupported, false);
  for (const mode of [
    "unsupported",
    "view",
    "kind",
    "invoke",
    "context",
    "compile",
  ] as const) {
    const f = directFixture();
    if (mode === "unsupported")
      f.state.result = { error: "unsupported", value: undefined };
    if (mode === "view") f.state.result = undefined;
    if (mode === "kind") f.state.result = { error: "bad", value: undefined };
    if (mode === "invoke") f.state.throws = true;
    if (mode === "context")
      f.state.invokeAction = () => {
        f.realm.agent.activeContext = { realm: f.realm, scriptOrModule: {} };
      };
    if (mode === "compile")
      f.state.compileAction = () => {
        throw marker;
      };
    assert.equal(
      caught(() => f.direct("1", 2, {})),
      undefined,
    );
    assert.equal(f.realm.unsupported, true);
    assert.deepEqual(
      f.faults,
      mode === "unsupported"
        ? []
        : [
            mode === "view"
              ? "completion-view"
              : mode === "kind"
                ? "completion-kind"
                : mode === "invoke"
                  ? "invoke-threw"
                  : mode === "context"
                    ? "context-leak"
                    : "compile-threw",
          ],
    );
  }
});
test("every direct eval compile failure is sticky before invocation", () => {
  for (const stage of [
    "profile",
    "prepare",
    "lower",
    "emit",
    "select",
    "link",
    "budget",
    "publish",
  ] as const) {
    const f = directFixture();
    f.state.stage = stage;
    assert.equal(
      caught(() => f.direct("1", 2, {})),
      undefined,
    );
    assert.equal(f.realm.unsupported, true);
    assert.equal(f.frames.length, 0);
  }
});
test("direct eval domain mismatch and parser limits remain unsupported", () => {
  const stale = directFixture();
  stale.state.domain = 18;
  assert.equal(
    caught(() => stale.direct("return 1", 2, {})),
    undefined,
  );
  assert.equal(stale.realm.unsupported, true);
  assert.equal(stale.modules.length, 0);
  const limited = directFixture();
  assert.equal(
    caught(() =>
      limited.direct("(".repeat(200) + "1" + ")".repeat(200), 2, {}),
    ),
    undefined,
  );
  assert.equal(limited.realm.unsupported, true);
  assert.equal(limited.modules.length, 0);
});
test("direct eval preserves UTF-16 source code units", () => {
  const f = directFixture();
  assert.equal(f.direct("'\ud800'", 2, {}), 42);
  const strings: string[] = [];
  rewriteModule(f.modules[0]!, {
    expression(node) {
      if (node.kind === "string") strings.push(node.value);
      return node;
    },
  });
  assert.ok(strings.some((s) => s.includes("\ud800")));
});
test("direct eval services isolate realms and sticky state", () => {
  const a = directFixture(),
    b = directFixture();
  const error = caught(() => b.direct("return 1", 2, {}));
  assert.equal(
    runtime.viewObjectValue(error, b.object)?.prototype,
    b.realm.prototypes.get("syntax"),
  );
  assert.notEqual(
    runtime.viewObjectValue(error, b.object)?.prototype,
    a.realm.prototypes.get("syntax"),
  );
  assert.equal(
    caught(() => b.direct("1", 16, {})),
    undefined,
  );
  assert.equal(a.direct("1", 2, {}), 42);
  assert.equal(a.realm.unsupported, false);
  assert.equal(b.realm.unsupported, true);
});

test("direct eval compiles method, derived and field capabilities", () => {
  for (const [source, flags] of [
    ["super.x", 6],
    ["super.x", 7],
    ["super()", 15],
    ["super.x", 39],
    ["new.target", 39],
  ] as const) {
    const f = directFixture();
    assert.equal(f.direct(source, flags, {}), 42);
    assert.equal(f.modules.length, 1);
    assert.equal(f.realm.unsupported, false);
  }
});
test("direct eval applies method and field early errors in its own realm", () => {
  for (const [source, flags] of [
    ["super()", 7],
    ["arguments", 39],
    ["()=>arguments", 39],
    ["super.x", 3],
  ] as const) {
    const f = directFixture();
    const error = caught(() => f.direct(source, flags, {}));
    assert.equal(
      runtime.viewObjectValue(error, f.object)?.prototype,
      f.realm.prototypes.get("syntax"),
    );
    assert.equal(f.realm.unsupported, false);
    assert.equal(f.modules.length, 0);
  }
});

test("direct eval compiles a private environment while retaining unresolved-name validation", () => {
  for (const [source, flags] of [
    ["this.#x", 71],
    ["class C{m(){return this.#missing}}", 65],
    ["new.target;this.#x", 103],
  ] as const) {
    const f = directFixture();
    assert.equal(f.direct(source, flags, {}), 42);
    assert.equal(f.modules.length, 1);
    assert.equal(f.realm.unsupported, false);
  }
});

test("ShadowRealm evaluation separates syntax failures from executed throws and clears the referrer", () => {
  assert.equal(typeof evaluation.createShadowRealmEvaluator, "function");
  const f = fixture();
  const evaluate = evaluation.createShadowRealmEvaluator(
    { realm: f.realm, global: f.global },
    f.host,
  );
  assert.deepEqual(evaluate("return 1"), { error: "syntax", value: undefined });
  assert.deepEqual(evaluate("let x;let x;"), {
    error: "syntax",
    value: undefined,
  });
  assert.equal(f.modules.length, 0);
  const failure = runtime.createRuntimeError(f.realm, "syntax");
  f.state.result = { error: "throw", value: failure };
  assert.deepEqual(
    runtime.runScriptContext(
      f.realm.agent,
      { realm: f.realm, scriptOrModule: "outer" },
      () => evaluate("throw new SyntaxError()"),
    ),
    { error: "throw", value: failure },
  );
  assert.equal(
    (f.frames[0]?.$argument1 as { hostDefined: unknown } | undefined)
      ?.hostDefined,
    undefined,
  );
  f.state.result = { error: "none", value: 42 };
  assert.deepEqual(evaluate("42"), { error: "none", value: 42 });
  assert.deepEqual(evaluate(""), { error: "none", value: undefined });
  assert.equal(f.frames.length, 2);
});
for (const [label, source, kind, prepare] of [
  [
    "let over an earlier lexical binding",
    "var x; let taken;",
    "syntax",
    (f: ReturnType<typeof fixture>) =>
      records.createMutableBinding(f.global.lexical, "taken", false),
  ],
  [
    "var over an earlier lexical binding",
    "var x; var taken;",
    "syntax",
    (f: ReturnType<typeof fixture>) =>
      records.createMutableBinding(f.global.lexical, "taken", false),
  ],
  [
    "let over a restricted global property",
    "var x; let fixed;",
    "syntax",
    (f: ReturnType<typeof fixture>) =>
      runtime.defineOwnProperty(
        f.object,
        "fixed",
        {
          ...emptyUpdate(undefined),
          fields: 51,
          value: 1,
          writable: true,
          enumerable: true,
          configurable: false,
        },
        f.hooks,
      ),
  ],
  [
    "function over a non-writable global property",
    "var x; function fixed() {}",
    "type",
    (f: ReturnType<typeof fixture>) =>
      runtime.defineOwnProperty(
        f.object,
        "fixed",
        {
          ...emptyUpdate(undefined),
          fields: 51,
          value: 1,
          writable: false,
          enumerable: true,
          configurable: false,
        },
        f.hooks,
      ),
  ],
  [
    "var on a non-extensible global object",
    "var fresh;",
    "type",
    (f: ReturnType<typeof fixture>) => runtime.preventExtensions(f.object),
  ],
] as const)
  test(
    "Script declaration conflicts fail before native compilation: " + label,
    () => {
      const f = fixture();
      prepare(f);
      const error = caught(() => f.evaluate(source));
      assert.equal(
        runtime.viewObjectValue(error, f.object)?.prototype,
        f.realm.prototypes.get(kind),
      );
      assert.equal(f.realm.unsupported, false);
      assert.equal(f.modules.length, 0);
      assert.equal(f.frames.length, 0);
      assert.equal(runtime.getOwnProperty(f.object, "x"), undefined);
    },
  );
test("admitted Script declarations are instantiated only by compiled code", () => {
  const f = fixture();
  assert.equal(f.evaluate("var v; let l; function g() {}"), 42);
  assert.equal(f.modules.length, 1);
  assert.equal(f.frames.length, 1);
  assert.equal(runtime.getOwnProperty(f.object, "v"), undefined);
  assert.equal(runtime.getOwnProperty(f.object, "g"), undefined);
  assert.equal(records.hasBinding(f.global.lexical, "l"), false);
});
test("Script early errors take precedence over declaration admission", () => {
  const f = fixture();
  runtime.preventExtensions(f.object);
  const error = caught(() => f.evaluate("var fresh; let a; let a;"));
  assert.equal(
    runtime.viewObjectValue(error, f.object)?.prototype,
    f.realm.prototypes.get("syntax"),
  );
  assert.equal(f.modules.length, 0);
});
test("indirect eval keeps eval declaration admission in compiled code", () => {
  const f = fixture("indirect-eval");
  runtime.preventExtensions(f.object);
  assert.equal(f.evaluate("var fresh;"), 42);
  assert.equal(f.modules.length, 1);
});
function regExpFixture(kind: "script" | "indirect-eval" = "script") {
  const f = fixture(kind);
  runtime.installRegExpIntrinsics(f.object, f.realm, f.hooks);
  return f;
}
function regExpParts(f: ReturnType<typeof fixture>, value: unknown) {
  const object = runtime.viewObjectValue(value, f.object);
  assert.ok(object);
  assert.equal(object.prototype, f.realm.regexpPrototype);
  const read = (key: string): unknown =>
    runtime.getProperty(object, key, value, f.hooks);
  return { object, source: read("source"), flags: read("flags") };
}
test("direct eval of a sole RegExp literal creates it without native compilation", () => {
  const f = directFixture();
  runtime.installRegExpIntrinsics(f.object, f.realm, f.hooks);
  const keys = runtime.ownKeys(f.object, () => -1).length,
    activeContext = f.realm.agent.activeContext;
  for (const flags of [2, 3]) {
    const first = f.direct("/a\\u0041[b]/gi", flags, {}),
      second = f.direct("/a\\u0041[b]/gi;", flags, {});
    const a = regExpParts(f, first),
      b = regExpParts(f, second);
    assert.deepEqual([a.source, a.flags], ["a\\u0041[b]", "gi"]);
    assert.deepEqual([b.source, b.flags], ["a\\u0041[b]", "gi"]);
    assert.notEqual(a.object, b.object, "each evaluation creates a new object");
    assert.equal(runtime.getProperty(a.object, "lastIndex", first, f.hooks), 0);
  }
  // The shape admits no declarations: no global or lexical bindings appear and
  // no execution context is left behind.
  assert.equal(runtime.ownKeys(f.object, () => -1).length, keys);
  assert.equal(records.hasBinding(f.global.lexical, "a"), false);
  assert.equal(f.realm.agent.activeContext, activeContext);
  assert.equal(f.modules.length, 0);
  assert.equal(f.frames.length, 0);
});
for (const kind of ["script", "indirect-eval"] as const)
  test("sole RegExp literal " + kind + " skips native compilation", () => {
    const f = regExpFixture(kind);
    const parts = regExpParts(f, f.evaluate("/x/y"));
    assert.deepEqual([parts.source, parts.flags], ["x", "y"]);
    assert.equal(f.modules.length, 0);
  });
test("invalid RegExp literals remain early SyntaxErrors without compilation", () => {
  const f = directFixture();
  runtime.installRegExpIntrinsics(f.object, f.realm, f.hooks);
  for (const source of ["/(/", "/a/gg", "/\\u{110000}/u"]) {
    const error = caught(() => f.direct(source, 2, {}));
    assert.equal(
      runtime.viewObjectValue(error, f.object)?.prototype,
      f.realm.prototypes.get("syntax"),
    );
  }
  assert.equal(f.modules.length, 0);
});
test("RegExp literals inside larger programs still compile", () => {
  const f = directFixture();
  runtime.installRegExpIntrinsics(f.object, f.realm, f.hooks);
  for (const source of ["/a/; /b/", "(/a/)", "/a/.source", "var r = /a/;"])
    assert.equal(f.direct(source, 2, {}), 42);
  assert.equal(f.modules.length, 4);
});
test("identical eval source with the same entry shape reuses its compiled entry without reparsing", () => {
  const f = directFixture(),
    first = {},
    second = {};
  const host: ScriptEvaluationHost = {
    ...f.host,
    compile: (module) => {
      f.modules.push(module);
      return { ok: true, address: 4096, literals: ["shared"], reusable: true };
    },
  };
  const direct = evaluation.createDirectEvaluator(
    { realm: f.realm, global: f.global },
    host,
  );
  assert.equal(direct("v = 1", 2, first), 42);
  assert.equal(direct("v = 1", 2, second), 42);
  // One compile; each evaluation still gets its own Script record and site.
  assert.equal(f.modules.length, 1);
  assert.equal(f.frames.length, 2);
  assert.notEqual(f.frames[0]?.$argument1, f.frames[1]?.$argument1);
  assert.equal(
    (f.frames[1]?.$argument1 as { hostDefined: unknown }).hostDefined,
    second,
  );
  assert.deepEqual(
    (f.frames[1]?.$argument1 as { literals: readonly string[] }).literals,
    ["shared"],
  );
  // A different shape or text compiles again; syntax errors are never cached.
  direct("v = 1", 3, first);
  direct("v = 2", 2, first);
  assert.equal(f.modules.length, 3);
  for (let attempt = 0; attempt < 2; attempt++)
    assert.equal(
      runtime.viewObjectValue(
        caught(() => direct("new.target", 0, first)),
        f.object,
      )?.prototype,
      f.realm.prototypes.get("syntax"),
    );
  assert.equal(f.modules.length, 3);
  // Indirect eval shares the cache discipline; Scripts always reparse because
  // global declaration admission reads the current global object.
  const indirect = fixture("indirect-eval", undefined, true);
  indirect.evaluate("1");
  indirect.evaluate("1");
  assert.equal(indirect.modules.length, 1);
  const script = fixture("script", undefined, true);
  script.evaluate("1");
  script.evaluate("1");
  assert.equal(script.modules.length, 2);
  // ShadowRealm evaluate retains successes; syntax results and empty bodies
  // are recomputed from a fresh parse each time.
  const shadow = fixture("script", undefined, true),
    shadowEvaluate = evaluation.createShadowRealmEvaluator(
      { realm: shadow.realm, global: shadow.global },
      shadow.host,
    );
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(shadowEvaluate("1"), { error: "none", value: 42 });
    assert.deepEqual(shadowEvaluate("return 1"), {
      error: "syntax",
      value: undefined,
    });
    assert.deepEqual(shadowEvaluate(""), { error: "none", value: undefined });
  }
  assert.equal(shadow.modules.length, 1);
  assert.equal(shadow.frames.length, 2);
  // Entries the compiler does not mark reusable are never retained.
  const plain = directFixture();
  plain.direct("v = 1", 2, {});
  plain.direct("v = 1", 2, {});
  assert.equal(plain.modules.length, 2);
});
test("the eval source cache is bounded by entry count and source length", () => {
  const f = directFixture(true);
  const sources: string[] = [];
  for (let index = 0; index <= evaluation.maxCachedEvalSources; index++)
    sources.push("v = " + String(index));
  for (const source of sources) f.direct(source, 2, {});
  assert.equal(f.modules.length, sources.length);
  // The newest entries stay; the oldest was evicted and compiles again.
  f.direct(sources[sources.length - 1]!, 2, {});
  assert.equal(f.modules.length, sources.length);
  f.direct(sources[0]!, 2, {});
  assert.equal(f.modules.length, sources.length + 1);
  const long = "v = " + "1".repeat(evaluation.maxCachedEvalSourceLength);
  f.direct(long, 2, {});
  f.direct(long, 2, {});
  assert.equal(f.modules.length, sources.length + 3);
  // Entries with large literal tables are not retained either.
  const compiled: Module[] = [];
  const literalHeavy = evaluation.createDirectEvaluator(
    { realm: f.realm, global: f.global },
    {
      ...f.host,
      compile: (module) => {
        compiled.push(module);
        return {
          ok: true,
          address: 4096,
          reusable: true,
          literals: Array.from(
            { length: evaluation.maxCachedEvalLiterals + 1 },
            () => "x",
          ),
        };
      },
    },
  );
  literalHeavy("v = 1", 2, {});
  literalHeavy("v = 1", 2, {});
  assert.equal(compiled.length, 2);
});
test("eval source caches are per realm and per evaluator", () => {
  // One host serves two realms' direct evaluators and a ShadowRealm
  // evaluator; each compiles its own entry for the same source.
  const a = fixture("script", undefined, true),
    b = fixture("script", undefined, true);
  const compiled: Module[] = [];
  const host: ScriptEvaluationHost = {
    ...a.host,
    compile: (module) => {
      compiled.push(module);
      return { ok: true, address: 4096, reusable: true };
    },
  };
  const first = evaluation.createDirectEvaluator(
      { realm: a.realm, global: a.global },
      host,
    ),
    second = evaluation.createDirectEvaluator(
      { realm: b.realm, global: b.global },
      host,
    ),
    shadow = evaluation.createShadowRealmEvaluator(
      { realm: b.realm, global: b.global },
      host,
    );
  for (let attempt = 0; attempt < 2; attempt++) {
    first("v = 1", 2, {});
    second("v = 1", 2, {});
    shadow("v = 1");
  }
  assert.equal(compiled.length, 3);
  assert.equal(a.frames.length, 6);
  // Records belong to the evaluating realm, hit or miss.
  assert.equal(a.frames[3]?.$argument1.realm, a.realm);
  assert.equal(a.frames[4]?.$argument1.realm, b.realm);
});

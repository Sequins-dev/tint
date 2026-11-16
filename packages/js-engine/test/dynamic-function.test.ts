import assert from "node:assert/strict";
import test from "node:test";
import { emptyUpdate, valueField } from "@tint/js-runtime/descriptors";
import type { ScriptPropertyKey, ObjectHooks } from "@tint/js-runtime/objects";
import { bindHostRecordViews } from "../../js-runtime/test/ordinary-object-host-record-views.ts";
bindHostRecordViews();
const runtime = await import("@tint/js-runtime/objects");
const { createGlobalEnvironment } =
  await import("@tint/js-runtime/environments/global");
const { createDynamicFunctionCompiler } =
  await import("../src/dynamic-function.ts");
function fixture(
  managed = false,
  general?: import("../src/script-evaluation.ts").DynamicFunctionBodyCompiler,
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
  const realm = runtime.createErrorRealm(object, hooks);
  runtime.installFunctionIntrinsics(object, realm, hooks);
  const global = createGlobalEnvironment<ScriptPropertyKey, unknown>(
    object,
    object,
    object,
    (name) => name,
    hooks,
  );
  const events: string[] = [];
  const domain = { value: 17 };
  const compiler = createDynamicFunctionCompiler(
    { realm, global, object, hooks },
    {
      domain: () => domain.value,
      storage: {
        domain: 17,
        publish: (bytes) => {
          assert.ok(bytes.length > 0);
          events.push("publish");
          return 4096;
        },
      },
      invokeBorrowed: (address, value) => {
        assert.ok(address >= 4096);
        events.push("invoke");
        return value;
      },
      invokeManaged: (_address, reader) => {
        assert.equal(managed, true);
        const receiver = reader(undefined, 0);
        reader(receiver, 1);
        return receiver;
      },
      descriptor: () => {
        assert.equal(managed, true);
        return 1024;
      },
      signature: () => {
        assert.equal(managed, true);
        return 2048;
      },
      readWord: (address, _length, offset) => {
        assert.equal(managed, true);
        return (
          // The function brand descriptor: 40-byte records, environment at 16.
          (address === 1024 ? [40, 1, 16, 0] : [1, 48, 2, 1, 1, 8])[
            offset / 8
          ] ?? -1
        );
      },
    },
    { maxDynamicCodeBytes: 65536 },
    general,
  );
  return {
    object,
    realm,
    hooks,
    compiler,
    events,
    domain,
    target: runtime.getOwnProperty(object, "Function")!.value,
  };
}
test("engine creation leaves realm installation to the embedder and compilation lazy", () => {
  const { realm, compiler, events, target } = fixture();
  assert.equal(realm.dynamicFunctionCompiler, undefined);
  const fn = compiler("normal", ["value"], "return value", target);
  assert.deepEqual(events, []);
  assert.equal(fn.internalCall!(undefined, [19]), 19);
  assert.equal(fn.internalCall!(undefined, [23]), 23);
  assert.deepEqual(events, ["publish", "invoke", "invoke"]);
  assert.equal(runtime.getOwnProperty(fn, "length")?.value, 1);
  assert.match(fn.internalSourceText!, /return value/);
});
test("engine preserves strict receivers and sloppy global receivers", () => {
  const { object, compiler, target } = fixture();
  const strict = compiler("normal", [], '"use strict";return this', target);
  assert.equal(strict.internalCall!(undefined, []), undefined);
  assert.equal(strict.internalCall!(42, []), 42);
  const sloppy = compiler("normal", [], "return this", target);
  assert.equal(sloppy.internalCall!(undefined, []), object);
});
test("unsupported parameter initialization is rejected on call before publication", () => {
  const { compiler, realm, events, target } = fixture();
  const fn = compiler("normal", ["value=19"], "return value", target);
  assert.equal(realm.unsupported, false);
  assert.throws(() => fn.internalCall!(undefined, []));
  assert.equal(realm.unsupported, true);
  assert.deepEqual(events, []);
});
test("malformed grammar is rejected eagerly without code publication", () => {
  const { compiler, realm, events, target } = fixture();
  assert.throws(() => compiler("normal", [], "return )", target));
  assert.equal(realm.unsupported, false);
  assert.deepEqual(events, []);
});

test("grammar and binding errors precede observable constructor prototype lookup", () => {
  const { compiler, realm, events } = fixture();
  const marker = {};
  let reads = 0;
  const target = runtime.createExoticObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    {
      get: () => {
        reads++;
        throw marker;
      },
    },
    () => undefined,
  );
  assert.throws(() => compiler("normal", [], "return )", target));
  assert.throws(() =>
    compiler("normal", ["x", "x"], '"use strict";return x', target),
  );
  assert.equal(reads, 0);
  assert.throws(
    () => compiler("normal", [], "return 19", target),
    (error) => error === marker,
  );
  assert.equal(reads, 1);
  assert.deepEqual(events, []);
});

test("managed receiver writes use fresh invocation receivers across recursive setters", () => {
  const { compiler, realm, target } = fixture(true);
  const fn = compiler("normal", [], "this.touched=true;return this;", target);
  const inner = runtime.createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  let calls = 0;
  const outer = runtime.createExoticObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
    {
      set: (_object, key, value, receiver) => {
        assert.equal(key, "touched");
        assert.equal(value, true);
        assert.equal(receiver.object, outer);
        calls++;
        assert.equal(fn.internalCall!(inner, []), inner);
        return true;
      },
    },
  );
  assert.equal(fn.internalCall!(outer, []), outer);
  assert.equal(calls, 1);
  assert.equal(runtime.getOwnProperty(inner, "touched")?.value, true);
});

test("dynamic code rejects foreign context compilation and cached invocation before host effects", () => {
  const first = fixture(),
    uncompiled = first.compiler(
      "normal",
      ["value"],
      "return value",
      first.target,
    );
  first.domain.value = 19;
  assert.throws(() => uncompiled.internalCall!(undefined, [42]));
  assert.deepEqual(first.events, []);
  const second = fixture(),
    compiled = second.compiler(
      "normal",
      ["value"],
      "return value",
      second.target,
    );
  assert.equal(compiled.internalCall!(undefined, [42]), 42);
  const before = [...second.events];
  second.domain.value = 19;
  assert.throws(() => compiled.internalCall!(undefined, [23]));
  assert.deepEqual(second.events, before);
});

test("general ordinary bodies compile lazily once and receive packed call state", () => {
  const seen: { identity: unknown; source: string }[] = [];
  const calls: { receiver: unknown; args: readonly unknown[] }[] = [];
  const f = fixture(false, (syntax, identity) => {
    seen.push({ identity, source: syntax.sourceText });
    return runtime.createCallableObject<ScriptPropertyKey, unknown>(
      undefined,
      (receiver, args) => {
        calls.push({ receiver, args });
        return args[2];
      },
    );
  });
  const identity = { created: true };
  const fn = runtime.runScriptContext(
    f.realm.agent,
    { realm: f.realm, scriptOrModule: identity },
    () => f.compiler("normal", ["a=1"], "return a", f.target),
  );
  assert.equal(seen.length, 0);
  assert.deepEqual(f.events, []);
  assert.equal(fn.internalCall!(7, [42]), 42);
  assert.equal(fn.internalCall!(undefined, [19]), 19);
  assert.equal(seen.length, 1);
  assert.ok(seen[0]?.identity === identity);
  assert.equal(calls[0]?.receiver, 7);
  assert.ok(calls[0]?.args[0] === fn);
  assert.equal(calls[0]?.args[1], undefined);
  assert.equal(calls[0]?.args[2], 42);
  assert.equal(calls[1]?.receiver, undefined);
  assert.deepEqual(f.events, []);
});
test("general fallback covers arguments and closed profiles with missing inputs", () => {
  let compilations = 0;
  const f = fixture(false, () => {
    compilations++;
    return runtime.createCallableObject<ScriptPropertyKey, unknown>(
      undefined,
      () => 42,
    );
  });
  const unsupported = f.compiler(
    "normal",
    [],
    "return arguments.length",
    f.target,
  );
  assert.equal(unsupported.internalCall!(undefined, [1, 2]), 42);
  const closed = f.compiler("normal", [], "return arguments[0]", f.target);
  assert.equal(closed.internalCall!(undefined, []), 42);
  assert.equal(compilations, 2);
  assert.equal(f.realm.unsupported, false);
});
test("simple fast paths stay ahead of the general fallback", () => {
  let calls = 0;
  const f = fixture(false, () => {
    calls++;
    throw "GENERAL_UNEXPECTED";
  });
  const simple = f.compiler("normal", [], "return this", f.target);
  assert.equal(simple.internalCall!(undefined, []), f.object);
  assert.equal(calls, 0);
});

test("general body internal calls reuse the outer source function execution context", () => {
  const identity = { created: true },
    other = { called: true };
  let observed: unknown, observedRealm: unknown;
  const f = fixture(false, () =>
    runtime.createCallableObject<ScriptPropertyKey, unknown>(undefined, () => {
      observed = f.realm.agent.activeContext?.scriptOrModule;
      observedRealm = f.realm.agent.activeContext?.realm;
      return 42;
    }),
  );
  const fn = runtime.runScriptContext(
    f.realm.agent,
    { realm: f.realm, scriptOrModule: identity },
    () => f.compiler("normal", ["a=1"], "return a", f.target),
  );
  const value = runtime.runScriptContext(
    f.realm.agent,
    { realm: f.realm, scriptOrModule: other },
    () => runtime.callObjectValue(fn, undefined, [], f.object),
  );
  assert.equal(value.error, "none");
  assert.equal(value.value, 42);
  assert.ok(observed === identity);
  assert.ok(observedRealm === f.realm);
  assert.equal(f.realm.agent.activeContext, undefined);
});

test("general async bodies compile once and return the carrier's own promises", () => {
  const identity = {},
    outside = {},
    seen: unknown[] = [],
    packed: unknown[][] = [];
  const issued: unknown[] = [];
  const f = fixture(false, (syntax, script) => {
    seen.push(script);
    assert.match(syntax.sourceText, /^async function/);
    return runtime.createCallableObject<ScriptPropertyKey, unknown>(
      undefined,
      (receiver, args) => {
        assert.equal(receiver, 7);
        packed.push([...args]);
        assert.equal(f.realm.agent.activeContext?.scriptOrModule, identity);
        const promise = runtime.createPromiseObject(f.realm.promisePrototype);
        issued.push(promise);
        return promise;
      },
    );
  });
  const fn = runtime.runScriptContext(
    f.realm.agent,
    { realm: f.realm, scriptOrModule: identity },
    () => f.compiler("async", ["a=1"], "return await a", f.target),
  );
  assert.equal(seen.length, 0);
  for (const value of [42, 19]) {
    const called = runtime.runScriptContext(
      f.realm.agent,
      { realm: f.realm, scriptOrModule: outside },
      () => runtime.callObjectValue(fn, 7, [value], f.object),
    );
    assert.equal(called.error, "none");
    assert.equal(called.value, issued.at(-1));
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0], identity);
  assert.equal(issued.length, 2);
  assert.notEqual(issued[0], issued[1]);
  assert.equal(packed[0]?.[0], fn);
  assert.equal(packed[0]?.[1], undefined);
  assert.equal(packed[0]?.[2], 42);
  assert.equal(f.realm.agent.activeContext, undefined);
});

test("async fallback resumes under its definition context without extra adoption ticks", () => {
  const identity = {},
    outside = {},
    log: string[] = [];
  const f = fixture(false, () =>
    runtime.createSourceAsyncContinuationFunction(
      () => {
        let resumed = false;
        return () => {
          assert.equal(f.realm.agent.activeContext?.scriptOrModule, identity);
          assert.equal(f.realm.agent.activeContext?.realm, f.realm);
          if (!resumed) {
            resumed = true;
            log.push("b0");
            return { kind: "yield", result: 1 };
          }
          log.push("b1");
          return { kind: "return", value: 42 };
        };
      },
      f.realm,
      f.hooks,
    ),
  );
  runtime.installPromiseIntrinsics(
    f.object,
    f.realm,
    f.hooks,
    (_promise, _operation): void => {},
  );
  const fn = runtime.runScriptContext(
    f.realm.agent,
    { realm: f.realm, scriptOrModule: identity },
    () => f.compiler("async", ["a=1"], "return await a", f.target),
  );
  const result = runtime.runScriptContext(
    f.realm.agent,
    { realm: f.realm, scriptOrModule: outside },
    () => runtime.callObjectValue(fn, undefined, [], f.object),
  );
  assert.equal(result.error, "none");
  const then = runtime.getOwnProperty(f.realm.promisePrototype!, "then")!.value;
  const settled = runtime.createCallableObject<ScriptPropertyKey, unknown>(
    undefined,
    (_receiver, args) => {
      assert.equal(args[0], 42);
      log.push("settled");
      return undefined;
    },
  );
  assert.equal(
    runtime.callObjectValue(then, result.value, [settled], f.object).error,
    "none",
  );
  function tick(n: number) {
    runtime.enqueueScriptJob(
      f.realm.agent,
      () => {
        log.push("t" + n);
        if (n < 4) tick(n + 1);
      },
      undefined,
    );
  }
  tick(1);
  assert.deepEqual(log, ["b0"]);
  const errors: unknown[] = [];
  runtime.drainScriptJobs(f.realm.agent, (e) => errors.push(e));
  assert.deepEqual(errors, []);
  assert.deepEqual(log, ["b0", "b1", "t1", "settled", "t2", "t3", "t4"]);
  assert.equal(f.realm.agent.activeContext, undefined);
});

test("general generator initialization is cached and precedes outer prototype selection", () => {
  let compilations = 0;
  let initializations = 0;
  const packed: unknown[][] = [];
  const f = fixture(false, () => {
    compilations++;
    return runtime.createCallableObject<ScriptPropertyKey, unknown>(
      undefined,
      (receiver, args) => {
        initializations++;
        packed.push([...args]);
        assert.equal(receiver, 7);
        return runtime.createGeneratorObject(
          (_kind, value) => ({ kind: "return", value }),
          f.realm,
        );
      },
    );
  });
  const fn = f.compiler("generator", ["a=1"], "yield a", f.target);
  assert.equal(compilations, 0);
  const first = fn.internalCall!(7, [42]);
  const second = fn.internalCall!(7, [43]);
  assert.equal(compilations, 1);
  assert.equal(initializations, 2);
  assert.deepEqual(packed, [
    [fn, undefined, 42],
    [fn, undefined, 43],
  ]);
  assert.notEqual(first, second);
  assert.equal(f.realm.unsupported, false);
});

test("async generator carriers transfer only an idle unstarted continuation", () => {
  assert.equal(typeof runtime.takeAsyncGeneratorStart, "function");
  const f = fixture();
  const make = () =>
    runtime.createAsyncGeneratorObject(
      () => ({ kind: "return", value: 42 }),
      f.realm,
      f.hooks,
    );
  const hidden = make(),
    start = runtime.takeAsyncGeneratorStart(hidden, f.realm);
  assert.equal(hidden.internalAsyncGeneratorData?.record.state, "completed");
  assert.equal(
    hidden.internalAsyncGeneratorData?.record.continuation,
    undefined,
  );
  assert.deepEqual(start("next", undefined), { kind: "return", value: 42 });
  assert.throws(
    () => runtime.takeAsyncGeneratorStart(hidden, f.realm),
    (e) => e === "DYNAMIC_ASYNC_GENERATOR_CARRIER_INVARIANT",
  );
  for (const field of ["running", "waiting"] as const) {
    const g = make();
    g.internalAsyncGeneratorData!.record[field] = true;
    assert.throws(() => runtime.takeAsyncGeneratorStart(g, f.realm));
  }
  const g = make();
  g.internalAsyncGeneratorData!.record.state = "suspended-yield";
  assert.throws(() => runtime.takeAsyncGeneratorStart(g, f.realm));
  for (const value of [undefined, 1, {}, f.object])
    assert.throws(() => runtime.takeAsyncGeneratorStart(value, f.realm));
});

test("general async generator bodies initialize synchronously and cache the hidden carrier", () => {
  let compilations = 0,
    initializations = 0;
  const marker = {},
    packed: unknown[][] = [];
  const f = fixture(false, () => {
    compilations++;
    return runtime.createCallableObject<ScriptPropertyKey, unknown>(
      undefined,
      (_receiver, args) => {
        initializations++;
        packed.push([...args]);
        if (args[2] === marker) throw marker;
        return runtime.createAsyncGeneratorObject(
          () => ({ kind: "return", value: 42 }),
          f.realm,
          f.hooks,
        );
      },
    );
  });
  const fn = f.compiler("async-generator", ["a=1"], "yield a", f.target);
  assert.equal(compilations, 0);
  const first = fn.internalCall!(undefined, [19]);
  const second = fn.internalCall!(undefined, [23]);
  assert.notEqual(first, second);
  assert.equal(compilations, 1);
  assert.equal(initializations, 2);
  assert.deepEqual(packed, [
    [fn, undefined, 19],
    [fn, undefined, 23],
  ]);
  assert.throws(
    () => fn.internalCall!(undefined, [marker]),
    (e) => e === marker,
  );
  assert.equal(compilations, 1);
  assert.equal(f.realm.unsupported, false);
});

test("dynamic generator prototypes are selected after carrier parameter effects", () => {
  for (const kind of ["generator", "async-generator"] as const) {
    const f = fixture(false, () =>
      runtime.createCallableObject<ScriptPropertyKey, unknown>(
        undefined,
        (_receiver, args) => {
          const callee = runtime.viewObjectValue(args[0], f.object);
          assert.ok(callee);
          assert.equal(
            runtime.defineOwnProperty(
              callee,
              "prototype",
              {
                ...emptyUpdate<unknown>(undefined),
                fields: valueField,
                value: replacement,
              },
              f.hooks,
            ),
            "accepted",
          );
          return kind === "generator"
            ? runtime.createGeneratorObject(
                () => ({ kind: "return", value: 42 }),
                f.realm,
              )
            : runtime.createAsyncGeneratorObject(
                () => ({ kind: "return", value: 42 }),
                f.realm,
                f.hooks,
              );
        },
      ),
    );
    const replacement = runtime.createObject<ScriptPropertyKey, unknown>(
      undefined,
    );
    const fn = f.compiler(kind, ["a=1"], "yield a", f.target);
    const generator = runtime.viewObjectValue(
      fn.internalCall!(undefined, []),
      f.object,
    );
    assert.ok(generator);
    assert.equal(generator.prototype, replacement);
  }
});

test("async generator transfer rejects queued requests and pending resumptions", () => {
  const f = fixture();
  const make = () =>
    runtime.createAsyncGeneratorObject(
      () => ({ kind: "return", value: 42 }),
      f.realm,
      f.hooks,
    );
  const request = {
    kind: "next" as const,
    value: undefined,
    capability: {
      resolve: (_value: unknown) => {},
      reject: (_reason: unknown) => {},
    },
    next: undefined,
  };
  for (const field of ["head", "tail"] as const) {
    const g = make(),
      record = g.internalAsyncGeneratorData!.record;
    record[field] = request;
    assert.throws(
      () => runtime.takeAsyncGeneratorStart(g, f.realm),
      (e) => e === "DYNAMIC_ASYNC_GENERATOR_CARRIER_INVARIANT",
    );
    assert.equal(record.state, "suspended-start");
    assert.ok(record.continuation);
  }
  const pending = make();
  pending.internalAsyncGeneratorData!.record.pending = {
    target: "body",
    kind: "next",
    value: 42,
  };
  assert.throws(
    () => runtime.takeAsyncGeneratorStart(pending, f.realm),
    (e) => e === "DYNAMIC_ASYNC_GENERATOR_CARRIER_INVARIANT",
  );
  const empty = make();
  empty.internalAsyncGeneratorData!.record.continuation = undefined;
  assert.throws(
    () => runtime.takeAsyncGeneratorStart(empty, f.realm),
    (e) => e === "DYNAMIC_ASYNC_GENERATOR_CARRIER_INVARIANT",
  );
});

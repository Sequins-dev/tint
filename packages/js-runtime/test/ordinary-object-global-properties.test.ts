import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { ObjectHooks, ScriptPropertyKey } from "../src/objects/index.ts";
import { bindHostRecordViews } from "./ordinary-object-host-record-views.ts";
import { exoticSlots } from "../src/objects/operations.ts";
const views = bindHostRecordViews();
after(() => views.deregister());
const object = await import("../src/objects/index.ts");
test("globalThis uses the host this-value with a mutable non-enumerable binding", () => {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const global = object.createObject<ScriptPropertyKey, unknown>(undefined);
  const thisValue = object.createObject<ScriptPropertyKey, unknown>(undefined);
  assert.equal(typeof object.installGlobalProperties, "function");
  object.installGlobalProperties(global, thisValue, hooks);
  const descriptor = object.getOwnProperty(global, "globalThis");
  assert.ok(descriptor);
  assert.ok(descriptor.value === thisValue);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  assert.equal(descriptor.enumerable, false);
});

test("eval installs standard function metadata and preserves non-string identities", () => {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw "UNEXPECTED_COERCION";
    },
  };
  const global = object.createObject<ScriptPropertyKey, unknown>(undefined),
    realm = object.createErrorRealm(global, hooks);
  assert.equal(typeof object.installEvalIntrinsic, "function");
  const evaluate = object.installEvalIntrinsic(global, realm, hooks);
  assert.equal(evaluate.internalRareSlots?.internalConstruct, undefined);
  assert.equal(object.getOwnProperty(evaluate, "prototype"), undefined);
  assert.equal(exoticSlots(evaluate).internalInitialName, "eval");
  for (const [name, value] of [
    ["name", "eval"],
    ["length", 1],
  ] as const) {
    const property = object.getOwnProperty(evaluate, name);
    assert.ok(property);
    assert.equal(property.value, value);
    assert.equal(property.writable, false);
    assert.equal(property.enumerable, false);
    assert.equal(property.configurable, true);
  }
  const property = object.getOwnProperty(global, "eval");
  assert.ok(property);
  assert.equal(property.value, evaluate);
  assert.equal(property.writable, true);
  assert.equal(property.enumerable, false);
  assert.equal(property.configurable, true);
  for (const value of [
    undefined,
    null,
    false,
    42,
    object.createSymbolValue("x"),
    {
      toString() {
        throw 1;
      },
    },
  ])
    assert.equal(
      evaluate.internalRareSlots!.internalCall!(undefined, [value]),
      value,
    );
  assert.equal(
    evaluate.internalRareSlots!.internalCall!(undefined, []),
    undefined,
  );
  assert.equal(realm.unsupported, false);
  assert.throws(
    () => evaluate.internalRareSlots!.internalCall!(undefined, [""]),
    (error) => error === undefined,
  );
  assert.equal(
    realm.unsupported,
    true,
    "string evaluation awaits caller-aware compiler integration",
  );
});

function evalRealm() {
  const hooks: ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => {
      throw "UNEXPECTED_COERCION";
    },
  };
  const global = object.createObject<ScriptPropertyKey, unknown>(undefined);
  return { hooks, global, realm: object.createErrorRealm(global, hooks) };
}
test("eval identity belongs to one realm and cannot be installed twice", () => {
  const { hooks, global, realm } = evalRealm();
  assert.equal(realm.evalFunction, undefined);
  const intrinsic = object.installEvalIntrinsic(global, realm, hooks);
  assert.equal(realm.evalFunction, intrinsic);
  assert.throws(
    () => object.installEvalIntrinsic(global, realm, hooks),
    (error) => error === "EVAL_INTRINSIC_INVARIANT",
  );
  assert.equal(object.getOwnProperty(global, "eval")?.value, intrinsic);
});
test("direct eval candidate returns non-strings without calling the intrinsic or coercing", () => {
  const { global, realm } = evalRealm();
  let calls = 0;
  const intrinsic = object.createCallableObject<ScriptPropertyKey, unknown>(
    undefined,
    () => {
      calls++;
      throw "CALLED_INTRINSIC";
    },
  );
  realm.evalFunction = intrinsic;
  for (const value of [
    undefined,
    null,
    false,
    7,
    object.createSymbolValue("x"),
    {
      toString() {
        throw "COERCED";
      },
    },
  ])
    assert.deepEqual(
      object.callEvalCandidate(
        intrinsic,
        {},
        [value],
        global,
        realm,
        0,
        undefined,
      ),
      { error: "none", value },
    );
  assert.deepEqual(
    object.callEvalCandidate(intrinsic, {}, [], global, realm, 0, undefined),
    {
      error: "none",
      value: undefined,
    },
  );
  assert.equal(calls, 0);
  assert.equal(realm.unsupported, false);
});
test("direct string eval rejects before invoking the intrinsic", () => {
  const { global, realm } = evalRealm();
  let calls = 0;
  const intrinsic = object.createCallableObject<ScriptPropertyKey, unknown>(
    undefined,
    () => {
      calls++;
      throw "CALLED_INTRINSIC";
    },
  );
  realm.evalFunction = intrinsic;
  assert.throws(
    () =>
      object.callEvalCandidate(
        intrinsic,
        undefined,
        ["1"],
        global,
        realm,
        0,
        undefined,
      ),
    (e) => e === undefined,
  );
  assert.equal(realm.unsupported, true);
  assert.equal(calls, 0);
});
test("shadowed eval preserves ordinary receiver, arguments and throw identity", () => {
  const { global, realm, hooks } = evalRealm();
  object.installEvalIntrinsic(global, realm, hooks);
  const receiver = {},
    args = [{}, 7];
  let observed: unknown;
  const fn = object.createCallableObject<ScriptPropertyKey, unknown>(
    undefined,
    (actual, values) => {
      assert.equal(actual, receiver);
      assert.equal(values, args);
      observed = values[0];
      return observed;
    },
  );
  assert.deepEqual(
    object.callEvalCandidate(fn, receiver, args, global, realm, 0, undefined),
    { error: "none", value: args[0] },
  );
  assert.equal(realm.unsupported, false);
  const error = {};
  const throwing = object.createCallableObject<ScriptPropertyKey, unknown>(
    undefined,
    () => {
      throw error;
    },
  );
  assert.throws(
    () =>
      object.callEvalCandidate(
        throwing,
        receiver,
        [],
        global,
        realm,
        0,
        undefined,
      ),
    (e) => e === error,
  );
});
test("an unset eval identity never makes an undefined callee callable", () => {
  const { global, realm } = evalRealm();
  assert.deepEqual(
    object.callEvalCandidate(
      undefined,
      undefined,
      [7],
      global,
      realm,
      0,
      undefined,
    ),
    { error: "type", value: undefined },
  );
});
test("another realm eval uses ordinary invocation and its own unsupported state", () => {
  const a = evalRealm(),
    b = evalRealm();
  object.installEvalIntrinsic(a.global, a.realm, a.hooks);
  const other = object.installEvalIntrinsic(b.global, b.realm, b.hooks);
  assert.deepEqual(
    object.callEvalCandidate(other, {}, [7], a.global, a.realm, 0, undefined),
    { error: "none", value: 7 },
  );
  assert.throws(
    () =>
      object.callEvalCandidate(
        other,
        {},
        ["1"],
        a.global,
        a.realm,
        0,
        undefined,
      ),
    (e) => e === undefined,
  );
  assert.equal(a.realm.unsupported, false);
  assert.equal(b.realm.unsupported, true);
});

test("indirect eval compiler installs once after the intrinsic", () => {
  const { realm, global, hooks } = evalRealm();
  assert.equal(realm.evalCompiler, undefined);
  assert.equal(typeof object.installEvalCompiler, "function");
  const compiler = (source: string): unknown => source;
  assert.throws(
    () => object.installEvalCompiler(realm, compiler),
    (error) => error === "EVAL_COMPILER_INVARIANT",
  );
  object.installEvalIntrinsic(global, realm, hooks);
  object.installEvalCompiler(realm, compiler);
  assert.throws(
    () => object.installEvalCompiler(realm, () => 7),
    (error) => error === "EVAL_COMPILER_INVARIANT",
  );
  assert.equal(realm.evalCompiler, compiler);
});

test("indirect eval forwards raw strings and abrupt completions without coercion", () => {
  const { realm, global, hooks } = evalRealm();
  const evaluate = object.installEvalIntrinsic(global, realm, hooks);
  assert.equal(typeof object.installEvalCompiler, "function");
  const received: string[] = [],
    thrown = {};
  object.installEvalCompiler(realm, (source) => {
    received.push(source);
    if (source === "throw") throw thrown;
    return source;
  });
  for (const source of ["", "1+2", "\uD800"])
    assert.equal(
      evaluate.internalRareSlots!.internalCall!(undefined, [source, "ignored"]),
      source,
    );
  const value = {
    toString() {
      throw "COERCED";
    },
  };
  assert.equal(
    evaluate.internalRareSlots!.internalCall!(undefined, [value]),
    value,
  );
  assert.equal(
    evaluate.internalRareSlots!.internalCall!(undefined, []),
    undefined,
  );
  assert.throws(
    () => evaluate.internalRareSlots!.internalCall!(undefined, ["throw"]),
    (e) => e === thrown,
  );
  assert.deepEqual(received, ["", "1+2", "\uD800", "throw"]);
  assert.equal(realm.unsupported, false);
});

test("installing an indirect compiler never enables the direct string eval path", () => {
  const { realm, global, hooks } = evalRealm();
  const evaluate = object.installEvalIntrinsic(global, realm, hooks);
  assert.equal(typeof object.installEvalCompiler, "function");
  let calls = 0;
  object.installEvalCompiler(realm, () => {
    calls++;
    return 42;
  });
  assert.throws(
    () =>
      object.callEvalCandidate(
        evaluate,
        undefined,
        ["1"],
        global,
        realm,
        0,
        undefined,
      ),
    (e) => e === undefined,
  );
  assert.equal(calls, 0);
  assert.equal(realm.unsupported, true);
});

test("eval compiler and unsupported state belong to the intrinsic realm", () => {
  const a = evalRealm(),
    b = evalRealm();
  const evalA = object.installEvalIntrinsic(a.global, a.realm, a.hooks);
  const evalB = object.installEvalIntrinsic(b.global, b.realm, b.hooks);
  assert.equal(typeof object.installEvalCompiler, "function");
  object.installEvalCompiler(b.realm, () => 42);
  assert.equal(
    object.callEvalCandidate(
      evalB,
      undefined,
      ["x"],
      a.global,
      a.realm,
      0,
      undefined,
    ).value,
    42,
  );
  assert.throws(
    () => evalA.internalRareSlots!.internalCall!(undefined, ["x"]),
    (e) => e === undefined,
  );
  assert.equal(a.realm.unsupported, true);
  assert.equal(b.realm.unsupported, false);
});

test("direct-eval metadata stays opaque until string execution is enabled", () => {
  const { global, realm, hooks } = evalRealm();
  const intrinsic = object.installEvalIntrinsic(global, realm, hooks);
  const site = new Proxy(
    {},
    {
      get() {
        throw "SITE_TOUCHED";
      },
      has() {
        throw "SITE_TOUCHED";
      },
      ownKeys() {
        throw "SITE_TOUCHED";
      },
    },
  );
  assert.deepEqual(
    object.callEvalCandidate(
      intrinsic,
      undefined,
      [7],
      global,
      realm,
      31,
      site,
    ),
    { error: "none", value: 7 },
  );
  assert.throws(
    () =>
      object.callEvalCandidate(
        intrinsic,
        undefined,
        ["1"],
        global,
        realm,
        0,
        site,
      ),
    (e) => e === undefined,
  );
  assert.equal(realm.unsupported, true);
});

test("direct eval compiler installs once after the intrinsic and indirect service", () => {
  const f = evalRealm();
  const compiler = (source: string, flags: number, site: unknown): unknown =>
    site;
  assert.equal(typeof object.installDirectEvalCompiler, "function");
  assert.equal(f.realm.directEvalCompiler, undefined);
  assert.throws(
    () => object.installDirectEvalCompiler(f.realm, compiler),
    (e) => e === "DIRECT_EVAL_COMPILER_INVARIANT",
  );
  object.installEvalIntrinsic(f.global, f.realm, f.hooks);
  assert.throws(
    () => object.installDirectEvalCompiler(f.realm, compiler),
    (e) => e === "DIRECT_EVAL_COMPILER_INVARIANT",
  );
  object.installEvalCompiler(f.realm, (source) => source);
  object.installDirectEvalCompiler(f.realm, compiler);
  assert.equal(f.realm.directEvalCompiler, compiler);
  assert.throws(
    () => object.installDirectEvalCompiler(f.realm, () => 0),
    (e) => e === "DIRECT_EVAL_COMPILER_INVARIANT",
  );
  assert.equal(f.realm.directEvalCompiler, compiler);
});
test("direct string eval forwards only source flags and the exact caller site", () => {
  const f = evalRealm(),
    intrinsic = object.installEvalIntrinsic(f.global, f.realm, f.hooks),
    site = {},
    returned = {};
  object.installEvalCompiler(f.realm, () =>
    assert.fail("direct call reached indirect compiler"),
  );
  const received: unknown[][] = [];
  object.installDirectEvalCompiler(f.realm, (source, flags, actual) => {
    received.push([source, flags, actual]);
    return returned;
  });
  assert.deepEqual(
    object.callEvalCandidate(
      intrinsic,
      {},
      ["s", 99],
      f.global,
      f.realm,
      3,
      site,
    ),
    { error: "none", value: returned },
  );
  assert.deepEqual(received, [["s", 3, site]]);
  assert.equal(f.realm.unsupported, false);
  for (const args of [
    [],
    [7],
    [
      {
        toString() {
          throw "COERCED";
        },
      },
    ],
  ])
    object.callEvalCandidate(intrinsic, {}, args, f.global, f.realm, 3, site);
  assert.equal(received.length, 1);
  const shadow = object.createCallableObject<ScriptPropertyKey, unknown>(
    undefined,
    (receiver, args) => receiver,
  );
  const receiver = {};
  assert.equal(
    object.callEvalCandidate(
      shadow,
      receiver,
      ["s"],
      f.global,
      f.realm,
      3,
      site,
    ).value,
    receiver,
  );
  assert.equal(received.length, 1);
});
test("direct compiler throws retain identity and foreign eval stays indirect", () => {
  const a = evalRealm(),
    b = evalRealm(),
    marker = {};
  const intrinsic = object.installEvalIntrinsic(a.global, a.realm, a.hooks),
    foreign = object.installEvalIntrinsic(b.global, b.realm, b.hooks);
  object.installEvalCompiler(a.realm, () => 0);
  object.installEvalCompiler(b.realm, () => 17);
  object.installDirectEvalCompiler(a.realm, () => {
    throw marker;
  });
  assert.throws(
    () =>
      object.callEvalCandidate(
        intrinsic,
        undefined,
        ["s"],
        a.global,
        a.realm,
        2,
        {},
      ),
    (e) => e === marker,
  );
  assert.equal(a.realm.unsupported, false);
  assert.equal(
    object.callEvalCandidate(
      foreign,
      undefined,
      ["s"],
      a.global,
      a.realm,
      2,
      {},
    ).value,
    17,
  );
  assert.equal(a.realm.unsupported, false);
  assert.equal(b.realm.unsupported, false);
});

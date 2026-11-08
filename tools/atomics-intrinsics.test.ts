import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, test } from "node:test";
import type { SharedBlockService } from "@tint/js-runtime/bytes/shared";
import type * as objects from "../packages/js-runtime/src/objects/index.ts";
import { bindHostRecordViews } from "../packages/js-runtime/test/ordinary-object-host-record-views.ts";
const host = bindHostRecordViews();
after(() => host.deregister());
const o = await import("../packages/js-runtime/src/objects/index.ts");
const { builtinProperty } =
  await import("../packages/js-runtime/src/objects/intrinsics.ts");
type ObjectValue = objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
async function fixture(pauseHint?: () => void, canSuspend = false) {
  assert.ok(
    existsSync("packages/js-runtime/src/objects/atomics.ts"),
    "portable Atomics intrinsics must exist",
  );
  const api = await import("../packages/js-runtime/src/objects/atomics.ts");
  const root = o.createObject<objects.ScriptPropertyKey, unknown>(undefined);
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: (fn, receiver, args) => {
      const result = o.callObject(fn as ObjectValue, receiver, args, undefined);
      assert.equal(result.error, "none");
      return result.value;
    },
  };
  const realm = o.createErrorRealm(
    root,
    hooks,
    undefined,
    o.createScriptAgent(canSuspend),
  );
  const policy = { lockFree1: true, lockFree2: true, lockFree8: true };
  api.installAtomicsIntrinsics(root, realm, hooks, policy, pauseHint);
  const atomics = o.getOwnProperty(root, "Atomics")!.value as ObjectValue;
  const get = (object: ObjectValue, key: objects.ScriptPropertyKey) =>
    o.getProperty(object, key, object, hooks);
  const invoke = (name: string, args: unknown[] = []) => {
    const result = o.callObject(
      get(atomics, name) as ObjectValue,
      null,
      args,
      undefined,
    );
    assert.equal(result.error, "none", name + " must be installed");
    return result.value;
  };
  return { api, root, hooks, realm, policy, atomics, get, invoke };
}
test("Atomics namespace and query methods have standard descriptors", async () => {
  const f = await fixture();
  assert.ok(f.atomics.prototype === f.realm.objectPrototype);
  assert.equal(f.atomics.internalCall, undefined);
  assert.equal(f.atomics.internalConstruct, undefined);
  assert.equal(
    f.get(f.atomics, o.wellKnownSymbol(f.realm.symbolRegistry, "toStringTag")),
    "Atomics",
  );
  for (const [name, length] of [
    ["isLockFree", 1],
    ["pause", 0],
  ] as const) {
    const method = f.get(f.atomics, name) as ObjectValue;
    assert.equal(f.get(method, "name"), name);
    assert.equal(f.get(method, "length"), length);
    assert.equal(method.internalConstruct, undefined);
    const property = o.getOwnProperty(f.atomics, name)!;
    assert.equal(property.enumerable, false);
    assert.equal(property.writable, true);
    assert.equal(property.configurable, true);
  }
});
test("isLockFree uses integer conversion and stable captured target capabilities", async () => {
  const f = await fixture();
  for (const size of [1, 2, 4, 8, 4.9, "4.9", true])
    assert.equal(f.invoke("isLockFree", [size]), true);
  for (const size of [
    undefined,
    null,
    NaN,
    0,
    -1,
    -4.9,
    3,
    Infinity,
    -Infinity,
  ])
    assert.equal(f.invoke("isLockFree", [size]), false);
  f.policy.lockFree1 = false;
  assert.equal(
    f.invoke("isLockFree", [1]),
    true,
    "embedding mutation cannot change cluster decisions",
  );
  const size = o.createObject<objects.ScriptPropertyKey, unknown>(
    f.realm.objectPrototype,
  );
  let calls = 0;
  builtinProperty(
    size,
    "valueOf",
    o.createCallableObject<objects.ScriptPropertyKey, unknown>(
      f.realm.functionPrototype,
      () => {
        calls++;
        return 8.5;
      },
    ),
    true,
    true,
    f.hooks,
  );
  assert.equal(f.invoke("isLockFree", [size]), true);
  assert.equal(calls, 1);
  const sentinel = {};
  builtinProperty(
    size,
    "valueOf",
    o.createCallableObject<objects.ScriptPropertyKey, unknown>(
      f.realm.functionPrototype,
      () => {
        throw sentinel;
      },
    ),
    true,
    true,
    f.hooks,
  );
  assert.throws(
    () => f.invoke("isLockFree", [size]),
    (error) => error === sentinel,
  );
});
test("pause ignores receiver and arguments without invoking conversions", async () => {
  const f = await fixture();
  let calls = 0;
  const value = o.createObject<objects.ScriptPropertyKey, unknown>(
    f.realm.objectPrototype,
  );
  builtinProperty(
    value,
    "valueOf",
    o.createCallableObject<objects.ScriptPropertyKey, unknown>(
      f.realm.functionPrototype,
      () => {
        calls++;
        throw 42;
      },
    ),
    true,
    true,
    f.hooks,
  );
  assert.equal(f.invoke("pause", [value, Symbol()]), undefined);
  assert.equal(calls, 0);
});
test("realms sharing an agent require consistent target capabilities", async () => {
  const f = await fixture();
  const other = o.createObject<objects.ScriptPropertyKey, unknown>(undefined);
  const realm = o.createErrorRealm(
    other,
    f.hooks,
    f.realm.symbolRegistry,
    f.realm.agent,
  );
  f.api.installAtomicsIntrinsics(other, realm, f.hooks, {
    lockFree1: true,
    lockFree2: true,
    lockFree8: true,
  });
  assert.throws(
    () =>
      f.api.installAtomicsIntrinsics(other, realm, f.hooks, {
        lockFree1: false,
        lockFree2: true,
        lockFree8: true,
      }),
    (error) => error === "ATOMICS_CAPABILITY_MISMATCH",
  );
});

test("isLockFree rejects Symbol and BigInt through the current realm TypeError", async () => {
  const f = await fixture();
  const bigint = o.bigIntFromString("4");
  assert.ok(bigint);
  for (const value of [o.createSymbolValue("size"), bigint])
    assert.throws(
      () => f.invoke("isLockFree", [value]),
      (error) =>
        (error as ObjectValue).prototype === f.realm.prototypes.get("type"),
    );
});

test("integer coercion normalizes signed zero and retains infinities", async () => {
  const f = await fixture();
  const { integerOrInfinity } =
    await import("../packages/js-runtime/src/objects/coercion.ts");
  for (const value of [-0, 0, NaN, -0.1, 0.1])
    assert.equal(
      Object.is(integerOrInfinity(value, f.hooks, f.realm), 0),
      true,
    );
  assert.equal(integerOrInfinity(-Infinity, f.hooks, f.realm), -Infinity);
  assert.equal(integerOrInfinity(Infinity, f.hooks, f.realm), Infinity);
});

async function memoryFixture(
  shared = false,
  initial = 16,
  maximum = initial,
  endian: "little" | "big" = "little",
  canSuspend = false,
  serviceOverride?: SharedBlockService,
) {
  const f = await fixture(undefined, canSuspend);
  o.installArrayBufferIntrinsics(f.root, f.realm, f.hooks);
  o.installTypedArrayIntrinsics(f.root, f.realm, f.hooks, endian);
  const { NodeSharedBlockService } =
    await import("./node-shared-block-service.ts");
  const service = serviceOverride ?? new NodeSharedBlockService();
  if (shared)
    o.installSharedArrayBufferIntrinsics(f.root, f.realm, f.hooks, service);
  const constructor = f.get(
    f.root,
    shared ? "SharedArrayBuffer" : "ArrayBuffer",
  ) as ObjectValue;
  const options = o.createObject<objects.ScriptPropertyKey, unknown>(undefined);
  if (maximum !== initial)
    builtinProperty(options, "maxByteLength", maximum, true, true, f.hooks);
  const buffer = o.constructObject(
    constructor,
    [initial, options],
    { object: constructor, value: constructor },
    undefined,
  ).value as ObjectValue;
  function view(name: string, source = buffer, length?: number) {
    const ctor = f.get(f.root, name) as ObjectValue;
    const args: unknown[] =
      length === undefined ? [source] : [source, 0, length];
    return o.constructObject(
      ctor,
      args,
      { object: ctor, value: ctor },
      undefined,
    ).value as ObjectValue;
  }
  function method(object: ObjectValue, name: string, args: unknown[]) {
    return o.callObject(
      f.get(object, name) as ObjectValue,
      object,
      args,
      undefined,
    ).value;
  }
  function kind(run: () => unknown, type: string) {
    assert.throws(
      run,
      (error) =>
        (error as ObjectValue).prototype === f.realm.prototypes.get(type),
    );
  }
  function numeric(action: () => unknown) {
    const object = o.createObject<objects.ScriptPropertyKey, unknown>(
      f.realm.objectPrototype,
    );
    builtinProperty(
      object,
      "valueOf",
      o.createCallableObject<objects.ScriptPropertyKey, unknown>(
        f.realm.functionPrototype,
        () => action(),
      ),
      true,
      true,
      f.hooks,
    );
    return object;
  }
  return { ...f, buffer, service, view, method, kind, numeric };
}

test("Atomics load/store support ordinary integer views and return the unwrapped converted operand", async () => {
  const f = await memoryFixture();
  const bytes = f.view("Uint8Array");
  assert.equal(f.invoke("store", [bytes, 0, 257.9]), 257);
  assert.equal(f.invoke("load", [bytes, 0]), 1);
  assert.equal(f.invoke("store", [bytes, 1, -257.9]), -257);
  assert.equal(f.invoke("load", [f.view("Int8Array"), 1]), -1);
  assert.equal(f.invoke("store", [bytes, 2, Infinity]), Infinity);
  assert.equal(f.invoke("load", [bytes, 2]), 0);
  assert.equal(Object.is(f.invoke("store", [bytes, 3, -0]), 0), true);
});

test("Atomics shared payloads retain full width and seq-cst order", async () => {
  const f = await memoryFixture(true);
  const words = f.view("Uint32Array");
  const calls: string[] = [];
  const write = f.service.writeUnsigned.bind(f.service),
    read = f.service.readUnsigned.bind(f.service);
  f.service.writeUnsigned = (handle, offset, width, value, order) => {
    calls.push("w" + width + ":" + order);
    return write(handle, offset, width, value, order);
  };
  f.service.readUnsigned = (handle, offset, width, order) => {
    calls.push("r" + width + ":" + order);
    return read(handle, offset, width, order);
  };
  assert.equal(f.invoke("store", [words, 1, 4294967295]), 4294967295);
  assert.equal(f.invoke("load", [f.view("Int32Array"), 1]), -1);
  assert.deepEqual(calls, ["w4:seq-cst", "r4:seq-cst"]);
  const big = f.view("BigUint64Array"),
    value = o.bigIntFromString("340282366920938463463374607431768211455");
  assert.ok(value);
  assert.ok(f.invoke("store", [big, 0, value]) === value);
  assert.equal(
    o.bigIntToString(f.invoke("load", [big, 0]) as objects.BigIntValue, 10),
    "18446744073709551615",
  );
  assert.equal(
    o.bigIntToString(
      f.invoke("load", [f.view("BigInt64Array"), 0]) as objects.BigIntValue,
      10,
    ),
    "-1",
  );
});

test("Atomics rejects invalid and immutable views before index/value coercion", async () => {
  const f = await memoryFixture();
  const log: string[] = [];
  const index = f.numeric(() => {
      log.push("index");
      return 0;
    }),
    value = f.numeric(() => {
      log.push("value");
      return 1;
    });
  for (const name of [
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "Uint8ClampedArray",
  ])
    f.kind(() => f.invoke("store", [f.view(name), index, value]), "type");
  const immutable = f.method(
    f.buffer,
    "transferToImmutable",
    [],
  ) as ObjectValue;
  f.kind(
    () => f.invoke("store", [f.view("Uint8Array", immutable), index, value]),
    "type",
  );
  assert.deepEqual(log, []);
  assert.equal(f.invoke("load", [f.view("Uint8Array", immutable), 0]), 0);
});

test("Atomics captures length before index conversion and revalidates after value conversion", async () => {
  const shared = await memoryFixture(true, 4, 8),
    bytes = shared.view("Uint8Array");
  let values = 0;
  const grow = shared.numeric(() => {
    shared.method(shared.buffer, "grow", [8]);
    return 6;
  });
  shared.kind(
    () =>
      shared.invoke("store", [
        bytes,
        grow,
        shared.numeric(() => {
          values++;
          return 1;
        }),
      ]),
    "range",
  );
  assert.equal(values, 0);
  const f = await memoryFixture(false, 4, 8),
    tracking = f.view("Uint8Array"),
    fixed = f.view("Uint8Array", f.buffer, 4);
  const shrink = f.numeric(() => {
    f.method(f.buffer, "resize", [2]);
    return 1;
  });
  f.kind(() => f.invoke("store", [tracking, 3, shrink]), "range");
  f.method(f.buffer, "resize", [4]);
  f.kind(() => f.invoke("store", [fixed, 3, shrink]), "type");
  f.method(f.buffer, "resize", [4]);
  const sentinel = {};
  const index = f.numeric(() => {
    o.detachArrayBuffer(f.buffer, f.realm);
    return 0;
  });
  assert.throws(
    () =>
      f.invoke("store", [
        tracking,
        index,
        f.numeric(() => {
          throw sentinel;
        }),
      ]),
    (error) => error === sentinel,
  );
});

test("pause dispatches one trusted platform hint without exposing arguments", async () => {
  let hints = 0;
  const f = await fixture(() => {
    hints++;
  });
  assert.equal(
    f.invoke("pause", [
      {
        valueOf() {
          throw 42;
        },
      },
    ]),
    undefined,
  );
  assert.equal(hints, 1);
});

test("compareExchange compares modulo-width bits and returns the old signed value", async () => {
  for (const shared of [false, true]) {
    const f = await memoryFixture(shared),
      view = f.view("Int8Array");
    f.invoke("store", [view, 0, -1]);
    assert.equal(f.invoke("compareExchange", [view, 0, 255, 257]), -1);
    assert.equal(f.invoke("load", [view, 0]), 1);
    assert.equal(f.invoke("compareExchange", [view, 0, -1, 9]), 1);
    assert.equal(f.invoke("load", [view, 0]), 1);
    assert.equal(f.invoke("compareExchange", [view, 0, 257, 257]), 1);
  }
});

test("compareExchange retains exact 64-bit payloads and BigInt modulo semantics", async () => {
  const f = await memoryFixture(true),
    unsigned = f.view("BigUint64Array"),
    signed = f.view("BigInt64Array");
  const all = o.bigIntFromString("18446744073709551615"),
    wide = o.bigIntFromString("340282366920938463463374607431768211455");
  assert.ok(all && wide);
  f.invoke("store", [unsigned, 0, all]);
  const old = f.invoke("compareExchange", [
    signed,
    0,
    wide,
    "9223372036854775808",
  ]) as objects.BigIntValue;
  assert.equal(o.bigIntToString(old, 10), "-1");
  assert.equal(
    o.bigIntToString(
      f.invoke("load", [unsigned, 0]) as objects.BigIntValue,
      10,
    ),
    "9223372036854775808",
  );
});

test("compareExchange converts both operands before revalidating the buffer", async () => {
  const f = await memoryFixture(false, 4, 8),
    view = f.view("Uint8Array", f.buffer, 4);
  const log: string[] = [];
  const index = f.numeric(() => {
    log.push("index");
    return 0;
  });
  const expected = f.numeric(() => {
    log.push("expected");
    f.method(f.buffer, "resize", [0]);
    return 0;
  });
  const replacement = f.numeric(() => {
    log.push("replacement");
    return 1;
  });
  f.kind(
    () => f.invoke("compareExchange", [view, index, expected, replacement]),
    "type",
  );
  assert.deepEqual(log, ["index", "expected", "replacement"]);
  f.method(f.buffer, "resize", [4]);
  log.length = 0;
  const sentinel = {};
  assert.throws(
    () =>
      f.invoke("compareExchange", [
        view,
        index,
        expected,
        f.numeric(() => {
          log.push("replacement");
          throw sentinel;
        }),
      ]),
    (error) => error === sentinel,
  );
  assert.deepEqual(log, ["index", "expected", "replacement"]);
});

test("shared compareExchange never emulates an absent atomic capability using load/store", async () => {
  const f = await memoryFixture(true),
    view = f.view("Uint32Array");
  f.invoke("store", [view, 0, 19]);
  Object.defineProperty(f.service, "atomics", { value: undefined });
  assert.throws(
    () => f.invoke("compareExchange", [view, 0, 19, 42]),
    (error) => error === undefined,
  );
  assert.equal(f.realm.unsupported, true);
  assert.equal(f.invoke("load", [view, 0]), 19);
});

test("atomic RMW operations wrap every integer width and return the prior value", async () => {
  for (const shared of [false, true]) {
    const f = await memoryFixture(shared);
    for (const name of ["Int8Array", "Uint16Array", "Uint32Array"]) {
      const view = f.view(name);
      f.invoke("store", [view, 0, 255]);
      assert.equal(
        f.invoke("exchange", [view, 0, 7]),
        name === "Int8Array" ? -1 : 255,
      );
      assert.equal(f.invoke("add", [view, 0, 3]), 7);
      assert.equal(f.invoke("sub", [view, 0, 11]), 10);
      assert.equal(
        f.invoke("and", [view, 0, 15]),
        name === "Int8Array" ? -1 : name === "Uint16Array" ? 65535 : 4294967295,
      );
      assert.equal(f.invoke("xor", [view, 0, 3]), 15);
      assert.equal(f.invoke("or", [view, 0, 16]), 12);
      assert.equal(f.invoke("load", [view, 0]), 28);
    }
    const big = f.view("BigUint64Array");
    const all = o.bigIntFromString("18446744073709551615")!;
    f.invoke("store", [big, 0, all]);
    assert.equal(
      o.bigIntToString(
        f.invoke("add", [big, 0, "2"]) as objects.BigIntValue,
        10,
      ),
      "18446744073709551615",
    );
    assert.equal(
      o.bigIntToString(f.invoke("load", [big, 0]) as objects.BigIntValue, 10),
      "1",
    );
    f.invoke("sub", [big, 0, "2"]);
    f.invoke("and", [big, 0, "9223372036854775808"]);
    f.invoke("xor", [big, 0, all]);
    f.invoke("or", [big, 0, "9223372036854775808"]);
    assert.equal(
      o.bigIntToString(
        f.invoke("exchange", [big, 0, "0"]) as objects.BigIntValue,
        10,
      ),
      "18446744073709551615",
    );
  }
});

test("atomic RMW retries a competing update without recoercing operands", async () => {
  const f = await memoryFixture(true),
    view = f.view("Uint32Array");
  const atomic = f.service.atomics!;
  let calls = 0,
    conversions = 0;
  Object.defineProperty(f.service, "atomics", {
    value: {
      ...atomic,
      compareExchangeUnsigned(
        handle: number,
        offset: number,
        width: 1 | 2 | 4,
        expected: number,
        replacement: number,
      ) {
        if (calls++ === 0) f.invoke("store", [view, 0, 19]);
        return atomic.compareExchangeUnsigned(
          handle,
          offset,
          width,
          expected,
          replacement,
        );
      },
    },
  });
  assert.equal(
    f.invoke("add", [
      view,
      0,
      f.numeric(() => {
        conversions++;
        return 23;
      }),
    ]),
    19,
  );
  assert.equal(f.invoke("load", [view, 0]), 42);
  assert.equal(conversions, 1);
  assert.equal(calls, 2);
});

test("atomic encoded arithmetic matches modular integer operations across signs and widths", async () => {
  const f = await memoryFixture(true);
  const numeric = [
    new Int8Array(new SharedArrayBuffer(8)),
    new Uint8Array(new SharedArrayBuffer(8)),
    new Int16Array(new SharedArrayBuffer(8)),
    new Uint16Array(new SharedArrayBuffer(8)),
    new Int32Array(new SharedArrayBuffer(8)),
    new Uint32Array(new SharedArrayBuffer(8)),
  ];
  const operations = ["exchange", "add", "sub", "and", "or", "xor"] as const;
  for (const reference of numeric) {
    const view = f.view(reference.constructor.name);
    for (const initial of [-2147483648, -1, 0, 255, 65535, 4294967295]) {
      for (const operand of [
        -4294967297,
        257,
        65537,
        4294967295,
        Infinity,
        NaN,
      ]) {
        for (const operation of operations) {
          Atomics.store(reference, 0, initial);
          f.invoke("store", [view, 0, initial]);
          const expected = Atomics[operation](reference, 0, operand);
          assert.equal(
            f.invoke(operation, [view, 0, operand]),
            expected,
            reference.constructor.name + ":" + operation,
          );
          assert.equal(f.invoke("load", [view, 0]), Atomics.load(reference, 0));
        }
      }
    }
  }
  for (const reference of [
    new BigInt64Array(new SharedArrayBuffer(8)),
    new BigUint64Array(new SharedArrayBuffer(8)),
  ]) {
    const view = f.view(reference.constructor.name);
    for (const initial of [
      -18446744073709551617n,
      -1n,
      0n,
      9223372036854775808n,
      18446744073709551615n,
    ]) {
      for (const operand of [
        -340282366920938463463374607431768211455n,
        -1n,
        1n,
        9223372036854775808n,
      ]) {
        for (const operation of operations) {
          Atomics.store(reference, 0, initial);
          f.invoke("store", [view, 0, initial.toString()]);
          const expected = Atomics[operation](reference, 0, operand);
          assert.equal(
            o.bigIntToString(
              f.invoke(operation, [
                view,
                0,
                operand.toString(),
              ]) as objects.BigIntValue,
              10,
            ),
            expected.toString(),
          );
          assert.equal(
            o.bigIntToString(
              f.invoke("load", [view, 0]) as objects.BigIntValue,
              10,
            ),
            Atomics.load(reference, 0).toString(),
          );
        }
      }
    }
  }
});

test("atomic updates preserve endian-independent carry and borrow across 32-bit halves", async () => {
  for (const endian of ["little", "big"] as const) {
    const f = await memoryFixture(true, 16, 16, endian),
      view = f.view("BigUint64Array");
    f.invoke("store", [view, 0, "4294967295"]);
    f.invoke("add", [view, 0, "1"]);
    assert.equal(
      o.bigIntToString(f.invoke("load", [view, 0]) as objects.BigIntValue, 10),
      "4294967296",
    );
    f.invoke("sub", [view, 0, "4294967297"]);
    assert.equal(
      o.bigIntToString(f.invoke("load", [view, 0]) as objects.BigIntValue, 10),
      "18446744073709551615",
    );
  }
});

test("Word64 retries detect competing high-half changes without recoercion", async () => {
  const f = await memoryFixture(true),
    view = f.view("BigUint64Array"),
    atomic = f.service.atomics!;
  f.invoke("store", [view, 0, "4294967297"]);
  let calls = 0,
    conversions = 0;
  Object.defineProperty(f.service, "atomics", {
    value: {
      ...atomic,
      compareExchangeWord64(
        ...args: Parameters<typeof atomic.compareExchangeWord64>
      ) {
        if (calls++ === 0) f.invoke("store", [view, 0, "8589934593"]);
        return atomic.compareExchangeWord64(...args);
      },
    },
  });
  const old = f.invoke("add", [
    view,
    0,
    f.numeric(() => {
      conversions++;
      return "1";
    }),
  ]) as objects.BigIntValue;
  assert.equal(o.bigIntToString(old, 10), "8589934593");
  assert.equal(
    o.bigIntToString(f.invoke("load", [view, 0]) as objects.BigIntValue, 10),
    "8589934594",
  );
  assert.equal(calls, 2);
  assert.equal(conversions, 1);
});

test("compareExchange revalidates after an expected shrink and replacement regrowth", async () => {
  const f = await memoryFixture(false, 4, 8),
    view = f.view("Uint8Array", f.buffer, 4);
  const expected = f.numeric(() => {
    f.method(f.buffer, "resize", [0]);
    return 0;
  });
  const replacement = f.numeric(() => {
    f.method(f.buffer, "resize", [4]);
    return 42;
  });
  assert.equal(
    f.invoke("compareExchange", [view, 0, expected, replacement]),
    0,
  );
  assert.equal(f.invoke("load", [view, 0]), 42);
});

test("all atomic updates reject missing authority after conversion and before reading payload", async () => {
  for (const operation of ["exchange", "add", "sub", "and", "or", "xor"]) {
    const f = await memoryFixture(true),
      view = f.view("Uint32Array");
    let reads = 0,
      conversions = 0;
    Object.defineProperty(f.service, "atomics", { value: undefined });
    Object.defineProperty(f.service, "readUnsigned", {
      value: () => {
        reads++;
        throw "unexpected read";
      },
    });
    assert.throws(
      () =>
        f.invoke(operation, [
          view,
          0,
          f.numeric(() => {
            conversions++;
            return 1;
          }),
        ]),
      (error) => error === undefined,
    );
    assert.equal(reads, 0);
    assert.equal(conversions, 1);
    assert.equal(f.realm.unsupported, true);
  }
});

test("notify validates waitable views before hooks and returns zero for ordinary backing", async () => {
  const f = await memoryFixture(false, 16, 32),
    int32 = f.view("Int32Array");
  let conversions = 0;
  const count = f.numeric(() => {
    conversions++;
    o.detachArrayBuffer(f.buffer, f.realm);
    return 9;
  });
  assert.equal(f.invoke("notify", [int32, 0, count]), 0);
  assert.equal(conversions, 1);
  const other = await memoryFixture();
  for (const name of [
    "Int8Array",
    "Uint32Array",
    "Float64Array",
    "BigUint64Array",
  ])
    other.kind(
      () =>
        other.invoke("notify", [
          other.view(name),
          other.numeric(() => {
            throw "index";
          }),
          count,
        ]),
      "type",
    );
  const immutable = other.method(
    other.buffer,
    "transferToImmutable",
    [],
  ) as ObjectValue;
  assert.equal(
    other.invoke("notify", [other.view("Int32Array", immutable), 0]),
    0,
  );
});

test("notify delegates shared notifications with converted counts and exact byte locations", async () => {
  const f = await memoryFixture(true),
    view = f.view("BigInt64Array");
  const seen: number[][] = [];
  Object.defineProperty(f.service, "notifications", {
    value: {
      notify(handle: number, offset: number, width: number, count: number) {
        seen.push([handle, offset, width, count]);
        return { ok: true, value: 2 };
      },
    },
  });
  assert.equal(f.invoke("notify", [view, 1, 2.9]), 2);
  assert.equal(f.invoke("notify", [view, 0]), 2);
  assert.equal(seen[0]![1], 8);
  assert.equal(seen[0]![2], 8);
  assert.equal(seen[0]![3], 2);
  assert.equal(seen[1]![3], Infinity);
});

test("shared notify requires real waiter authority even when count is zero", async () => {
  const f = await memoryFixture(true),
    view = f.view("Int32Array");
  Object.defineProperty(f.service, "notifications", { value: undefined });
  for (const count of [0, -0, -1, -Infinity, NaN, 1])
    assert.throws(
      () => f.invoke("notify", [view, 0, count]),
      (error) => error === undefined,
    );
  assert.equal(f.realm.unsupported, true);
});

test("notify reference authority accepts large counts for both waitable widths", async () => {
  const f = await memoryFixture(true);
  for (const name of ["Int32Array", "BigInt64Array"])
    for (const count of [undefined, 0, 1, 1e100, Infinity])
      assert.equal(f.invoke("notify", [f.view(name), 0, count]), 0);
});

test("wait rejects ordinary backing and non-waitable views before index conversion", async () => {
  const f = await memoryFixture();
  const index = f.numeric(() => {
    throw "index must not run";
  });
  for (const method of ["wait", "waitAsync"])
    for (const name of [
      "Int8Array",
      "Uint32Array",
      "BigUint64Array",
      "Int32Array",
      "BigInt64Array",
    ])
      f.kind(() => f.invoke(method, [f.view(name), index, 0, 0]), "type");
});

test("disallowed sync wait converts operands in order before the suspension check", async () => {
  const f = await memoryFixture(true),
    view = f.view("Int32Array"),
    events: string[] = [];
  const index = f.numeric(() => {
    events.push("index");
    return 0;
  });
  const expected = f.numeric(() => {
    events.push("expected");
    return 1;
  });
  const timeout = f.numeric(() => {
    events.push("timeout");
    return 0;
  });
  Object.defineProperty(f.service, "readUnsigned", {
    value: () => {
      throw "must not read payload";
    },
  });
  f.kind(() => f.invoke("wait", [view, index, expected, timeout]), "type");
  assert.deepEqual(events, ["index", "expected", "timeout"]);
  events.length = 0;
  const sentinel = {};
  assert.throws(
    () =>
      f.invoke("wait", [
        view,
        index,
        expected,
        f.numeric(() => {
          throw sentinel;
        }),
      ]),
    (error) => error === sentinel,
  );
  assert.deepEqual(events, ["index", "expected"]);
  assert.equal(f.realm.unsupported, false);
});

test("async wait that must park requires genuine waiter authority", async () => {
  const f = await memoryFixture(true),
    view = f.view("BigInt64Array");
  assert.throws(
    () => f.invoke("waitAsync", [view, 0, "0", Infinity]),
    (error) => error === undefined,
  );
  assert.equal(f.realm.unsupported, true);
});

test("immediate waits normalize expected words and distinguish mismatch before zero timeout", async () => {
  for (const endian of ["little", "big"] as const) {
    const f = await memoryFixture(true, 16, 16, endian, true),
      view = f.view("Int32Array");
    f.invoke("store", [view, 0, -1]);
    assert.equal(
      f.invoke("wait", [view, 0, 4294967295, -Infinity]),
      "timed-out",
    );
    assert.equal(f.invoke("wait", [view, 0, 1, 0]), "not-equal");
    assert.equal(f.invoke("wait", [view, 0, 1, NaN]), "not-equal");
    const big = f.view("BigInt64Array");
    f.invoke("store", [big, 0, "-1"]);
    assert.equal(
      f.invoke("wait", [big, 0, "18446744073709551615", -1]),
      "timed-out",
    );
    assert.equal(f.invoke("wait", [big, 0, "0", Infinity]), "not-equal");
    assert.equal(f.realm.unsupported, false);
  }
});
test("immediate waitAsync returns fresh method-realm ordinary objects without parking", async () => {
  const f = await memoryFixture(true),
    view = f.view("Int32Array");
  const a = f.invoke("waitAsync", [view, 0, 1, Infinity]) as ObjectValue;
  const b = f.invoke("waitAsync", [view, 0, 0, -0]) as ObjectValue;
  assert.equal(a.prototype, f.realm.objectPrototype);
  assert.notEqual(a, b);
  assert.equal(f.get(a, "async"), false);
  assert.equal(f.get(a, "value"), "not-equal");
  assert.equal(f.get(b, "value"), "timed-out");
  for (const key of ["async", "value"]) {
    const descriptor = o.getOwnProperty(a, key)!;
    assert.equal(descriptor.writable, true);
    assert.equal(descriptor.enumerable, true);
    assert.equal(descriptor.configurable, true);
  }
  assert.equal(f.realm.unsupported, false);
});
test("wait observes the shared word after index, expected and timeout coercions exactly once", async () => {
  const f = await memoryFixture(true, 16, 16, "little", true),
    view = f.view("Int32Array"),
    events: string[] = [];
  const read = f.service.readUnsigned.bind(f.service);
  f.service.readUnsigned = (handle, offset, width, order) => {
    events.push("read:" + order);
    return read(handle, offset, width, order);
  };
  const index = f.numeric(() => {
    events.push("index");
    return 0;
  });
  const expected = f.numeric(() => {
    events.push("expected");
    return 19;
  });
  const timeout = f.numeric(() => {
    events.push("timeout");
    f.invoke("store", [view, 0, 19]);
    return 0;
  });
  assert.equal(f.invoke("wait", [view, index, expected, timeout]), "timed-out");
  assert.deepEqual(events, ["index", "expected", "timeout", "read:seq-cst"]);
});

test("synchronous native waiting rechecks spurious wakes and returns only a notified terminal result", async () => {
  const { NodeSharedMemoryHost } = await import("./node-shared-memory-host.ts");
  const { createNativeSharedBlockService } =
    await import("@tint/native-runtime/shared-blocks");
  const host = new NodeSharedMemoryHost();
  let now = 0,
    parks = 0;
  let service: SharedBlockService | undefined;
  const created = createNativeSharedBlockService(
    host,
    { pageSize: 16384, maxBlocks: 8, maxReservedBytes: 262144 },
    host,
    {
      parking: {
        park: () => {
          parks++;
          now++;
          if (parks === 2) {
            const notified = service?.notifications?.notify(1, 0, 4, 1);
            assert.deepEqual(notified, { ok: true, value: 1 });
          }
          return 0;
        },
        wake: () => 0,
      },
      now: () => now,
      maxWaiters: 4,
    },
  );
  assert.ok(created.ok);
  service = created.value;
  const f = await memoryFixture(true, 16, 16, "little", true, service);
  assert.equal(f.invoke("wait", [f.view("Int32Array"), 0, 0, 100]), "ok");
  assert.equal(parks, 2);
  assert.equal(f.realm.unsupported, false);
});
test("synchronous waiting uses a monotonic deadline and exact wrapped BigInt expected words", async () => {
  const { NodeSharedMemoryHost } = await import("./node-shared-memory-host.ts");
  const { createNativeSharedBlockService } =
    await import("@tint/native-runtime/shared-blocks");
  const host = new NodeSharedMemoryHost();
  let now = 10;
  const durations: number[] = [];
  const created = createNativeSharedBlockService(
    host,
    { pageSize: 16384, maxBlocks: 8, maxReservedBytes: 262144 },
    host,
    {
      parking: {
        park: (_address, _expected, duration) => {
          durations.push(duration);
          now = 11;
          return 0;
        },
        wake: () => 0,
      },
      now: () => now,
      maxWaiters: 4,
    },
  );
  assert.ok(created.ok);
  const f = await memoryFixture(true, 16, 16, "little", true, created.value);
  assert.equal(
    f.invoke("wait", [f.view("BigInt64Array"), 0, "18446744073709551616", 0.5]),
    "timed-out",
  );
  assert.deepEqual(durations, [500000]);
  assert.equal(f.realm.unsupported, false);
});

test("a rejected host clock releases its registration before another wait", async () => {
  const { NodeSharedMemoryHost } = await import("./node-shared-memory-host.ts");
  const { createNativeSharedBlockService } =
    await import("@tint/native-runtime/shared-blocks");
  const host = new NodeSharedMemoryHost();
  let bad = true;
  let service: SharedBlockService | undefined;
  const made = createNativeSharedBlockService(
    host,
    { pageSize: 16384, maxBlocks: 8, maxReservedBytes: 262144 },
    host,
    {
      parking: {
        park: () => {
          assert.deepEqual(service?.notifications?.notify(1, 0, 4, 1), {
            ok: true,
            value: 1,
          });
          return 0;
        },
        wake: () => 0,
      },
      now: () => (bad ? NaN : 0),
      maxWaiters: 1,
    },
  );
  assert.ok(made.ok);
  service = made.value;
  const f = await memoryFixture(true, 16, 16, "little", true, service),
    view = f.view("Int32Array");
  assert.throws(
    () => f.invoke("wait", [view, 0, 0, 1]),
    (error) => error === "ATOMIC_WAIT_CLOCK_INVARIANT",
  );
  bad = false;
  assert.equal(f.invoke("wait", [view, 0, 0, 1]), "ok");
});

async function asynchronousWaitFixture() {
  const { NodeSharedMemoryHost } = await import("./node-shared-memory-host.ts");
  const { createNativeSharedBlockService } =
    await import("@tint/native-runtime/shared-blocks");
  const host = new NodeSharedMemoryHost();
  let now = 0;
  const created = createNativeSharedBlockService(
    host,
    { pageSize: 16384, maxBlocks: 8, maxReservedBytes: 262144 },
    host,
    {
      parking: { park: () => 0, wake: () => 0 },
      now: () => now,
      maxWaiters: 8,
    },
  );
  assert.ok(created.ok);
  const f = await memoryFixture(true, 16, 16, "little", false, created.value);
  o.installPromiseIntrinsics(f.root, f.realm, f.hooks, () => {});
  return {
    ...f,
    service: created.value,
    setNow: (value: number) => {
      now = value;
    },
  };
}
test("positive waitAsync installs an owner-local intrinsic Promise and same-agent notify resolves it synchronously", async () => {
  const f = await asynchronousWaitFixture(),
    view = f.view("Int32Array");
  const result = f.invoke("waitAsync", [view, 0, 0, Infinity]) as ObjectValue;
  assert.equal(f.get(result, "async"), true);
  const promise = f.get(result, "value") as ObjectValue;
  assert.equal(promise.prototype, f.realm.promisePrototype);
  assert.equal(promise.internalPromiseData?.state, "pending");
  assert.equal(f.invoke("notify", [view, 0, 1]), 1);
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
  assert.equal(promise.internalPromiseData?.result, "ok");
});
test("an unrelated same-agent notify does not synchronously resolve an externally notified Promise", async () => {
  const f = await asynchronousWaitFixture(),
    view = f.view("Int32Array");
  const result = f.invoke("waitAsync", [view, 0, 0, Infinity]) as ObjectValue;
  const promise = f.get(result, "value") as ObjectValue;
  assert.deepEqual(f.service.notifications?.notify(1, 0, 4, 1), {
    ok: true,
    value: 1,
  });
  assert.equal(f.invoke("notify", [view, 2, 1]), 0);
  assert.equal(promise.internalPromiseData?.state, "pending");
  const { processAtomicWaitEvents } =
    await import("../packages/js-runtime/src/objects/atomics-wait.ts");
  assert.equal(processAtomicWaitEvents(f.realm.agent, true), 1);
  assert.equal(promise.internalPromiseData?.state, "fulfilled");
});
test("external waitAsync completions preserve notification order across locations and enqueue reactions on the owner", async () => {
  const f = await asynchronousWaitFixture(),
    view = f.view("Int32Array"),
    events: string[] = [];
  const a = f.invoke("waitAsync", [view, 0, 0, Infinity]) as ObjectValue;
  const b = f.invoke("waitAsync", [view, 2, 0, Infinity]) as ObjectValue;
  for (const [name, result] of [
    ["a", a],
    ["b", b],
  ] as const) {
    const promise = f.get(result, "value") as ObjectValue;
    const callback = o.createCallableObject<objects.ScriptPropertyKey, unknown>(
      f.realm.functionPrototype,
      () => {
        events.push(name);
        return undefined;
      },
    );
    const called = o.callObject(
      f.get(promise, "then") as ObjectValue,
      promise,
      [callback],
      undefined,
    );
    assert.equal(called.error, "none");
  }
  f.service.notifications?.notify(1, 8, 4, 1);
  f.service.notifications?.notify(1, 0, 4, 1);
  const { processAtomicWaitEvents } =
    await import("../packages/js-runtime/src/objects/atomics-wait.ts");
  assert.equal(processAtomicWaitEvents(f.realm.agent, true), 2);
  assert.deepEqual(events, []);
  o.drainScriptJobs(f.realm.agent, (error) => {
    throw error;
  });
  assert.deepEqual(events, ["b", "a"]);
});
test("owner timeout processing settles once and removes the waiter before a later notification", async () => {
  const f = await asynchronousWaitFixture(),
    view = f.view("Int32Array");
  const result = f.invoke("waitAsync", [view, 0, 0, 0.5]) as ObjectValue,
    promise = f.get(result, "value") as ObjectValue;
  const { processAtomicWaitEvents } =
    await import("../packages/js-runtime/src/objects/atomics-wait.ts");
  assert.equal(processAtomicWaitEvents(f.realm.agent, true), 0);
  f.setNow(1);
  assert.equal(processAtomicWaitEvents(f.realm.agent, true), 1);
  assert.equal(promise.internalPromiseData?.result, "timed-out");
  assert.equal(f.invoke("notify", [view, 0, 1]), 0);
  assert.equal(processAtomicWaitEvents(f.realm.agent, true), 0);
  assert.equal(f.realm.agent.pendingAtomicWaits.length, 0);
});

test("continuous Promise jobs do not starve owner waitAsync timeouts", async () => {
  const f = await asynchronousWaitFixture();
  const result = f.invoke("waitAsync", [
    f.view("Int32Array"),
    0,
    0,
    1,
  ]) as ObjectValue;
  const promise = f.get(result, "value") as ObjectValue;
  const events: string[] = [];
  const reaction = o.createCallableObject<objects.ScriptPropertyKey, unknown>(
    f.realm.functionPrototype,
    () => {
      events.push("reaction");
      return undefined;
    },
  );
  assert.equal(
    o.callObject(
      f.get(promise, "then") as ObjectValue,
      promise,
      [reaction],
      undefined,
    ).error,
    "none",
  );
  let polls = 0;
  function poll(): void {
    polls++;
    events.push("poll" + polls);
    f.setNow(polls);
    if (promise.internalPromiseData?.state === "pending" && polls < 5)
      o.enqueueScriptJob(f.realm.agent, poll, undefined);
  }
  o.enqueueScriptJob(f.realm.agent, poll, undefined);
  o.enqueueScriptJob(
    f.realm.agent,
    () => {
      events.push("queued");
    },
    undefined,
  );
  const { processAtomicWaitEvents } =
    await import("../packages/js-runtime/src/objects/atomics-wait.ts");
  o.drainScriptJobs(
    f.realm.agent,
    (error) => {
      throw error;
    },
    () => {
      assert.equal(f.realm.agent.activeContext, undefined);
      processAtomicWaitEvents(f.realm.agent, true);
    },
  );
  assert.equal(
    polls,
    2,
    "a live Promise queue must not defer owner events until quiescence",
  );
  assert.deepEqual(events, ["poll1", "queued", "poll2", "reaction"]);
  assert.equal(promise.internalPromiseData?.result, "timed-out");
  assert.equal(f.realm.agent.pendingAtomicWaits.length, 0);
});

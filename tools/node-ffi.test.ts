import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { withDynamicLibrary } from "./native-dynamic-fixtures.ts";
import type { NativeHostBinding } from "@tint/compiler/native";

function source(library: string, generic: boolean): string {
  return `
import ffi, { DynamicLibrary, dlclose, dlopen, dlsym, types } from "node:ffi";
export function run() {
  if (ffi.dlopen !== dlopen || ffi.DynamicLibrary !== DynamicLibrary ||
      ffi.types !== types || Object.getPrototypeOf(types) !== null ||
      !Object.isFrozen(types) || types.INT_64 !== "int64") return 1;
  const empty = dlopen(null);
  if (empty.lib.path !== "" || Object.getPrototypeOf(empty.functions) !== null ||
      !Object.isFrozen(empty.functions)) return 2;
  dlclose(empty.lib);
  const path = ${JSON.stringify(library)};
  const lib = new DynamicLibrary(path);
  const trace = [];
  const inherited = { return: "uint64", arguments: ["uint64"] };
  const signature = new Proxy(Object.create(inherited), {
    has(target, key) { trace.push("has:" + key); return Reflect.has(target, key); },
    get(target, key, receiver) { trace.push("get:" + key); return Reflect.get(target, key, receiver); },
  });
  const keys = [];
  const definitions = new Proxy(Object.defineProperty({ echo_u64: signature }, "ignored", {
    get() { throw new Error("non-enumerable definitions are ignored"); },
  }), {
    ownKeys(target) { keys.push("keys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      keys.push("descriptor:" + key); return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get(target, key, receiver) { keys.push("get:" + key); return Reflect.get(target, key, receiver); },
  });
  const table = lib.getFunctions(definitions);
  const call = table.echo_u64;
  if (keys.join(",") !== "keys,descriptor:echo_u64,descriptor:ignored,get:echo_u64" ||
      trace.join(",") !== "has:return,has:arguments,get:return,get:arguments") return 3;
  if (Object.getPrototypeOf(table) !== null || table === lib.functions ||
      lib.functions.echo_u64 !== call ||
      lib.getFunction("echo_u64", { return: "u64", arguments: ["u64"] }) !== call) return 4;
  if (call.name !== "echo_u64" || Object.hasOwn(call, "prototype")) return 5;
  ${generic ? "if (call.length !== 0) return 6;" : ""}
  const address = dlsym(lib, "echo_u64");
  const descriptor = Object.getOwnPropertyDescriptor(call, "pointer");
  if (typeof address !== "bigint" || address !== descriptor.value ||
      address !== lib.symbols.echo_u64 || !descriptor.writable ||
      !descriptor.enumerable || !descriptor.configurable) return 7;
  call.pointer = 0n;
  call.tag = "live";
  if (call.call(new Object(), 18446744073709551614n) !== 18446744073709551615n ||
      call(41) !== 42n || lib.functions.echo_u64.tag !== "live") return 8;
  try {
    lib.getFunctions({ u64_max: { return: "uint64" }, i64_min: { return: undefined } });
    return 9;
  } catch (error) {
    if (!(error instanceof TypeError) || error.code !== "ERR_INVALID_ARG_TYPE") return 9;
  }
  if (Object.hasOwn(lib.symbols, "u64_max")) return 10;
  const marker = {};
  try { lib.getFunction("echo_u64", { get return() { throw marker; } }); return 11; }
  catch (error) { if (error !== marker) return 11; }
  lib[Symbol.dispose]();
  lib.close();
  if (lib.path !== path) return 12;
  try { call(0n); return 13; }
  catch (error) {
    if (error.code !== "ERR_FFI_LIBRARY_CLOSED" || error.message !== "Library is closed") return 13;
  }
  return 42;
}`;
}

const oracle =
  process.env.NODE26 ??
  (process.version === "v26.13.1" ? process.execPath : "");
function runOracle(text: string): void {
  const result = spawnSync(
    oracle,
    [
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      text +
        '\nif(process.version!=="v26.13.1")throw new Error(process.version); process.exitCode=run();',
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 42, result.error?.message ?? result.stderr);
}

test(
  "the Node FFI scalar fixture agrees with the pinned reference",
  { skip: oracle === "" ? "Node 26.13.1 reference unavailable" : false },
  () => {
    const checked = withDynamicLibrary((library) => {
      runOracle(source(library, false));
      return true;
    });
    assert.ok(checked, "clang is required");
  },
);

test("node:ffi binds and calls a shared-library symbol natively", () => {
  const result = withDynamicLibrary((library) => {
    let general: readonly string[] | undefined;
    const path = verifyHostedFixture(
      source(library, true),
      "node-ffi-scalar",
      [["node:ffi", "packages/native-runtime/src/node/ffi.ts"]],
      [],
      [],
      [],
      {
        onGeneralFallback(modules) {
          general = modules;
        },
        managedBytes: 67108864,
        allocationCapacity: 1048576,
      },
    );
    assert.deepEqual(general, ["fixture"]);
    return path;
  });
  assert.ok(result, "clang is required");
});

const memorySource = `
import ffi from "node:ffi";
import { Buffer } from "node:buffer";
export function run() {
  const { lib, functions } = ffi.dlopen(null, {
    malloc: { return: "pointer", arguments: ["uint64"] },
    free: { arguments: ["pointer"] },
  });
  const pointer = functions.malloc(64n);
  if (pointer === 0n) return 1;
  try {
    ffi.setUint64(pointer, 1, 0xfedcba9876543210n);
    ffi.setInt64(pointer, 9, -0x8000000000000000n);
    ffi.setFloat32(pointer, 17, 0.1);
    ffi.setFloat64(pointer, 21, -0);
    if (ffi.getUint64(pointer, 1) !== 0xfedcba9876543210n ||
        ffi.getInt64(pointer, 9) !== -0x8000000000000000n ||
        ffi.getFloat32(pointer, 17) !== Math.fround(0.1) ||
        !Object.is(ffi.getFloat64(pointer, 21), -0)) return 2;
    ffi.exportString("A", pointer, 8, "UCS-2");
    const copy = ffi.toBuffer(pointer, 4);
    if (!Buffer.isBuffer(copy) || copy.toString("hex") !== "41000000") return 3;
    const view = ffi.toBuffer(pointer, 8, false);
    const adopted = ffi.toArrayBuffer(pointer, 8, false);
    if (Object.getPrototypeOf(adopted) !== ArrayBuffer.prototype ||
        !Buffer.isBuffer(view) || ffi.getRawPointer(view.subarray(2)) !== pointer + 2n) return 4;
    new Uint8Array(adopted)[0] = 42;
    if (view[0] !== 42 || copy[0] !== 65 || ffi.getUint8(pointer) !== 42) return 5;
    ffi.exportBuffer(Buffer.from([1, 2, 3, 4, 5, 6]), pointer, 6);
    ffi.exportArrayBufferView(view.subarray(1, 4), pointer + 2n, 4);
    if (view[0] !== 1 || view[2] !== 2 || view[3] !== 3 || view[4] !== 4 || view[5] !== 6) return 6;
    const bytes = Buffer.from([9, 8, 7, 6]);
    const alias = bytes.subarray(1, 3);
    const address = ffi.getRawPointer(bytes);
    if (ffi.getRawPointer(alias) !== address + 1n) return 7;
    ffi.setUint8(address, 1, 42);
    if (bytes[1] !== 42 || alias[0] !== 42) return 8;
    if (ffi.toBuffer(0n, 0).length !== 0 || ffi.toString(0n) !== null) return 9;
    ffi.setUint8(pointer, 0, 0xc0);
    ffi.setUint8(pointer, 1, 0);
    if (ffi.toString(pointer) !== "�") return 10;
    try { ffi.getUint16(0xffffffffffffffffn); return 11; }
    catch (error) { if (!(error instanceof TypeError) || error.code !== "ERR_INVALID_ARG_VALUE") return 11; }
    try { ffi.toBuffer(1n, 2 ** 50); return 12; }
    catch (error) { if (!(error instanceof RangeError) || error.code !== "ERR_MEMORY_ALLOCATION_FAILED") return 12; }
    return 42;
  } finally {
    functions.free(pointer);
    lib.close();
  }
}`;

test(
  "the Node FFI memory fixture agrees with the pinned reference",
  { skip: oracle === "" ? "Node 26.13.1 reference unavailable" : false },
  () => runOracle(memorySource),
);

test("node:ffi lends and adopts native memory without losing byte aliases", () => {
  verifyHostedFixture(
    memorySource,
    "node-ffi-memory",
    [
      ["node:ffi", "packages/native-runtime/src/node/ffi.ts"],
      ["node:buffer", "packages/native-runtime/src/node/buffer.ts"],
    ],
    [],
    [],
    [],
    { managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});

const wideIntegers = 76;
const wideFloats = 9;
const widePointers = 17;
const names = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => prefix + index);
const integers = names("i", wideIntegers);
const floats = names("f", wideFloats);
const pointers = names("p", widePointers);
const wideLibrary = `
uint64_t tint_wide(${[
  ...integers.map((name) => "uint64_t " + name),
  ...floats.map((name) => "double " + name),
  ...pointers.map((name) => "uint8_t *" + name),
].join(",")}) {
  uint64_t checksum = 0;
  ${integers.map((name, index) => `checksum += ${name} * ${index + 1};`).join("\n")}
  ${floats.map((name) => `checksum += (uint64_t)(${name} * 4);`).join("\n")}
  ${pointers.map((name) => `checksum += *${name}; *${name} += 3;`).join("\n")}
  return checksum;
}
`;
function wideSource(library: string): string {
  return `
import { dlopen } from "node:ffi";
export function run() {
  const types = [];
  const values = [];
  let expected = 0n;
  const bytes = new Uint8Array(${widePointers});
  for (let i = 1; i <= ${wideIntegers}; i++) {
    types.push("uint64");
    const value = 9007199254740993n + BigInt(i);
    values.push(value);
    expected += BigInt(i) * value;
  }
  for (let i = 1; i <= ${wideFloats}; i++) {
    types.push("double");
    values.push(i + 0.25);
    expected += BigInt(i * 4 + 1);
  }
  for (let i = 0; i < bytes.length; i++) {
    types.push("pointer");
    bytes[i] = i;
    values.push(bytes.subarray(i));
    expected += BigInt(i);
  }
  const { lib, functions } = dlopen(${JSON.stringify(library)}, {
    tint_wide: { arguments: types, return: "uint64" }
  });
  try {
    if (functions.tint_wide(...values) !== (expected & 0xffffffffffffffffn)) return 1;
    for (let i = 0; i < bytes.length; i++)
      if (bytes[i] !== i + 3) return 2;
    if (functions.tint_wide(...values) !== ((expected + BigInt(bytes.length * 3)) & 0xffffffffffffffffn)) return 3;
    return 42;
  } finally {
    lib.close();
  }
}`;
}
test(
  "the wide call fixture agrees with the pinned Node reference",
  { skip: oracle === "" ? "Node 26.13.1 reference unavailable" : false },
  () =>
    assert.ok(
      withDynamicLibrary((library) => {
        runOracle(wideSource(library));
        return true;
      }, wideLibrary),
      "clang is required",
    ),
);
test("node:ffi calls a wide scalar signature with many borrowed views", () => {
  assert.ok(
    withDynamicLibrary(
      (library) =>
        verifyHostedFixture(
          wideSource(library),
          "node-ffi-wide-call",
          [["node:ffi", "packages/native-runtime/src/node/ffi.ts"]],
          [],
          [],
          [],
          { managedBytes: 67108864, allocationCapacity: 1048576 },
        ),
      wideLibrary,
    ),
    "clang is required",
  );
});

const callbackLibrary = `
typedef uint64_t (*TintCallback)(uint64_t, double, uint8_t *, uint64_t,
                               uint64_t, uint64_t, uint64_t, uint64_t,
                               uint64_t, uint64_t, uint64_t);
static TintCallback saved_callback;
void tint_store_callback(TintCallback callback) { saved_callback = callback; }
uint64_t tint_invoke_saved(uint64_t level, uint8_t *bytes) {
  return saved_callback(level, 0.5, bytes, 7, 11, 13, 17, 19, 23, 29,
                        UINT64_C(0xfedcba9876543210));
}
void tint_invoke_void(void (*callback)(void)) { callback(); }
`;

function callbacksSource(library: string): string {
  return `
import ffi from "node:ffi";
export function run() {
  const path = ${JSON.stringify(library)};
  const { lib, functions } = ffi.dlopen(path, {
    tint_store_callback: { arguments: ["function"] },
    tint_invoke_saved: { arguments: ["uint64", "buffer"], return: "uint64" },
    tint_invoke_void: { arguments: ["function"] },
  });
  const separateOwner = new ffi.DynamicLibrary(path);
  try {
    let visits = 0;
    const voidCallbacks = [];
    for (let i = 0; i < 24; i++) {
      voidCallbacks.push(separateOwner.registerCallback(() => { visits += i; return 123; }));
    }
    functions.tint_invoke_void(voidCallbacks[0]);
    functions.tint_invoke_void(voidCallbacks[23]);
    if (visits !== 23) return 1;
    try { lib.unregisterCallback(voidCallbacks[0]); return 2; }
    catch (error) { if (error.code !== "ERR_INVALID_ARG_VALUE") return 2; }
    for (let i = 0; i < voidCallbacks.length; i++)
      separateOwner.unregisterCallback(voidCallbacks[i]);

    const callbacks = separateOwner;
    const bytes = new Uint8Array([0, 8, 0]);
    const alias = bytes.subarray(1);
    const signature = {
      arguments: ["uint64", "double", "pointer", "uint64", "uint64", "uint64",
                  "uint64", "uint64", "uint64", "uint64", "uint64"],
      return: "uint64",
    };
    function callback(level, fraction, pointer, a0, a1, a2, a3, a4, a5, a6, wide) {
      if (this !== undefined || fraction !== 0.5 || pointer !== ffi.getRawPointer(alias) ||
          ffi.getUint8(pointer) !== bytes[1] ||
          a0 + a1 + a2 + a3 + a4 + a5 + a6 !== 119n ||
          wide !== 0xfedcba9876543210n) throw new Error("callback ABI");
      ffi.setUint8(pointer, 0, bytes[1] + 1);
      return level === 0n ? wide : functions.tint_invoke_saved(level - 1n, alias) + 1n;
    }
    const pointer = callbacks.registerCallback(signature, callback);
    callbacks.unrefCallback(pointer);
    callbacks.refCallback(pointer);
    // C stores the pointer in a previous call. The invocation does not
    // take a callback argument and runs from a different library owner.
    functions.tint_store_callback(pointer);
    if (functions.tint_invoke_saved(2n, alias) !== 0xfedcba9876543212n ||
        bytes[1] !== 11) return 3;
    callbacks.unregisterCallback(pointer);
    try { callbacks.refCallback(pointer); return 4; }
    catch (error) { if (error.code !== "ERR_INVALID_ARG_VALUE") return 4; }
    return 42;
  } finally {
    separateOwner.close();
    lib.close();
  }
}`;
}

test(
  "the callback fixture agrees with the pinned Node reference",
  { skip: oracle === "" ? "Node 26.13.1 reference unavailable" : false },
  () =>
    assert.ok(
      withDynamicLibrary((library) => {
        runOracle(callbacksSource(library));
        return true;
      }, callbackLibrary),
      "clang is required",
    ),
);

test("node:ffi registers runtime signatures without a fixed callback pool", () => {
  assert.ok(
    withDynamicLibrary(
      (library) =>
        verifyHostedFixture(
          callbacksSource(library),
          "node-ffi-registered-callbacks",
          [["node:ffi", "packages/native-runtime/src/node/ffi.ts"]],
          [],
          [],
          [],
          {
            allowJit: true,
            managedBytes: 67108864,
            allocationCapacity: 1048576,
          },
        ),
      callbackLibrary,
    ),
    "clang is required",
  );
});

test("node:ffi lends the mapped span of a shared ArrayBuffer view", (context) => {
  const previous = process.env.TINT_GENERAL_FALLBACK;
  process.env.TINT_GENERAL_FALLBACK = "0";
  context.after(() => {
    if (previous === undefined) delete process.env.TINT_GENERAL_FALLBACK;
    else process.env.TINT_GENERAL_FALLBACK = previous;
  });

  const memory = "packages/native-runtime/src/intrinsics/memory.ts";
  const atomics = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
  const hostBindings: readonly NativeHostBinding[] = [
    { module: memory, name: "mapMemory", operation: "memory-map" },
    { module: memory, name: "unmapMemory", operation: "memory-unmap" },
    {
      module: atomics,
      name: "readSharedUnsigned",
      operation: "shared-read-unsigned",
    },
    {
      module: atomics,
      name: "writeSharedUnsigned",
      operation: "shared-write-unsigned",
    },
    {
      module: atomics,
      name: "readSharedWord64",
      operation: "shared-read-word64",
    },
    {
      module: atomics,
      name: "writeSharedWord64",
      operation: "shared-write-word64",
    },
    {
      module: atomics,
      name: "compareExchangeSharedWord64",
      operation: "shared-compare-exchange-word64",
    },
  ];
  verifyHostedFixture(
    `import ffi from "node:ffi";
import { createNativeSharedBlockService, nativeSharedMemoryHost } from "shared";
import {
  callObjectValueOrThrow, constructObjectValueOrThrow, createArrayFromList,
  createDataProperty, createObject, getObjectValuePropertyOrThrow,
  installProgramArrayIntrinsics, installProgramTypedArrayIntrinsics,
  installSharedArrayBufferIntrinsics, programRealmCore, type ScriptPropertyKey,
} from "objects";
export function run(): number {
  const native = createNativeSharedBlockService(
    nativeSharedMemoryHost(), { pageSize: 16384, maxBlocks: 16, maxReservedBytes: 262144 },
  );
  if (!native.ok) return 1;
  const core = programRealmCore(), realm = core.realm, hooks = core.hooks;
  installSharedArrayBufferIntrinsics(core.object, realm, hooks, native.value);
  installProgramArrayIntrinsics(core);
  installProgramTypedArrayIntrinsics(core);
  function get(receiver: unknown, property: string): unknown {
    return getObjectValuePropertyOrThrow(receiver, property, hooks, realm);
  }
  function call(receiver: unknown, property: string, args: readonly unknown[]): unknown {
    return callObjectValueOrThrow(get(receiver, property), receiver, args, core.object, realm);
  }
  function make(name: string, args: readonly unknown[]): unknown {
    const ctor = get(core.object, name);
    return constructObjectValueOrThrow(realm, ctor, args, core.object);
  }
  const shared = make("SharedArrayBuffer", [16]);
  const view = make("Uint8Array", [shared, 4, 3]);
  const base = call(ffi, "getRawPointer", [shared]);
  const pointer = call(ffi, "getRawPointer", [view]);
  if (typeof base !== "bigint" || typeof pointer !== "bigint" || pointer !== base + 4n) return 2;
  const signature = createObject<ScriptPropertyKey, unknown>(realm.objectPrototype);
  const definitions = createObject<ScriptPropertyKey, unknown>(undefined);
  const args = createArrayFromList(["pointer", "int32", "uint64"], 0, realm.arrayPrototype, realm, hooks);
  createDataProperty<ScriptPropertyKey, unknown>(signature, "arguments", args, hooks);
  createDataProperty<ScriptPropertyKey, unknown>(signature, "return", "pointer", hooks);
  createDataProperty<ScriptPropertyKey, unknown>(definitions, "memset", signature, hooks);
  const opened = call(ffi, "dlopen", [null, definitions]);
  const lib = get(opened, "lib"), functions = get(opened, "functions");
  const result = call(functions, "memset", [view, 42, 3n]);
  try {
    if (typeof result !== "bigint" || result !== pointer || get(view, "0") !== 42 || get(view, "2") !== 42)
      return 3;
    call(ffi, "exportArrayBufferView", [view, base, 3]);
    const original = make("Uint8Array", [shared]);
    if (get(original, "0") !== 42 || get(original, "2") !== 42 || get(original, "3") !== 0) return 4;
    return 42;
  } finally { call(lib, "close", []); }
}`,
    "node-ffi-shared-span",
    [
      ["node:ffi", "packages/native-runtime/src/node/ffi.ts"],
      ["shared", "packages/native-runtime/src/shared-blocks.ts"],
      ["objects", "packages/js-runtime/src/objects/index.ts"],
    ],
    [],
    [],
    [
      {
        module: atomics,
        namespace: "node-ffi-shared-fixture",
        retainedExports: hostBindings
          .filter((entry) => entry.module === atomics)
          .map((entry) => entry.name),
      },
    ],
    {
      requireTyped: true,
      runtimeEntry: "initializeCopyingRuntime",
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      hostBindings,
    },
  );
});

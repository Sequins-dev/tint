import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { withDynamicLibrary } from "./native-dynamic-fixtures.ts";

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

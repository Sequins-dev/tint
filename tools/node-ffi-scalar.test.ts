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
test(
  "the Node FFI scalar fixture agrees with the pinned reference",
  { skip: oracle === "" ? "Node 26.13.1 reference unavailable" : false },
  () => {
    const result = withDynamicLibrary((library) =>
      spawnSync(
        oracle,
        [
          "--disable-warning=ExperimentalWarning",
          "--input-type=module",
          "-e",
          source(library, false) +
            '\nif(process.version!=="v26.13.1")throw new Error(process.version); process.exitCode=run();',
        ],
        { encoding: "utf8" },
      ),
    );
    assert.ok(result, "clang is required");
    assert.equal(result.status, 42, result.error?.message ?? result.stderr);
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

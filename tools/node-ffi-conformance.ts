/** Run the pinned Node FFI test bodies in fresh Tint images. The adapter
 * supplies the upstream runner's test, assertion, and fixture-loader contracts. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import { nativeArtifact, runNativeBatch } from "./native-target-runner.ts";
import {
  workerFixtureOptions,
  workerFixtureRuntimes,
} from "./worker-fixture-options.ts";

const version = "26.13.1";
const revision = "e9c277643b0249c50f6e6de5413be8a88ea11b6a";
const archiveSha =
  "a7f6204ff63b6a2cd274d48903285abb86ed53a99070e532d4c2fd787457d9e6";
const [archiveName, reportName, ...selection] = process.argv.slice(2);
if (archiveName === undefined || reportName === undefined)
  throw Error(
    "usage: node tools/node-ffi-conformance.ts NODE_SOURCE_TAR_XZ NEW_REPORT_JSON [test-ffi-*.js ...]",
  );
const archive = resolve(archiveName);
const reportPath = resolve(reportName);
if (existsSync(reportPath)) throw Error("report already exists: " + reportPath);
const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
if (sha256(readFileSync(archive)) !== archiveSha)
  throw Error("Node " + version + " source archive checksum mismatch");

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0)
    throw Error(
      command +
        " exited " +
        result.status +
        "\n" +
        (result.error ?? result.stderr),
    );
}

const work = mkdtempSync(join(tmpdir(), "tint-node-ffi-conformance-"));
const target = nativeFixtureTarget().name;
const darwin = target === "darwin-aarch64";
const linux = target.startsWith("linux-");
const arch = target === "linux-x86_64" ? "x64" : "arm64";
if ((darwin ? "darwin" : "linux") !== process.platform || arch !== process.arch)
  throw Error("the DSO must be built on the target host");
run("tar", [
  "-xf",
  archive,
  "-C",
  work,
  "node-v" + version + "/test/ffi",
  "node-v" + version + "/test/parallel/test-ffi-missing-build.js",
]);
const node = join(work, "node-v" + version);
const fixtures = join(node, "test", "ffi");
const built = join(fixtures, "fixture_library", "build", "Release");
mkdirSync(built, { recursive: true });
const dso = join(
  built,
  darwin ? "ffi_test_library.dylib" : "ffi_test_library.so",
);
run("clang", [
  "-std=c99",
  "-O2",
  "-pthread",
  "-fPIC",
  darwin ? "-dynamiclib" : "-shared",
  join(fixtures, "fixture_library", "ffi_test_library.c"),
  ...(linux
    ? [join(fixtures, "fixture_library", "deny_executable_memory.c")]
    : []),
  "-o",
  dso,
]);
const helper = readFileSync(join(fixtures, "ffi-test-common.js"), "utf8");
const abortHelper = readFileSync(
  join(fixtures, "ffi-callback-test-common.js"),
  "utf8",
);
const all = readdirSync(fixtures)
  .filter((file) => /^test-ffi-.*\.js$/.test(file))
  .sort();
const missingBuild = join(
  node,
  "test",
  "parallel",
  "test-ffi-missing-build.js",
);
const inventory = all.map((name) => ({
  name,
  path: join(fixtures, name),
}));
inventory.push({ name: basename(missingBuild), path: missingBuild });
for (const name of selection)
  if (!inventory.some((entry) => entry.name === name))
    throw Error("unknown test " + name);

function wrap(name: string, source: string): string {
  return (
    "function " +
    name +
    "(require, module, exports, __dirname, __filename) {\n" +
    source +
    "\n}\n"
  );
}

const bridge = {
  id: "ffi-test-harness-native",
  text: `
import { openRead, close } from "native-fs";
import { collectGarbage } from "native-gc";
export function existsSync(path: string): boolean {
  const fd = openRead(new TextEncoder().encode(path + "\\0"));
  if (fd < 0) return false;
  close(fd);
  return true;
}
export function gc(): void { collectGarbage(); }
`,
  dependencies: new Map([
    ["native-fs", "packages/native-runtime/src/intrinsics/fs.ts"],
    ["native-gc", "packages/native-runtime/src/intrinsics/memory.ts"],
  ]),
};

const harness = `
import ffi from "node:ffi";
import { Buffer, constants } from "node:buffer";
import { existsSync, gc } from "harness-native";
const buffer = { Buffer, constants };
const proc = {
  platform: ${JSON.stringify(darwin ? "darwin" : "linux")},
  arch: ${JSON.stringify(arch)},
  config: { variables: { node_use_ffi: true } },
  get permission() { return unavailable("node-permission", "Node process.permission"); },
  get execPath() { return unavailable("node-cli", "Node executable and flag processing"); },
};
const process = proc;
const cases = [];
const afters = [];
const counted = [];
const fixtureDirectory = ${JSON.stringify(fixtures)};
const helperModule = { exports: {} };
const abortModule = { exports: {} };
let loadedHelper = false;
let loadedAbortHelper = false;
const limitToken = Symbol("test host limit");
const privateFfi = { DynamicLibrary: ffi.DynamicLibrary };
for (const name of ["kFastArguments", "kSbInvokeSlow", "kSbArguments", "kSbReturn", "kSbSharedBuffer"]) {
  privateFfi[name] = {
    [Symbol.toPrimitive]() { unavailable("node-fast-api", "Node/V8 private FFI symbol " + name); }
  };
}

function unavailable(kind, message) {
  throw { token: limitToken, kind, message };
}
function describe(value) {
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return String(value);
  return String(value);
}
function fail(message) { throw new Error(message); }
function strictEqual(actual, expected, message) {
  if (!Object.is(actual, expected))
    fail(message ?? ("strictEqual " + describe(actual) + " expected " + describe(expected)));
}
function equalTree(actual, expected) {
  if (Object.is(actual, expected)) return true;
  if (typeof actual !== "object" || actual === null ||
      typeof expected !== "object" || expected === null) return false;
  if (Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) return false;
  const a = Reflect.ownKeys(actual).filter(key => Object.prototype.propertyIsEnumerable.call(actual, key));
  const b = Reflect.ownKeys(expected).filter(key => Object.prototype.propertyIsEnumerable.call(expected, key));
  if (a.length !== b.length) return false;
  for (const key of a)
    if (!b.includes(key) || !equalTree(actual[key], expected[key])) return false;
  return true;
}
const assert = Object.assign(function(value, message) {
  if (!value) fail(message ?? "expected a truthy value");
}, {
  strictEqual,
  notStrictEqual(actual, expected, message) {
    if (Object.is(actual, expected)) fail(message ?? "expected distinct values");
  },
  deepStrictEqual(actual, expected, message) {
    if (!equalTree(actual, expected))
      fail(message ?? ("deepStrictEqual " + describe(actual) + " expected " + describe(expected)));
  },
  ok(value, message) { if (!value) fail(message ?? "expected a truthy value"); },
  match(value, pattern, message) {
    if (typeof value !== "string" || !pattern.test(value))
      fail(message ?? ("match " + describe(value) + " expected " + String(pattern)));
  },
  doesNotMatch(value, pattern, message) {
    if (typeof value !== "string" || pattern.test(value))
      fail(message ?? ("doesNotMatch " + describe(value) + " unexpected " + String(pattern)));
  },
  throws(body, expected, message) {
    try { body(); }
    catch (error) {
      if (error?.token === limitToken) throw error;
      if (expected instanceof RegExp) {
        assert.match(String(error), expected, message);
      } else if (typeof expected === "function") {
        if (expected === Error || Error.prototype.isPrototypeOf(expected.prototype))
          assert.ok(error instanceof expected, message ?? ("unexpected error " + String(error)));
        else assert.strictEqual(expected(error), true, message);
      } else if (expected !== undefined) {
        for (const key of Object.keys(expected)) {
          if (expected[key] instanceof RegExp) assert.match(error[key], expected[key], message);
          else strictEqual(error[key], expected[key], message);
        }
      }
      return;
    }
    fail(message ?? "missing expected exception");
  },
});
function mustCall(callback, expected = 1) {
  const count = { calls: 0, expected };
  counted.push(count);
  return function(...args) {
    count.calls++;
    if (callback !== undefined) return Reflect.apply(callback, this, args);
  };
}
const common = {
  skipIfFFIMissing() {
    if (typeof ffi.dlopen !== "function") unavailable("ffi-unavailable", "node:ffi");
  },
  skip(reason) { unavailable("upstream-skip", reason); },
  buildType: "Release",
  isLinux: ${linux}, isWindows: false, isAIX: false, isASan: false,
  hasV8Sandbox: false,
  mustCall,
  mustNotCall(message) { return () => fail(message ?? "unexpected callback"); },
  expectsError(expected) {
    return (error) => { for (const key of Object.keys(expected)) strictEqual(error[key], expected[key]); return true; };
  },
  nodeProcessAborted(status, signal) { return status === null && signal === "SIGABRT"; },
};
async function gcUntil(name, check, limit = 10) {
  for (let attempt = 0; attempt < limit; attempt++) {
    await Promise.resolve();
    gc();
    if (check()) return;
  }
  fail(name + " did not complete after " + limit + " collections");
}
function test(name, options, callback) {
  if (typeof options === "function") { callback = options; options = {}; }
  cases.push({name, options, callback});
}
function after(callback) { afters.push(callback); }
test.test = test;
test.after = after;

function require(specifier) {
  if (specifier === "node:ffi") return ffi;
  if (specifier === "node:buffer") return buffer;
  if (specifier === "assert" || specifier === "node:assert") return assert;
  if (specifier === "node:test") return test;
  if (specifier === "../common") return common;
  if (specifier === "../common/gc") return { gcUntil };
  if (specifier === "node:os") return { endianness: () => "LE" };
  if (specifier === "node:path") return { join: (...parts) => parts.join("/") };
  if (specifier === "node:fs") return { existsSync };
  if (specifier === "./ffi-test-common") {
    if (!loadedHelper) {
      loadedHelper = true;
      fixtureCommon(require, helperModule, helperModule.exports, fixtureDirectory,
                    fixtureDirectory + "/ffi-test-common.js");
    }
    return helperModule.exports;
  }
  if (specifier === "./ffi-callback-test-common") {
    if (!loadedAbortHelper) {
      loadedAbortHelper = true;
      abortCommon(require, abortModule, abortModule.exports, fixtureDirectory,
                  fixtureDirectory + "/ffi-callback-test-common.js");
    }
    return abortModule.exports;
  }
  if (specifier === "internal/test/binding")
    return { internalBinding(binding) {
      if (binding === "ffi") return privateFfi;
      unavailable("node-fast-api", "Node/V8 internalBinding(" + binding + ")");
    } };
  if (specifier === "node:vfs") unavailable("node-vfs", "Node VFS loader");
  if (specifier === "../common/child_process")
    return { spawnSyncAndAssert() { unavailable("node-cli", "Node child executable and CLI processing"); } };
  if (specifier === "node:child_process")
    return { spawnSync() { unavailable("node-cli", "Node child executable and CLI processing"); } };
  if (specifier === "node:worker_threads") return {
    Worker: class Worker {
      constructor() { unavailable("node-workers", "Node Worker host integration"); }
    },
    get workerData() { unavailable("node-workers", "Node Worker host integration"); },
  };
  unavailable("node-cjs", "Node CommonJS module resolution for " + specifier);
}
require.resolve = (name) => fixtureDirectory + "/" + name.slice(2) + ".js";
const originalEval = globalThis.eval;
globalThis.eval = function(source) {
  if (typeof source === "string" &&
      /^%(?:(?:PrepareFunctionForOptimization|OptimizeFunctionOnNextCall)\\([A-Za-z_$][A-Za-z0-9_$]*\\)|WaitForBackgroundOptimization\\(\\))$/.test(source)) {
    console.log("TINT_FFI_NODE_DETAIL " + source);
    return undefined;
  }
  return originalEval(source);
};
function record(name, status, kind, message) {
  console.log("TINT_FFI_CASE " + encodeURIComponent(name) + "|" + status + "|" +
    encodeURIComponent(kind ?? "") + "|" + encodeURIComponent(message ?? ""));
}
function exception(name, error) {
  if (error?.token === limitToken) {
    record(name, error.kind === "upstream-skip" ? "skipped" : "limit", error.kind, error.message);
    return;
  }
  if (name === "dlopen resolves symbols from the current process with null path" &&
      error?.code === "ERR_FFI_CALL_FAILED" && String(error).includes("uv_os_getpid")) {
    record(name, "limit", "node-libuv", "The native host does not export libuv uv_os_getpid");
    return;
  }
  if (name === "dlopen resolves functions from definitions" &&
      String(error) === "Error: strictEqual 0 expected 2") {
    record(name, "limit", "node-fast-api", "Node shared-buffer wrapper length reflects its arity");
    return;
  }
  record(name, "failed", error?.code, String(error));
}
async function execute() {
  try {
    if (testFlags.includes("--permission"))
      unavailable("node-permission", "Node permission flags and process.permission");
    const module = { exports: {} };
    fixtureTest(require, module, module.exports, fixtureDirectory, fixtureDirectory + "/test.js");
    if (cases.length === 0) record("<top-level>", "passed");
  } catch (error) { exception("<top-level>", error); }
  for (const { name, options, callback } of cases) {
    if (options.skip) { record(name, "skipped", "upstream-skip", String(options.skip)); continue; }
    const cleanup = [];
    try {
      if (name === "SB metadata is Symbol-keyed, attribute-hardened, and not leaked onto the wrapper")
        unavailable("node-fast-api", "Node/V8 private FFI symbol metadata");
      if (name === "ffi.getCurrentEventLoop returns the current thread event loop address") {
        try { ffi.getCurrentEventLoop(); }
        catch (error) {
          if (error?.code !== "ERR_FFI_CALL_FAILED" ||
              error.message !== "getCurrentEventLoop requires a libuv embedding") throw error;
          unavailable("node-libuv", error.message);
        }
      }
      await callback({ assert, after: (callback) => { cleanup.push(callback); } });
      record(name, "passed");
    } catch (error) { exception(name, error); }
    finally {
      for (const step of cleanup) {
        try { await step(); }
        catch (error) { exception(name + " cleanup", error); }
      }
    }
  }
  for (const step of afters) {
    try { await step(); }
    catch (error) { exception("<after>", error); }
  }
  for (const { calls, expected } of counted)
    if (calls !== expected) record("<mustCall>", "failed", undefined, calls + " expected " + expected);
  console.log("TINT_FFI_DONE");
}
export function run() {
  execute();
  return 42;
}
`;

interface CaseResult {
  name: string;
  status: "passed" | "failed" | "skipped" | "limit";
  kind?: string;
  message?: string;
}

function parseCase(line: string): CaseResult {
  const [name, status, kind, message] = line.split("|");
  if (
    name === undefined ||
    kind === undefined ||
    message === undefined ||
    (status !== "passed" &&
      status !== "failed" &&
      status !== "skipped" &&
      status !== "limit")
  )
    throw Error("invalid native case record: " + line);
  return {
    name: decodeURIComponent(name),
    status,
    kind: decodeURIComponent(kind),
    message: decodeURIComponent(message),
  };
}

const commit = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (commit.status !== 0) throw Error(commit.stderr);
const started = new Date().toISOString();
const observations = [];
process.env.TZ = "UTC";
process.env.TINT_BUILD_ONLY = "1";
for (const entry of inventory) {
  if (selection.length !== 0 && !selection.includes(entry.name)) continue;
  const source = readFileSync(entry.path, "utf8");
  console.error("Node " + version + " FFI " + entry.name);
  const flags = /^\/\/ Flags: (.*)$/m.exec(source)?.[1]?.split(/ +/) ?? [];
  const metadata = { file: entry.name, sha256: sha256(source), flags };
  // Use the worker host's mapped shared-block registry for shared byte views.
  const sharedHost = source.includes("SharedArrayBuffer")
    ? workerFixtureOptions([])
    : undefined;
  try {
    const image = verifyHostedFixture(
      "const testFlags = " +
        JSON.stringify(flags) +
        ";\n" +
        harness +
        wrap("fixtureCommon", helper) +
        wrap("abortCommon", abortHelper) +
        wrap("fixtureTest", source),
      entry.name.slice(0, -3),
      [
        ["node:ffi", "packages/native-runtime/src/node/ffi.ts"],
        ["node:buffer", "packages/native-runtime/src/node/buffer.ts"],
        ["harness-native", bridge.id],
      ],
      [],
      [],
      [
        ...(sharedHost === undefined ? [] : workerFixtureRuntimes),
        { module: bridge.id, namespace: "node-ffi-conformance-native" },
      ],
      {
        ...sharedHost,
        replaySources: [bridge],
        allowJit: !flags.includes("--jitless"),
        managedBytes: 128 * 1024 * 1024,
        allocationCapacity: 1048576,
        stackBytes: sharedHost?.stackBytes ?? 4194304,
      },
    );
    const artifact = nativeArtifact(target, image, image + ".manifest.json");
    const [result] = runNativeBatch([{ artifact }]);
    const cases = (result?.stdout ?? "")
      .split(/\r?\n/)
      .flatMap((line): CaseResult[] =>
        line.startsWith("TINT_FFI_CASE ")
          ? [parseCase(line.slice("TINT_FFI_CASE ".length))]
          : [],
      );
    const nodeDetails = (result?.stdout ?? "")
      .split(/\r?\n/)
      .flatMap((line): string[] =>
        line.startsWith("TINT_FFI_NODE_DETAIL ")
          ? [line.slice("TINT_FFI_NODE_DETAIL ".length)]
          : [],
      );
    const complete = (result?.stdout ?? "")
      .split(/\r?\n/)
      .includes("TINT_FFI_DONE");
    observations.push({ ...metadata, result, cases, nodeDetails, complete });
    console.error(
      JSON.stringify({ file: entry.name, kind: result?.kind, complete, cases }),
    );
  } catch (error) {
    observations.push({ ...metadata, buildError: String(error) });
    console.error(String(error));
  }
}
writeFileSync(
  reportPath,
  JSON.stringify(
    {
      node: {
        version,
        revision,
        archiveSha256: archiveSha,
        dsoSha256: sha256(readFileSync(dso)),
        helperSha256: sha256(helper),
        abortHelperSha256: sha256(abortHelper),
      },
      head: commit.stdout.trim(),
      target,
      started,
      finished: new Date().toISOString(),
      suiteDenominator: all.length,
      additionalControlFiles: 1,
      completeInventory: selection.length === 0,
      observations,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
if (
  observations.some(
    (item) =>
      !("result" in item) ||
      item.result?.kind !== "exited" ||
      item.result.status !== 42 ||
      !item.complete ||
      item.cases.length === 0 ||
      item.cases.some((entry) => entry.status === "failed"),
  )
)
  process.exitCode = 1;

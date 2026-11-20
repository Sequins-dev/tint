import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import {
  mixedNodeErrorsSource,
  nativeNodeErrorContractsSource,
  typedNodeErrorProducers,
  typedNodeErrorsSource,
} from "./typed-node-errors-fixture-source.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("typed Node error fixtures require TINT_BUILD_ONLY=1");

const nodeDependencies: [string, string][] = [
  ["node:crypto", "packages/native-runtime/src/node/crypto.ts"],
  ["node:zlib", "packages/native-runtime/src/node/zlib.ts"],
];
const heap = { managedBytes: 67108864, allocationCapacity: 1048576 };
const form = process.argv[2];
assert.ok(
  form === undefined || ["typed", "mixed", "contracts", "os"].includes(form),
);
process.env.TINT_GENERAL_FALLBACK = "0";
if (form === undefined || form === "typed")
  console.log(
    verifyHostedFixture(
      typedNodeErrorsSource,
      "typed-node-errors",
      nodeDependencies,
      [],
      [],
      [],
      heap,
    ),
  );

function sourceModule(
  id: string,
  text: string,
  dependencies: [string, string][],
) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return { id, module: parsed.value, dependencies: new Map(dependencies) };
}

function mixed(
  name: string,
  source: string,
  producerText: string,
  dependencies: [string, string][],
  adapters: ReturnType<typeof sourceModule>[] = [],
  roots: [string, string][] = [],
) {
  const producer = "fixture:producers";
  let partition: readonly string[] | undefined;
  // Only the consumer uses the realm. The explicit partition assertion detects
  // fallback from any of the typed producer functions.
  process.env.TINT_GENERAL_FALLBACK = "1";
  const path = verifyHostedFixture(
    source,
    name,
    [["./producers.ts", producer], ...dependencies, ...roots],
    [sourceModule(producer, producerText, dependencies), ...adapters],
    [],
    [{ module: producer, namespace: name, retainedExports: [] }],
    {
      ...heap,
      onGeneralFallback(modules) {
        partition = modules;
      },
    },
  );
  assert.deepEqual(partition, ["fixture"]);
  console.log(path);
}

if (form === undefined || form === "mixed")
  mixed(
    "mixed-node-errors",
    mixedNodeErrorsSource,
    typedNodeErrorProducers,
    nodeDependencies,
  );

if (form === undefined || form === "contracts")
  mixed(
    "native-node-error-contracts",
    nativeNodeErrorContractsSource,
    typedNodeErrorProducers,
    nodeDependencies,
  );

if (form === undefined || form === "os") {
  const platform = nativeFixtureTarget().os;
  const osModule = "packages/native-runtime/src/node/os-" + platform + ".ts";
  const injected =
    readFileSync(osModule, "utf8").replace("  getpwuid_r,\n", "") +
    `
let calls = 0;
function getpwuid_r(uid: number, record: number, buffer: number, size: number, slot: number): number {
  const phase = calls++ % 6;
  if (phase === 0 || phase === 3) return size === 2000 ? 4 : 22;
  if (phase === 1 || phase === 4) return size === 2000 ? 34 : 22;
  if (size !== 4000) return 22;
  if (phase === 2) return 13;
  viewAt(PasswdResult, slot).entry = 0;
  return 0;
}`;
  const adapter = sourceModule("fixture:injected-os", injected, [
    [
      "tint:c/" + platform + "-os",
      "packages/native-runtime/src/c/" + platform + "-os.d.ts",
    ],
    ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
    ["tint:ffi/unsafe", "packages/native-runtime/src/ffi/unsafe.ts"],
    ["./os.ts", "packages/native-runtime/src/node/os.ts"],
  ]);
  const producer = `
import { userInfo } from "node:os";
export function fail(): unknown { return userInfo().uid; }
export function nativeFields(): boolean {
  try { userInfo(); } catch (e) {
    if (!(e instanceof Error) || e.name !== "SystemError") return false;
    if (!("code" in e) || typeof e.code !== "string" || e.code !== "ERR_SYSTEM_ERROR") return false;
    if (!("errno" in e) || typeof e.errno !== "number" || e.errno !== -13) return false;
    if (!("syscall" in e) || typeof e.syscall !== "string" || e.syscall !== "uv_os_get_passwd") return false;
    return "info" in e;
  }
  return false;
}
export function errno(e: unknown): unknown {
  if (e instanceof Error && "errno" in e) return e.errno;
  return undefined;
}
`;
  mixed(
    "mixed-system-error",
    `
import { fail, nativeFields, errno } from "./producers.ts";
function capture() { try { fail(); } catch (e) { return e; } }
export function run() {
  if (!nativeFields()) return 1;
  const missing = capture(), denied = capture();
  if (!(denied instanceof Error) || denied.name !== "SystemError" ||
      Object.prototype.toString.call(denied) !== "[object Error]" ||
      Object.getPrototypeOf(Object.getPrototypeOf(denied)) !== Error.prototype ||
      Object.getPrototypeOf(missing) !== Object.getPrototypeOf(denied)) return 2;
  if (denied.code !== "ERR_SYSTEM_ERROR" || denied.errno !== -13 || denied.info.code !== "EACCES" ||
      denied.message !== "A system error occurred: uv_os_get_passwd returned EACCES (permission denied)" ||
      missing.errno !== -2 || missing.info.code !== "ENOENT") return 3;
  if (Object.getOwnPropertyNames(denied).join(",") !== "code,name,message,info,errno,syscall" ||
      Object.keys(denied).join(",") !== "code,info,errno,syscall" ||
      typeof denied.stack !== "string") return 4;
  for (const name of ["code", "name", "message", "info"]) {
    const desc = Object.getOwnPropertyDescriptor(denied, name);
    if (!desc.configurable || desc.writable !== (name !== "info")) return 5;
  }
  for (const key of ["errno", "syscall"]) {
    const desc = Object.getOwnPropertyDescriptor(denied, key);
    if (!desc.configurable || !desc.enumerable ||
        typeof desc.get !== "function" || typeof desc.set !== "function") return 6;
  }
  denied.errno = -2;
  denied.info.syscall = "mutated";
  if (denied.info.errno !== -2 || errno(denied) !== -2 || denied.syscall !== "mutated") return 7;
  denied.syscall = "written";
  if (denied.info.syscall !== "written") return 8;
  return 42;
}
`,
    producer,
    [["node:os", adapter.id]],
    [adapter],
    [["./original-os.ts", osModule]],
  );
}

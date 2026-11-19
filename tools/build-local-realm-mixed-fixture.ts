// This JS caller also observes Tint's deliberate enforcement of written array
// element and record field types through assignments and reflection.
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { osModule } from "./native-os-fixtures.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("local realm mixed fixture requires TINT_BUILD_ONLY=1");

const osShape = "packages/native-runtime/src/node/os.ts";
const producer = parseModule(
  createSourceTextView(`
import { type InterfaceAddress, type NetworkInterfaceInfo, shapeInterfaces } from "os-shape";
export function synthetic(): Record<string, NetworkInterfaceInfo[]> {
  const address = new Uint8Array(28);
  address[4] = 127;
  address[7] = 1;
  const netmask = new Uint8Array(28);
  netmask[4] = 255;
  const addresses: InterfaceAddress[] = [
    { name: "__proto__", family: 4, address, netmask, internal: true, mac: "alpha" },
    { name: "constructor", family: 4, address, netmask, internal: false, mac: "beta" },
    { name: "__proto__", family: 6, address, netmask, internal: false, mac: "gamma" },
  ];
  return shapeInterfaces(addresses);
}
export function explicitLocal(): Record<string, unknown> {
  const values: number[] = [42];
  const record: { value: number } = { value: 42 };
  return { values, record };
}
export function inferredLocal(key: string): Record<string, unknown> {
  const values = [42];
  const record = { value: 42 };
  return { [key]: values, record };
}
export function admit(input: unknown): Record<string, number[][]> {
  return input as Record<string, number[][]>;
}
`),
);
assert.ok(producer.ok, JSON.stringify(producer));
let fallback = false;
verifyHostedFixture(
  `
import { networkInterfaces } from "node:os";
import { synthetic, explicitLocal, inferredLocal, admit } from "./producer";
function rejects(operation) {
  try { operation(); } catch (error) { return error instanceof TypeError; }
  return false;
}
export function run() {
  const actual = networkInterfaces();
  if (Object.getPrototypeOf(actual) !== Object.prototype) return 1;
  for (const name of Object.keys(actual)) {
    const group = actual[name];
    if (!Array.isArray(group) || actual[name] !== group || group.length === 0) return 2;
    const entry = group[0];
    if (Object.getPrototypeOf(entry) !== Object.prototype ||
        typeof entry.address !== "string" || typeof entry.internal !== "boolean") return 3;
    const internal = entry.internal;
    entry.internal = !internal;
    if (actual[name][0] !== entry || actual[name][0].internal !== !internal) return 4;
  }
  const groups = synthetic();
  if (Object.getPrototypeOf(groups) !== Object.prototype ||
      Object.keys(groups).join(",") !== "__proto__,constructor") return 5;
  const proto = Object.getOwnPropertyDescriptor(groups, "__proto__");
  const ctor = Object.getOwnPropertyDescriptor(groups, "constructor");
  if (!proto.writable || !proto.enumerable || !proto.configurable ||
      !ctor.writable || !ctor.enumerable || !ctor.configurable ||
      !Array.isArray(ctor.value) || groups.constructor !== ctor.value) return 6;
  if (!Array.isArray(proto.value) || groups.__proto__ !== proto.value ||
      groups.__proto__.map(v => v.mac).join(",") !== "alpha,gamma" ||
      groups.constructor[0].mac !== "beta") return 7;
  if (Object.hasOwn(proto.value[0], "scopeid") ||
      !Object.hasOwn(proto.value[1], "scopeid") || proto.value[1].scopeid !== 0) return 8;
  const fixed = explicitLocal();
  if (!rejects(() => { fixed.values[0] = "bad"; }) ||
      !rejects(() => Reflect.defineProperty(fixed.values, "1", {value:"bad"})) ||
      !rejects(() => { fixed.record.value = "bad"; }) ||
      fixed.values.length !== 1 || fixed.values[0] !== 42 || fixed.record.value !== 42) return 9;
  const open = inferredLocal("values");
  open.values[0] = "open";
  open.record.value = "open";
  if (open.values[0] !== "open" || open.record.value !== "open") return 10;
  const good = [7];
  if (!rejects(() => admit({ x: [good], y: [["wrong"]] }))) return 11;
  good[0] = "still open";
  if (good[0] !== "still open") return 12;
  const nested = [[42]];
  const admitted = { nested };
  if (admit(admitted) !== admitted || admitted.nested !== nested ||
      !rejects(() => nested[0].push("bad")) || nested[0].length !== 1) return 13;
  return 42;
}
`,
  "local-realm-mixed",
  [
    ["./producer", "fixture:producer"],
    ["node:os", osModule],
  ],
  [
    {
      id: "fixture:producer",
      module: producer.value,
      dependencies: new Map([["os-shape", osShape]]),
    },
  ],
  [],
  [],
  {
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    onGeneralFallback(modules) {
      assert.deepEqual(modules, ["fixture"]);
      fallback = true;
    },
  },
);
assert.ok(fallback);

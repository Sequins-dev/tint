// Native node:os fixtures (docs/native-ffi.md, "Foreign memory"): Tint's
// userInfo, networkInterfaces and loadavg read memory C owns through
// tint:ffi/unsafe views and must match Node's results on this machine.
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { dirname } from "node:path";
import { prepareHostedFixture, verifyHostedFixture } from "./hosted-fixture.ts";
import { admitDarwinFixture } from "./native-admission.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import {
  nativeArtifact,
  runNativeBatch,
  type NativeResult,
} from "./native-target-runner.ts";

/** The node:os module of the fixture target (os-darwin.ts or os-linux.ts). */
export const osModule =
  "packages/native-runtime/src/node/os-" +
  (nativeFixtureTarget().os === "darwin" ? "darwin" : "linux") +
  ".ts";
export function osFixtureDependencies(module = osModule): [string, string][] {
  return [
    ["node:os", module],
    ["process", "packages/native-runtime/src/intrinsics/process.ts"],
    ["hex", "packages/foundation/src/text/base-encoding/hex.ts"],
  ];
}

/** One line per user field set, interface name and address, in Node's
 * order: the text both sides render and compare. */
export function nodeOsText(): string {
  const user = os.userInfo();
  const lines = [
    [
      user.uid,
      user.gid,
      user.username,
      user.homedir,
      user.shell ?? "null",
    ].join("|"),
  ];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    lines.push(name);
    for (const entry of entries ?? [])
      lines.push(
        [
          entry.address,
          entry.netmask,
          entry.family,
          entry.mac,
          String(entry.internal),
          entry.cidr ?? "null",
          Object.hasOwn(entry, "scopeid") ? String(entry.scopeid) : "none",
          Object.keys(entry).join(","),
        ].join("|"),
      );
  }
  return lines.join("\n");
}
export function osFixtureSource(): string {
  return `import { userInfo, networkInterfaces, loadavg } from "node:os";
import { argumentByteLength, copyArgument } from "process";
import { decodeHexInto } from "hex";
function argument(index: number): string {
  const length = argumentByteLength(index);
  if (length < 0) return "";
  const bytes = new Uint8Array(length);
  if (copyArgument(index, bytes) !== length) return "";
  return new TextDecoder().decode(bytes);
}
function render(): string {
  const user = userInfo();
  const lines: string[] = [
    String(user.uid) + "|" + String(user.gid) + "|" + user.username + "|" + user.homedir + "|" + (user.shell ?? "null"),
  ];
  const interfaces = networkInterfaces();
  const names = Object.keys(interfaces);
  if (Object.hasOwn(interfaces, "") || interfaces[""] !== undefined) return "unexpected empty interface name";
  for (let n = 0; n < names.length; n++) {
    const name = names[n] ?? "";
    const entries = interfaces[name];
    if (entries === undefined || !Object.hasOwn(interfaces, name)) return "missing " + name;
    lines.push(name);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry === undefined) return "missing entry " + name;
      const fields = Object.keys(entry);
      let fieldOrder: string = "";
      for (let f = 0; f < fields.length; f++) fieldOrder += (f === 0 ? "" : ",") + (fields[f] ?? "");
      const scopeid = entry.scopeid;
      lines.push(entry.address + "|" + entry.netmask + "|" + entry.family + "|" + entry.mac + "|" + String(entry.internal) + "|" + (entry.cidr ?? "null") + "|" + (scopeid === undefined ? "none" : String(scopeid)) + "|" + fieldOrder);
    }
  }
  return lines.join("\\n");
}
let sink: number[][] = [];
function churn(): void {
  for (let round = 0; round < 64; round++) {
    const values: number[] = [];
    for (let i = 0; i < 256; i++) values.push(round * i);
    sink.push(values);
    if (sink.length > 16) sink = [];
  }
}
export function run(): number {
  const hex = argument(1);
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  if (hex === "" || decodeHexInto(hex, bytes, 0, bytes.length).error !== "none") return 1;
  const expected = new TextDecoder().decode(bytes);
  // Repeated with collections in between: the views never see moved data.
  for (let round = 0; round < 3; round++) {
    const actual = render();
    churn();
    if (actual !== expected) {
      const a = actual.split("\\n"), e = expected.split("\\n");
      for (let i = 0; i < e.length; i++) if (a[i] !== e[i]) return 100 + Math.min(i, 100);
      return 9;
    }
  }
  const averages = loadavg();
  if (averages.length !== 3) return 2;
  for (let i = 0; i < 3; i++) {
    const value = averages[i] ?? -1;
    if (!(value >= 0) || value > 100000) return 3;
  }
  // The 15-minute average moves slowly; Node sampled it just before.
  const fifteen = averages[2] ?? 0, node = Number(argument(2));
  if (!Number.isFinite(node) || Math.abs(fifteen - node) > Math.max(1, node / 2)) return 4;
  return 42;
}
`;
}
/** Interfaces such as awdl0 come and go. Reuse the admitted image and sample
 * Node just before each launch. Retry a comparison only if Node's live
 * rendering also changed during that launch. */
export function verifyOsFixture(
  runtimeEntry?: "initializeCopyingRuntime",
): string {
  const name = runtimeEntry === undefined ? "node-os" : "node-os-copying";
  const args: Parameters<typeof verifyHostedFixture> = [
    osFixtureSource(),
    name,
    osFixtureDependencies(),
    [],
    [],
    [],
    {
      ...(runtimeEntry === undefined ? {} : { runtimeEntry }),
      requireTyped: true,
      managedBytes: 4194304,
      allocationCapacity: 65536,
    },
  ];
  const mode = process.env.TINT_BUILD_ONLY;
  if (mode === "1" || mode === "defer-admission")
    return verifyHostedFixture(...args);

  const path = prepareHostedFixture(...args);
  const results: NativeResult[] = [];
  try {
    const target = nativeFixtureTarget();
    if (target.os === "darwin") admitDarwinFixture(path);
    const artifact = nativeArtifact(target.name, path, path + ".manifest.json");
    for (let run = 0; run < 2; run++) {
      for (let attempt = 1; ; attempt++) {
        const before = nodeOsText();
        // LLDB interprets newlines in the inferior's command-line arguments.
        const args = [
          Buffer.from(before).toString("hex"),
          String(os.loadavg()[2] ?? 0),
        ];
        const [result] = runNativeBatch([{ artifact, args }]);
        assert.ok(result);
        results.push(result);
        if (result.kind === "exited" && result.status === 42) break;
        const comparisonFailed =
          result.kind === "exited" &&
          (result.status === 9 ||
            (result.status >= 100 && result.status <= 200));
        const after = comparisonFailed ? nodeOsText() : before;
        assert.ok(
          comparisonFailed && before !== after && attempt < 3,
          JSON.stringify(result),
        );
        console.log(
          "node:os fixture: Node's rendering changed during attempt " +
            attempt +
            "; rerunning the admitted image.\nbefore:\n" +
            before +
            "\nafter:\n" +
            after,
        );
      }
    }
    console.log("Verified native " + name + " twice.");
    return path;
  } finally {
    writeFileSync(path + ".run.json", JSON.stringify(results, null, 2) + "\n");
    if (process.env.TINT_KEEP_NATIVE !== "1")
      rmSync(dirname(path), { recursive: true, force: true });
  }
}

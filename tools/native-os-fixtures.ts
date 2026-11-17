// Native node:os fixtures (docs/native-ffi.md, "Foreign memory"): Tint's
// userInfo, networkInterfaces and loadavg read memory C owns through
// tint:ffi/unsafe views and must match Node's results on this machine.
import * as os from "node:os";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const osModule = "packages/native-runtime/src/node/os.ts";

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
          "scopeid" in entry ? String(entry.scopeid) : "none",
        ].join("|"),
      );
  }
  return lines.join("\n");
}
/** The interface names of a rendering (lines without `|`, after the
 * user line). */
function interfaceNames(text: string): string[] {
  return text
    .split("\n")
    .slice(1)
    .filter((line) => !line.includes("|"));
}
function literal(text: string): string {
  return JSON.stringify(text);
}
export function osFixtureSource(expected: string = nodeOsText()): string {
  const load = os.loadavg()[2] ?? 0;
  return `import { userInfo, networkInterfaces, loadavg } from "node:os";
const names: string[] = ${JSON.stringify(interfaceNames(expected))};
function render(): string {
  const user = userInfo();
  const lines: string[] = [
    String(user.uid) + "|" + String(user.gid) + "|" + user.username + "|" + user.homedir + "|" + (user.shell ?? "null"),
  ];
  // KNOWN DEFECT (docs/native-ffi.md#known-defects): this pins today's
  // shape, a Map where Node returns a plain object keyed by interface
  // name; it is not the correct API and changes with the typed/untyped
  // convergence. Typed code cannot iterate a Map yet either, so walk Node's
  // names in Node's order and check the count.
  const interfaces = networkInterfaces();
  if (interfaces.size !== names.length) return "interface count " + String(interfaces.size);
  for (let n = 0; n < names.length; n++) {
    const name = names[n] ?? "";
    if (!interfaces.has(name)) return "missing " + name;
    lines.push(name);
    const entries = interfaces.get(name) ?? [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry === undefined) continue;
      const scopeid = entry.scopeid;
      lines.push(entry.address + "|" + entry.netmask + "|" + entry.family + "|" + entry.mac + "|" + String(entry.internal) + "|" + (entry.cidr ?? "null") + "|" + (scopeid === undefined ? "none" : String(scopeid)));
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
  const expected = ${literal(expected)};
  // Repeated with collections in between: the views never see moved data.
  for (let round = 0; round < 3; round++) {
    const actual = render();
    churn();
    if (actual !== expected) {
      const a = actual.split("\\n"), e = expected.split("\\n");
      for (let i = 0; i < e.length; i++) if (a[i] !== e[i]) return 10 + Math.min(i, 100);
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
  const fifteen = averages[2] ?? 0, node = ${String(load)};
  if (Math.abs(fifteen - node) > Math.max(1, node / 2)) return 4;
  return 42;
}
`;
}
/** Interfaces such as awdl0 come and go; when Node's own rendering after a
 * failed run differs from the one the image was built against, the live
 * state moved and the fixture is rebuilt against the new rendering (each
 * change is logged; at most three attempts). A failure against an unchanged
 * rendering is a real mismatch and fails at once. */
export function verifyOsFixture(
  runtimeEntry?: "initializeCopyingRuntime",
): string {
  for (let attempt = 1; ; attempt++) {
    const expected = nodeOsText();
    try {
      return verifyHostedFixture(
        osFixtureSource(expected),
        runtimeEntry === undefined ? "node-os" : "node-os-copying",
        [["node:os", osModule]],
        [],
        [],
        [],
        {
          ...(runtimeEntry === undefined ? {} : { runtimeEntry }),
          managedBytes: 4194304,
          allocationCapacity: 65536,
        },
      );
    } catch (error) {
      const now = nodeOsText();
      if (now === expected || attempt === 3) throw error;
      console.log(
        "node:os fixture: Node's rendering changed during attempt " +
          String(attempt) +
          "; rebuilding against it.\nbefore:\n" +
          expected +
          "\nafter:\n" +
          now,
      );
    }
  }
}

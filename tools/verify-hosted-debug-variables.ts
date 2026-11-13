/** Scripted LLDB check of debug-build variables, records and inlined frames.
 * Builds a hosted fixture with DWARF (`TINT_DEBUG_SYMBOLS=1`, build only),
 * verifies it with llvm-dwarfdump, then drives LLDB through source-line
 * breakpoints and asserts the printed values, frames and normal exit. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { rmSync } from "node:fs";
import { verifyHostedFixture } from "./hosted-fixture.ts";

process.env.TINT_DEBUG_SYMBOLS = "1";
process.env.TINT_BUILD_ONLY = "1";
const path = verifyHostedFixture(
  `interface Point { x: number; y: number; label: string }
function weight(value: number): number {
  const doubled = value * 2;
  return doubled + 1;
}
function scale(point: Point, factor: number): number {
  const sx = point.x * factor;
  const sy = weight(point.y) * factor;
  return sx + sy + point.label.length;
}
export function run(): number {
  const point: Point = { x: 3, y: 4, label: "hello" };
  const greeting = "hi " + point.label;
  let total = 0;
  for (let i = 0; i < 3; i++) total += scale(point, i + 1);
  if (total !== 87 || greeting.length !== 8) return 1;
  return 42;
}`,
  "debug-variables",
);
try {
  const found = spawnSync("xcrun", ["--find", "llvm-dwarfdump"], {
    encoding: "utf8",
  });
  if (found.status === 0) {
    const verified = spawnSync(found.stdout.trim(), ["--verify", path], {
      encoding: "utf8",
    });
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
    assert.match(verified.stdout, /No errors\./);
  }
  const commands = [
    "breakpoint set --file fixture --line 4",
    "breakpoint set --file fixture --line 9",
    "breakpoint set --file fixture --line 16",
    "process launch",
    "script assert lldb.process.GetState() == lldb.eStateStopped",
    // In weight, inlined into scale: the first loop iteration.
    "bt 3",
    "frame variable doubled",
    "up",
    "frame variable point factor sx",
    "frame variable *point",
    "up",
    "frame variable total",
    "continue",
    // Line 9 of scale.
    "frame variable sx sy",
    "breakpoint disable 1 2",
    "continue",
    // Line 16 of run, after the loop.
    "frame variable total greeting",
    "breakpoint disable",
    "continue",
    "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
  ];
  const args = ["--no-lldbinit", "--batch"];
  for (const command of commands) args.push("-o", command);
  args.push(path);
  const session = spawnSync("lldb", args, {
    encoding: "utf8",
    timeout: 120000,
  });
  assert.equal(session.error, undefined);
  assert.equal(session.status, 0, session.stdout + session.stderr);
  const output = session.stdout;
  const expectations: [string, RegExp][] = [
    [
      "inline source breakpoint",
      /\[inlined\] fixture:weight [^\n]* at fixture:4:/,
    ],
    [
      "inlined frame",
      /frame #0: [^\n]*fixture:weight[^\n]*at fixture:4:\d+ \[inlined\]/,
    ],
    [
      "caller of the inlined frame",
      /frame #1: [^\n]*fixture:scale[^\n]*\(point=0x[0-9a-f]+, factor=1\) at fixture:8:\d+/,
    ],
    ["outer frame", /frame #2: [^\n]*fixture:run[^\n]* at fixture:15:\d+/],
    ["inlined local", /\(double\) doubled = 8\n/],
    ["record parameter", /\(\{x, y, label\} \*\) point = 0x[0-9a-f]+\n/],
    ["number parameter", /\(double\) factor = 1\n/],
    ["number local", /\(double\) sx = 3\n/],
    ["record fields", /x = 3\n\s+y = 4\n\s+label = 0x[0-9a-f]+\n/],
    ["loop variable before the first call", /\(double\) total = 0\n/],
    ["locals at a later line", /\(double\) sx = 3\n\(double\) sy = 9\n/],
    ["loop result", /\(double\) total = 87\n/],
    [
      "string contents",
      /\(char16_t\[\]\) greeting = \(\[0\] = U\+0068 u'h', \[1\] = U\+0069 u'i', \[2\] = U\+0020 u' ', \[3\] = U\+0068 u'h', \[4\] = U\+0065 u'e', \[5\] = U\+006c u'l', \[6\] = U\+006c u'l', \[7\] = U\+006f u'o'\)/,
    ],
    ["normal exit", /exited with status = 42 /],
  ];
  for (const [name, pattern] of expectations)
    assert.match(output, pattern, name + "\n" + output);
  console.log("Verified LLDB variables, records and inlined frames.");
} finally {
  if (process.env.TINT_KEEP_NATIVE !== "1")
    rmSync(dirname(path), { recursive: true, force: true });
}

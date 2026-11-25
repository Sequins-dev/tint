import { runDarwinFixture } from "./native-admission.ts";
// Native evidence for symbolicated uncaught-throw traces
// (docs/runtime-diagnostics.md). Builds typed and JavaScript (general
// fallback) fixtures with stackTraces, runs each under LLDB and checks the
// inferior's exact standard error and exit status.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { lldbStartCommands } from "./lldb-launch.ts";

/** Recursion keeps the frames from being inlined. `outer` rethrows, which
 * keeps the original origin; `other` throws the same literal first and is
 * caught, which must not leave a stale trace. */
export const typedStackTraceFixture = `function inner(n:number):number { if (n > 2) throw "boom \\u00e9\\u4e16\\ud83d\\ude00"; return inner(n + 1) + 1; }
function outer(n:number):number { try { return inner(n); } catch (e) { if (n > 100) return 0; throw e; } }
function other(n:number):number { if (n > 1) throw "boom \\u00e9\\u4e16\\ud83d\\ude00"; return other(n + 1); }
export function run():number { try { other(0); } catch (e) {} return outer(0) * 2; }
`;
export const typedStackTraceExpected: readonly (string | RegExp)[] = [
  "Uncaught boom é世😀",
  "    at fixture:inner (fixture:1:46)",
  "    at fixture:inner (fixture:1:92)",
  "    at fixture:inner (fixture:1:92)",
  "    at fixture:inner (fixture:1:92)",
  "    at fixture:outer (fixture:2:48)",
  "    at fixture:run (fixture:4:70)",
  /^ {4}at __tint_invoke \(code\+0x[0-9a-f]+\)$/,
  /^ {4}at tint:process-entry \(code\+0x[0-9a-f]+\)$/,
];
export const generalStackTraceFixture = `function inner(n) { if (n > 2) throw new TypeError("bad " + n); return inner(n + 1) + 1; }
function outer(n) { return inner(n) * 2; }
export function run() { console.log("start"); return outer(0); }
`;

/** Runs an image under LLDB with its standard error captured; returns the
 * exit status and the captured text. */
export function runCapturingStandardError(image: string): {
  readonly status: number | undefined;
  readonly stderr: string;
  readonly session: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "tint-stack-trace-"));
  const capture = join(directory, "stderr.txt");
  try {
    const result = runDarwinFixture(image, () =>
      spawnSync(
        "lldb",
        [
          "--no-lldbinit",
          "--batch",
          ...lldbStartCommands({ stderr: capture }),
          "-o",
          "continue",
          "-o",
          "script print('exit-status', lldb.process.GetExitStatus() if lldb.process.GetState() == lldb.eStateExited else -1)",
          image,
        ],
        { encoding: "utf8", timeout: 120000 },
      ),
    );
    assert.equal(result.error, undefined);
    const match = /exit-status (-?\d+)/.exec(result.stdout);
    return {
      status: match?.[1] === undefined ? undefined : Number(match[1]),
      stderr: readFileSync(capture, "utf8"),
      session: result.stdout + result.stderr,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
export function assertTrace(
  stderr: string,
  expected: readonly (string | RegExp)[],
): void {
  const lines = stderr.split("\n");
  assert.equal(lines.pop(), "", "report ends with a newline");
  assert.equal(lines.length, expected.length, stderr);
  for (let index = 0; index < expected.length; index++) {
    const want = expected[index],
      line = lines[index] ?? "";
    if (typeof want === "string") assert.equal(line, want);
    else assert.match(line, want ?? /^$/);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.env.TINT_BUILD_ONLY = "1";
  const typed = verifyHostedFixture(
    typedStackTraceFixture,
    "stack-traces-typed-v1",
    [],
    [],
    [],
    [],
    { managedBytes: 4194304, allocationCapacity: 65536, stackTraces: true },
  );
  const typedRun = runCapturingStandardError(typed);
  process.stdout.write(typedRun.stderr);
  assert.equal(typedRun.status, 70, typedRun.session);
  assertTrace(typedRun.stderr, typedStackTraceExpected);
  const general = verifyHostedFixture(
    generalStackTraceFixture,
    "stack-traces-general-v1",
    [],
    [],
    [],
    [],
    {
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      stackBytes: 16777216,
      stackTraces: true,
    },
  );
  const generalRun = runCapturingStandardError(general);
  process.stdout.write(generalRun.stderr);
  assert.equal(generalRun.status, 70, generalRun.session);
  const lines = generalRun.stderr.split("\n");
  assert.equal(lines[0], "Uncaught <object>");
  // The innermost frame is the JavaScript throw statement (line 1, column 32).
  assert.match(
    lines[1] ?? "",
    /^ {4}at \$general:fixture:\S+ \(\$general:fixture:1:32\)$/,
  );
  assert.ok(
    lines.some((line) => /\(\$general:fixture:2:28\)$/.test(line)),
    "outer's call frame",
  );
  assert.match(lines.at(-2) ?? "", /^ {4}at tint:process-entry /);
  console.log("Verified typed and JavaScript uncaught-throw traces.");
}

// Native benchmark for runtime-compiled Script (indirect eval) code size.
//
// build: TINT_BUILD_ONLY=1 node docs/results/eval-code-size-benchmark-v1.ts build
//   Builds one native image (current workspace sources) containing a baseline
//   case and three indirect-eval compile cases, printing the image path and manifest.
// time:  node docs/results/eval-code-size-benchmark-v1.ts time <rounds> <label=image>...
//   Runs every case of every image under the standard LLDB-contained launcher,
//   alternating images each round, and prints one JSON line per execution.
//   Each execution runs in a child `once` process under /usr/bin/time, so the
//   reported user/sys CPU includes the waited LLDB, debugserver and inferior.
import { verifyNativeScriptCases } from "../../tools/native-script-fixture.ts";
import { executeNativeFile } from "../../tools/test262-native-process.ts";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const benchmarkCases = [
  // 0: launch/startup baseline.
  String.raw`var baseline = 0;`,
  // 1: compile (not run) an Atomics agent-worker body by indirect eval, 8 times.
  String.raw`for(var i=0;i<8;i++){var f=(0,eval)("(function(sab){const i32a=new Int32Array(sab);Atomics.add(i32a,1,1);const before=$262.agent.monotonicNow();const unpark=Atomics.wait(i32a,0,0,200);const duration=$262.agent.monotonicNow()-before;$262.agent.report(duration);$262.agent.report(unpark);$262.agent.leaving();})");if(typeof f!=="function")throw new Error("worker");}`,
  // 2: a harness-style assertion line by indirect eval, 8 times.
  String.raw`var f=function(){};for(var i=0;i<8;i++){(0,eval)("if (typeof f !== 'function') throw new Error('f is a function');");}`,
  // 3: 32 sequential increments by indirect eval, 4 times.
  String.raw`for(var i=0;i<4;i++){(0,eval)("var x=0;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;x=x+1;");}`,
];

const [mode, ...rest] = process.argv.slice(2);
if (mode === "build") {
  verifyNativeScriptCases(benchmarkCases);
} else if (mode === "time") {
  const rounds = Number(rest[0]);
  const images = rest.slice(1).map((entry) => {
    const split = entry.indexOf("=");
    return { label: entry.slice(0, split), path: entry.slice(split + 1) };
  });
  if (!Number.isSafeInteger(rounds) || rounds < 1 || images.length === 0)
    throw new Error("usage: time <rounds> <label=image>...");
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 === 0 ? images : [...images].reverse();
    for (const image of order)
      for (let index = 0; index < benchmarkCases.length; index++) {
        const started = process.hrtime.bigint();
        const child = spawnSync(
          "/usr/bin/time",
          [
            "-p",
            process.execPath,
            fileURLToPath(import.meta.url),
            "once",
            image.path,
            String(index),
          ],
          { encoding: "utf8" },
        );
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
        const seconds = (name: string): number =>
          Number(
            new RegExp("^" + name + " ([0-9.]+)$", "m").exec(child.stderr)?.[1],
          );
        console.log(
          JSON.stringify({
            round,
            label: image.label,
            index,
            elapsedMs,
            userSeconds: seconds("user"),
            systemSeconds: seconds("sys"),
            outcome: child.stdout.trim(),
          }),
        );
        if (child.status !== 0)
          throw new Error(`${image.label} case ${index} did not complete`);
      }
  }
} else if (mode === "once") {
  const outcome = executeNativeFile(rest[0], 300_000, Number(rest[1]));
  console.log(JSON.stringify(outcome));
  if (outcome.kind !== "completed") process.exitCode = 1;
} else
  throw new Error(
    "usage: build | time <rounds> <label=image>... | once <image> <case>",
  );

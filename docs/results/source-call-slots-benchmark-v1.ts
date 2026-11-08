// Call-heavy native Script benchmark for source-function caller tracking.
//
// build: TINT_BUILD_ONLY=1 node docs/results/source-call-slots-benchmark-v1.ts build
//   Builds one native image (current workspace sources) containing a baseline
//   case and two call-heavy cases, printing the image path and manifest.
// time:  node docs/results/source-call-slots-benchmark-v1.ts time <rounds> <label=image>...
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
  // 1: sloppy ordinary functions (legacy caller policy): 900,000 calls.
  String.raw`function leaf(a){return a+1}function mid(a){return leaf(a)+leaf(a)}var s=0;for(var i=0;i<300000;i++){s=(s+mid(i))%65536}if(s!==38880)throw new Error(String(s));`,
  // 2: strict class construction, methods and arrows (opaque policy): 800,000 calls.
  String.raw`"use strict";class P{constructor(v){this.v=v}get(){return this.v}}const sq=(x)=>x*2;let t=0;for(let i=0;i<200000;i++){t=(t+new P(i).get()+sq(i))%65536}if(t!==50208)throw new Error(String(t));`,
  // 3: function-local sloppy calls (legacy policy): 3,000,000 calls.
  String.raw`function bench(){function leaf(a){return a+1}function mid(a){return leaf(a)+leaf(a)}var s=0;for(var i=0;i<1000000;i++){s=(s+mid(i))%65536}return s}if(bench()!==21056)throw new Error("calls");`,
  // 4: the same function-local loop with the calls inlined (one call total).
  String.raw`function bench(){var s=0;for(var i=0;i<1000000;i++){s=(s+(i+1)+(i+1))%65536}return s}if(bench()!==21056)throw new Error("inline");`,
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

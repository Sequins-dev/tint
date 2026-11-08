import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { Script } from "node:vm";
import {
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import {
  createNativeBatchBuilder,
  prepareNativeScripts,
  nativeTestResources,
} from "./test262-native.ts";
import { NativeImageRunner } from "./test262-native-process.ts";
import { executionPlan } from "./test262-execution.ts";

/** Ordinary Script array element benchmark. Case 0 is an empty control that
 * measures image launch and realm setup; the workloads mirror Test262's
 * regExpUtils buildString chunked element writes, reads through
 * Function.prototype.apply and length truncation. Wall time includes LLDB
 * launch, so each workload is reported against alternating control runs. */
const cases = [
  { name: "control", source: "" },
  {
    name: "number-elements-build-string",
    source: String.raw`function build(start,end){let result="";let codePoints=[];for(let length=0,codePoint=start;codePoint<=end;codePoint++){codePoints[length++]=codePoint;if(length===10000){result+=String.fromCodePoint.apply(null,codePoints);codePoints.length=length=0;}}result+=String.fromCodePoint.apply(null,codePoints);return result;}
const text=build(0x10000,0x10000+119999);if(text.length!==240000||text.codePointAt(0)!==0x10000||text.codePointAt(239998)!==0x10000+119999)throw 1;`,
  },
  {
    name: "string-elements-join",
    source: String.raw`let total=0;for(let round=0;round<6;round++){const parts=[];for(let i=0;i<10000;i++)parts[i]="x"+(i%10);total+=parts.join("").length;parts.length=0;}if(total!==6*10000*2)throw 1;`,
  },
];

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const value =
    sorted.length % 2 === 1
      ? sorted[middle]
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  if (value === undefined) throw new Error("median of empty samples");
  return value;
}

const output = process.argv[2];
const repetitions = Number(process.argv[3] ?? "3");
// Optional exported source tree (for example `git archive main packages`) for a
// matched baseline built with these same tools.
const sourceRoot = process.argv[4] ?? ".";
if (output === undefined || !Number.isInteger(repetitions) || repetitions < 1)
  throw new Error(
    "usage: node tools/bench-script-array-elements.ts <new-report.json> [repetitions] [source-root]",
  );
const prepared = cases.map(({ source }) => {
  new Script(source).runInNewContext();
  const plan = executionPlan(source, "raw", {
    flags: ["raw"],
    features: [],
    includes: [],
  });
  const scripts = prepareNativeScripts(plan, "raw", []);
  assert.ok(scripts.ok, JSON.stringify(scripts));
  return { scripts: scripts.modules, asynchronous: false };
});
const snapshot = workspaceSources(sourceRoot);
const buildStart = performance.now();
const built = createNativeBatchBuilder(snapshot)(prepared);
if (!built.ok) assert.fail(JSON.stringify(built.outcome));
const buildMs = performance.now() - buildStart;
console.error(JSON.stringify({ phase: "built", buildMs }));
const image = new NativeImageRunner(built.bytes, nativeTestResources.timeoutMs);
const samples: { case: string; round: number; wallMs: number }[] = [];
try {
  for (let round = 0; round < repetitions; round++)
    for (let index = 0; index < cases.length; index++) {
      const name = cases[index]?.name ?? "";
      const start = performance.now();
      const outcome = image.run(index);
      const wallMs = performance.now() - start;
      assert.deepEqual(
        outcome,
        { kind: "completed" },
        JSON.stringify({ index, outcome }),
      );
      samples.push({ case: name, round, wallMs });
      console.error(JSON.stringify({ case: name, round, wallMs }));
    }
} finally {
  image.close();
}
const control = median(
  samples.filter((s) => s.case === "control").map((s) => s.wallMs),
);
const summary = cases.map(({ name, source }) => {
  const wall = median(
    samples.filter((s) => s.case === name).map((s) => s.wallMs),
  );
  return {
    case: name,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    medianWallMs: wall,
    medianAboveControlMs: wall - control,
  };
});
const report = {
  kind: "script-array-element-benchmark",
  schemaVersion: 1,
  at: new Date().toISOString(),
  conformance: false,
  sourceSnapshot: workspaceSourceIdentity(snapshot),
  sourceRoot,
  imageSha256: createHash("sha256").update(built.bytes).digest("hex"),
  resources: nativeTestResources,
  host: { cpus: cpus().length, loadAverageAtEnd: loadavg() },
  buildMs,
  repetitions,
  summary,
  samples,
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, summary }));

// Usage: node build-stage4-cases.mjs <toolchain-dir> <output-image>
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const [toolchainArg, output] = process.argv.slice(2), dir = resolve(toolchainArg);
const { readWorkspaceSourceSnapshot, workspaceSourceIdentity } = await import(dir + "/tools/workspace-sources.ts");
const { prepareNativeScripts, createNativeBatchBuilder, nativeTestResources } = await import(dir + "/tools/test262-native.ts");
const { executionPlan } = await import(dir + "/tools/test262-execution.ts");
const { startNativeHeartbeat } = await import(dir + "/tools/test262-native-heartbeat.ts");
const newTargetEval = String.raw`
function check(c, m) { if (!c) throw new Error(m); }
function assertNewTarget(expected) {
  check(eval('new.target') === expected, "direct");
  check((() => eval('new.target'))() === expected, "arrow");
  check(eval('eval("new.target")') === expected, "nested");
  check(eval("eval('eval(\x60new.target\x60)')") === expected, "nested2");
}
for (var i = 0; i < 550; i++) assertNewTarget(undefined);
for (var j = 0; j < 550; j++) new assertNewTarget(assertNewTarget);
`;
const newTargetArrow = String.raw`
function check(c, m) { if (!c) throw new Error(m); }
function assertNewTarget(expected) {
  check(eval('()=>new.target')() === expected, "arrow");
  return () => new.target;
}
for (var i = 0; i < 550; i++) check(assertNewTarget(undefined)() === undefined, "call");
for (var j = 0; j < 550; j++) check(new assertNewTarget(assertNewTarget)() === assertNewTarget, "construct");
`;
const repeatedIndirect = String.raw`
var ieval = eval, total = 0;
for (var k = 0; k < 1000; k++) total += ieval("1 + 2");
if (total !== 3000) throw new Error("indirect");
`;
const templates = String.raw`
function tag(s) { return s; }
var a = eval("tag\x60x\x60"), b = eval("tag\x60x\x60");
if (a === b || a.raw[0] !== "x") throw new Error("template identity");
var sites = [];
for (var i = 0; i < 3; i++) sites.push(eval("tag\x60y\x60"));
if (sites[0] === sites[1] || sites[1] === sites[2]) throw new Error("loop template identity");
function inner() { return eval("tag\x60z\x60"); }
if (inner() === inner()) throw new Error("function template identity");
var shared = eval("var r = []; for (var n = 0; n < 2; n++) r.push(tag\x60w\x60); r");
if (shared[0] !== shared[1]) throw new Error("within-evaluation sharing");
var shared2 = eval("var r = []; for (var n = 0; n < 2; n++) r.push(tag\x60w\x60); r");
if (shared2[0] !== shared2[1] || shared2[0] === shared[0]) throw new Error("cross-evaluation template identity");
`;
// Self-checking differential programs: expected prints come from Node at build time.
const { runInNewContext } = await import("node:vm");
const { evalSourceCacheCorpus: corpus } = await import(new URL("../../../packages/js-engine/test/eval-source-cache-corpus.ts", import.meta.url).href);
const differential = Object.entries(corpus).map(([name, program]) => {
  const expected = [];
  runInNewContext(program, { print: (value) => expected.push(String(value)) });
  return { name, source: "var __out = [];\nfunction print(v) { __out.push(String(v)); }\n" + program + "\nif (__out.join('\\n') !== " + JSON.stringify(expected.join("\n")) + ") throw new Error('differential ' + __out.join('|'));\n" };
});
const labels = ["no-eval", "newTargetEval-repeated-direct", "newTargetArrow-repeated-direct", "repeated-indirect-1000", "template-identity", ...differential.map((d) => "differential-" + d.name)];
const sources = [
  "var cu=1024;var xx=String.fromCharCode(cu);if(xx.length!==1)throw 1;",
  newTargetEval,
  newTargetArrow,
  repeatedIndirect,
  templates,
  ...differential.map((d) => d.source),
];
const sha = (text) => createHash("sha256").update(text).digest("hex");
const heartbeat = startNativeHeartbeat("P eval source cache benchmark image build");
try {
  const cases = sources.map((source) => { const p = prepareNativeScripts(executionPlan(source, "raw", { flags: ["raw"], features: [], includes: [] }), "raw", []); if (!p.ok) throw Error(JSON.stringify(p)); return { scripts: p.modules, asynchronous: false, canSuspend: false }; });
  const snapshot = readWorkspaceSourceSnapshot(dir + "/source-snapshot.json");
  heartbeat.phase("compiling three-case benchmark image");
  const built = createNativeBatchBuilder(snapshot)(cases);
  if (!built.ok) throw Error(JSON.stringify(built));
  writeFileSync(output, built.bytes, { mode: 0o755, flag: "wx" });
  const manifest = { kind: "eval-source-cache-benchmark-image", conformance: false, toolchain: dir, sourceSnapshot: workspaceSourceIdentity(snapshot), cases: sources.map((source, index) => ({ index, label: labels[index], source, sha256: sha(source) })), fixtureSha256: sha(JSON.stringify(sources)), imageSha256: sha(built.bytes), resources: nativeTestResources };
  writeFileSync(output + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ image: output, imageSha256: manifest.imageSha256 }));
} finally { await heartbeat.close(); }

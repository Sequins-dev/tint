// Usage: node build-stage4-cases.mjs <toolchain-dir> <output-image>
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const [toolchainArg, output] = process.argv.slice(2), dir = resolve(toolchainArg);
const { readWorkspaceSourceSnapshot, workspaceSourceIdentity } = await import(dir + "/tools/workspace-sources.ts");
const { prepareNativeScripts, createNativeBatchBuilder, nativeTestResources } = await import(dir + "/tools/test262-native.ts");
const { executionPlan } = await import(dir + "/tools/test262-execution.ts");
const { startNativeHeartbeat } = await import(dir + "/tools/test262-native-heartbeat.ts");
const adversarial = String.raw`
function check(c, m) { if (!c) throw new Error(m); }
for (var i = 0; i < 40; i++) { var s = "s" + i; check(eval('"' + s + '"') === s, "lit" + i); }
var x = "global";
function f1() { var x = "f1"; return eval('x'); }
function f2() { var x = "f2"; return eval('x'); }
check(f1() === "f1" && f2() === "f2", "scope");
function f3() { var x = "local"; return [eval('x'), (0, eval)('x')]; }
var r = f3(); check(r[0] === "local" && r[1] === "global", "indirect");
function sl() { return eval('(function(){ return this; })()'); }
function st() { "use strict"; return eval('(function(){ return this; })()'); }
check(sl() !== undefined && st() === undefined, "strict");
eval('"use strict"; var leakedStrict = 1;'); check(typeof leakedStrict === "undefined", "strictvar");
eval('"use other"; var leakedSloppy = 1;'); check(leakedSloppy === 1, "sloppyvar");
var a1 = "A", b1 = "B"; check(eval('a1') === "A" && eval('b1') === "B" && eval('"a1"') === "a1", "ident");
var o = { p: 1, q: 2 }; check(eval('o["p"]') === 1 && eval('o["q"]') === 2, "key");
check(eval('({ "k1": 1 }).k1') === 1 && eval('({ "k2": 2 }).k2') === 2, "objkey");
check(eval('/ab/').source === "ab" && eval('/cd/').source === "cd", "re");
check(eval('${"`"}t1${"`"}') === "t1" && eval('${"`"}t2${"`"}') === "t2", "tpl");
function tag(s) { return s.raw[0]; }
check(eval('tag${"`"}r1${"`"}') === "r1" && eval('tag${"`"}r2${"`"}') === "r2", "tag");
check(Function('return "m1"')() === "m1" && Function('return "m2"')() === "m2", "fn");
check(eval('o["p"] + o["q"]') === 3, "sum");
check(eval('"abc" === "abc"') === true && eval('"abc" === "abd"') === false, "eq");
check(eval('"x".length') === 1 && eval('"xyz".length') === 3, "len");
check(eval('switch ("b") { case "a": 1; break; case "b": 2; break; }') === 2, "switch1");
check(eval('switch ("a") { case "a": 1; break; case "b": 2; break; }') === 1, "switch2");
check(eval('(function(){ return "inner1"; })()') === "inner1" && eval('(function(){ return "inner2"; })()') === "inner2", "inner");
eval('var dv = "d1"'); check(dv === "d1", "dv1"); eval('var dv = "d2"'); check(dv === "d2", "dv2");
check(eval('"\\u0041"') === "A" && eval('"\\u0042"') === "B", "esc");
check(eval('"" + 1') === "1" && eval('"" + 2') === "2", "concat");
`;
const sources = [
  "var cu=1024;var xx=String.fromCharCode(cu);if(xx.length!==1)throw 1;",
  String.raw`function mix(){var a=[];for(var i=0;i<64;i++)a.push((i*2654435761+12345)%4294967296);var h=1;for(var r=0;r<200000;r++)for(var j=0;j<64;j++){h=(h^a[j])>>>0;h=(((h<<5)|(h>>>27))+(a[(j*7+r)&63]|0))|0;}return h;}var h=mix();if(h!==302454513)throw new Error("bitwise "+h);`,
  adversarial,
];
const sha = (text) => createHash("sha256").update(text).digest("hex");
const heartbeat = startNativeHeartbeat("P stage-7 inline to-uint32 benchmark image build");
try {
  const cases = sources.map((source) => { const p = prepareNativeScripts(executionPlan(source, "raw", { flags: ["raw"], features: [], includes: [] }), "raw", []); if (!p.ok) throw Error(JSON.stringify(p)); return { scripts: p.modules, asynchronous: false, canSuspend: false }; });
  const snapshot = readWorkspaceSourceSnapshot(dir + "/source-snapshot.json");
  heartbeat.phase("compiling three-case benchmark image");
  const built = createNativeBatchBuilder(snapshot)(cases);
  if (!built.ok) throw Error(JSON.stringify(built));
  writeFileSync(output, built.bytes, { mode: 0o755, flag: "wx" });
  const manifest = { kind: "inline-to-uint32-benchmark-image", conformance: false, toolchain: dir, sourceSnapshot: workspaceSourceIdentity(snapshot), cases: sources.map((source, index) => ({ index, label: ["no-eval", "bitwise-unknown-operands-12.8M-function-locals", "adversarial-near-collisions"][index], source, sha256: sha(source) })), fixtureSha256: sha(JSON.stringify(sources)), imageSha256: sha(built.bytes), resources: nativeTestResources };
  writeFileSync(output + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ image: output, imageSha256: manifest.imageSha256 }));
} finally { await heartbeat.close(); }

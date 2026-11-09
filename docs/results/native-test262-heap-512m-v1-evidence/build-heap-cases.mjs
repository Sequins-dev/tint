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
const sources = ["var baseline = 0;","function bench(){function leaf(a){return a+1}function mid(a){return leaf(a)+leaf(a)}var s=0;for(var i=0;i<1000000;i++){s=(s+mid(i))%65536}return s}if(bench()!==21056)throw new Error(\"calls\");","var members = [\"__proto__: null\",\"__proto__: Function.prototype\",\"['__proto__']: null\",\"__proto__() {}\",\"['__proto__']() {}\",\"*__proto__() {}\",\"*['__proto__']() {}\",\"__proto__\",\"get __proto__() { return 42; }\",\"get ['__proto__']() { return 42; }\",\"set __proto__(v) { }\",\"set ['__proto__'](v) { }\"]; var __proto__ = \"string value\"; var made = 0, early = 0; outer: for (var i = 0; i < members.length; i++) for (var j = 0; j < members.length; j++) { if (made + early >= 24) break outer; var code = \"return { \" + members[i] + \", \" + members[j] + \" }\"; try { var h = Function(code); h(); made++; } catch (e) { if (!(e instanceof SyntaxError)) throw e; early++; } } if (made + early !== 24) throw new Error(\"count\");","var keep = []; for (var i = 0; i < 32; i++) keep.push(\"abcdefgh\".repeat(131072) + i); var total = 0; for (var j = 0; j < 160; j++) { var t = \"y\".repeat(1048576) + j; total += t.length; } for (var k = 0; k < 32; k++) if (keep[k].length !== 1048576 + String(k).length) throw new Error(\"keep \" + k); if (total < 160 * 1048576) throw new Error(\"churn\");"];
const sha = (text) => createHash("sha256").update(text).digest("hex");
const heartbeat = startNativeHeartbeat("P stage-9 source-call benchmark image build");
try {
  const cases = sources.map((source) => { const p = prepareNativeScripts(executionPlan(source, "raw", { flags: ["raw"], features: [], includes: [] }), "raw", []); if (!p.ok) throw Error(JSON.stringify(p)); return { scripts: p.modules, asynchronous: false, canSuspend: false }; });
  const snapshot = readWorkspaceSourceSnapshot(dir + "/source-snapshot.json");
  heartbeat.phase("compiling three-case benchmark image");
  const built = createNativeBatchBuilder(snapshot)(cases);
  if (!built.ok) throw Error(JSON.stringify(built));
  writeFileSync(output, built.bytes, { mode: 0o755, flag: "wx" });
  const manifest = { kind: "test262-heap-size-image", conformance: false, toolchain: dir, sourceSnapshot: workspaceSourceIdentity(snapshot), cases: sources.map((source, index) => ({ index, label: ["no-op","3M-local-calls","proto-function-bodies-24","live-32M-chars-churn-160M"][index], source, sha256: sha(source) })), fixtureSha256: sha(JSON.stringify(sources)), imageSha256: sha(built.bytes), resources: nativeTestResources };
  writeFileSync(output + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ image: output, imageSha256: manifest.imageSha256 }));
} finally { await heartbeat.close(); }

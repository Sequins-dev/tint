import assert from "node:assert/strict";
import { workspaceSources } from "../../tools/workspace-sources.ts";
import { createNativeBatchBuilder, prepareNativeScripts, nativeTestResources } from "../../tools/test262-native.ts";
import { NativeImageRunner } from "../../tools/test262-native-process.ts";
import { executionPlan } from "../../tools/test262-execution.ts";
const pre = `function check(c, m) { if (!c) throw new Error(m); }\n`;
const sources = [
  `var body = "0,"; for (var i = 0; i < 21; i++) body = body + body; var arr = JSON.parse("[" + body + "0]"); check(arr.length === Math.pow(2, 21) + 1, "length"); check(arr[2097152] === 0, "last");`,
  `var o = JSON.parse('{"a":[1,{"b":"x\\u0041"}],"a":2,"c":null,"d":true}'); check(o.a === 2 && o.c === null && o.d === true, "dup/literals"); var p = JSON.parse('[1,[2,[3]]]'); check(p[1][1][0] === 3, "nested");`,
  `var seen = []; var r = JSON.parse('{"x":[10,20]}', function (k, v, ctx) { seen.push(k); return v; }); check(seen.join() === "0,1,x,", "reviver order " + seen.join());`,
  `try { JSON.parse("[1,2"); check(false, "no error"); } catch (e) { check(e instanceof SyntaxError, "syntax"); }`,
];
const which = process.argv[2] === undefined ? sources.map((_, i) => i) : process.argv[2].split(",").map(Number);
const cases = which.map((i) => { const plan = executionPlan(pre + sources[i]!, "raw", { flags: ["raw"], features: [], includes: [] }); const p = prepareNativeScripts(plan, "raw", []); assert.ok(p.ok, JSON.stringify(p)); return { scripts: p.modules, asynchronous: plan.asynchronous }; });
console.error(new Date().toISOString(), "building", which.length);
const built = createNativeBatchBuilder(workspaceSources())(cases);
if (!built.ok) assert.fail(JSON.stringify(built.outcome).slice(0, 3000));
const image = new NativeImageRunner(built.bytes, nativeTestResources.timeoutMs);
try { for (let k = 0; k < which.length; k++) { const t = Date.now(); const o = image.run(k) as any; console.log(JSON.stringify({ index: which[k], ms: Date.now() - t, kind: o.kind, detail: o.kind === "completed" ? undefined : String(o.detail ?? o.message ?? "").match(/stop reason = [^\n]*|Error[^\n]*|threw[^\n]*/)?.[0] })); } } finally { image.close(); }

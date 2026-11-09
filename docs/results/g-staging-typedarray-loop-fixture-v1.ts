import assert from "node:assert/strict";
import { workspaceSources } from "../../tools/workspace-sources.ts";
import { createNativeBatchBuilder, prepareNativeScripts, nativeTestResources } from "../../tools/test262-native.ts";
import { NativeImageRunner } from "../../tools/test262-native-process.ts";
import { executionPlan } from "../../tools/test262-execution.ts";
const pre = `function check(c, m) { if (!c) throw new Error(m); }\n`;
const sources = [
  `var ta = new Int16Array(262144); ta.fill(-32768); var u = new Uint16Array(ta.buffer); for (var i = 0; i < 65536; ++i) u[100000 + i] = i; ta.sort(); check(ta[0] === -32768, 'sort');`,
  `function same(a, b) { if (a !== b) throw new Error('x'); } var ta = new Int16Array(262144); for (var i = 0; i < 262144; ++i) same(ta[i], 0);`,
  `var ta = new Int16Array(262144); var s = 0; for (var i = 0; i < 262144; ++i) s += ta[i]; check(s === 0, 'loop');`,
  `function same(a, b) { if (a !== b) throw new Error('x'); } for (var i = 0; i < 262144; ++i) same(i, i);`,
];
const which = process.argv[2] === undefined ? sources.map((_, i) => i) : process.argv[2].split(",").map(Number);
const cases = which.map((i) => { const plan = executionPlan(pre + sources[i]!, "raw", { flags: ["raw"], features: [], includes: [] }); const p = prepareNativeScripts(plan, "raw", []); assert.ok(p.ok, JSON.stringify(p)); return { scripts: p.modules, asynchronous: plan.asynchronous }; });
console.error(new Date().toISOString(), "building", which.length);
const built = createNativeBatchBuilder(workspaceSources())(cases);
if (!built.ok) assert.fail(JSON.stringify(built.outcome).slice(0, 3000));
const image = new NativeImageRunner(built.bytes, nativeTestResources.timeoutMs);
try { for (let k = 0; k < which.length; k++) { const t = Date.now(); const o = image.run(k) as any; console.log(JSON.stringify({ index: which[k], ms: Date.now() - t, kind: o.kind, detail: o.kind === "completed" ? undefined : String(o.detail ?? o.message ?? "").match(/stop reason = [^\n]*|Error[^\n]*|threw[^\n]*/)?.[0] })); } } finally { image.close(); }

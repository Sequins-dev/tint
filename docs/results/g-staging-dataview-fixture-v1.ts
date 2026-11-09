import assert from "node:assert/strict";
import { workspaceSources } from "../../tools/workspace-sources.ts";
import { createNativeBatchBuilder, prepareNativeScripts, nativeTestResources } from "../../tools/test262-native.ts";
import { NativeImageRunner } from "../../tools/test262-native-process.ts";
import { executionPlan } from "../../tools/test262-execution.ts";
const pre = `function check(c, m) { if (!c) throw new Error(m); }\n`;
const sources = [
  `var dv = new DataView(new ArrayBuffer(20 * 1024 * 1024)); dv.setInt8(dv.byteLength - 10, 99); check(dv.getInt8(dv.byteLength - 10) === 99, "big");`,
  `var dv = new DataView(new ArrayBuffer(4)); if (DataView.prototype.getFloat16) { dv.setInt16(0, 18688); check(dv.getFloat16(0) === 10, "f16a"); dv.setFloat16(1, 10); check(dv.getFloat16(1) === 10, "f16b"); check(dv.getInt16(1) === 18688, "f16c"); }`,
  `var buffer1 = new ArrayBuffer(8); var b = Object.create(buffer1); try { new DataView(b); check(false, "nothrow"); } catch (e) { check(e instanceof TypeError, "kind"); }`,
];
const which = process.argv[2] === undefined ? sources.map((_, i) => i) : process.argv[2].split(",").map(Number);
const cases = which.map((i) => { const plan = executionPlan(pre + sources[i]!, "raw", { flags: ["raw"], features: [], includes: [] }); const p = prepareNativeScripts(plan, "raw", []); assert.ok(p.ok, JSON.stringify(p)); return { scripts: p.modules, asynchronous: plan.asynchronous }; });
console.error(new Date().toISOString(), "building", which.length);
const built = createNativeBatchBuilder(workspaceSources())(cases);
if (!built.ok) assert.fail(JSON.stringify(built.outcome).slice(0, 3000));
const image = new NativeImageRunner(built.bytes, nativeTestResources.timeoutMs);
try { for (let k = 0; k < which.length; k++) { const t = Date.now(); const o = image.run(k) as any; console.log(JSON.stringify({ index: which[k], ms: Date.now() - t, kind: o.kind, detail: o.kind === "completed" ? undefined : String(o.detail ?? o.message ?? "").match(/stop reason = [^\n]*|Error[^\n]*|threw[^\n]*/)?.[0] })); } } finally { image.close(); }

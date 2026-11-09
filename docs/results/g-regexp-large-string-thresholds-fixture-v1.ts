import assert from "node:assert/strict";
import { workspaceSources } from "../../tools/workspace-sources.ts";
import { createNativeBatchBuilder, prepareNativeScripts, nativeTestResources } from "../../tools/test262-native.ts";
import { NativeImageRunner } from "../../tools/test262-native-process.ts";
import { executionPlan } from "../../tools/test262-execution.ts";
const pre = `function check(c, m) { if (!c) throw new Error(m); }\n`;
const sources = [
  `var src = '\\\\u{' + '0'.repeat(16777216) + '1234}'; var r = eval('/' + src + '/u'); check(r.exec('\\u1234')[0] === '\\u1234', 'eval16');`,
  `var src = '\\\\u{' + '0'.repeat(25165824) + '1234}'; var r = eval('/' + src + '/u'); check(r.exec('\\u1234')[0] === '\\u1234', 'eval24');`,
  `var src = '\\\\u{' + '0'.repeat(33554432) + '1234}'; var r = eval('/' + src + '/u'); check(r.exec('\\u1234')[0] === '\\u1234', 'eval32');`,
  `var src = '\\\\u{' + '0'.repeat(41943040) + '1234}'; var r = eval('/' + src + '/u'); check(r.exec('\\u1234')[0] === '\\u1234', 'eval40');`,
  `var src = '\\\\u{' + '0'.repeat(50331648) + '1234}'; var r = eval('/' + src + '/u'); check(r.exec('\\u1234')[0] === '\\u1234', 'eval48');`,
  `var src = '\\\\u{' + '0'.repeat(16777216) + '1234}'; var r = new RegExp(src, 'u'); check(r.exec('\\u1234')[0] === '\\u1234', 'ctor16');`,
  `var src = '\\\\u{' + '0'.repeat(25165824) + '1234}'; var r = new RegExp(src, 'u'); check(r.exec('\\u1234')[0] === '\\u1234', 'ctor24');`,
  `var src = '\\\\u{' + '0'.repeat(33554432) + '1234}'; var r = new RegExp(src, 'u'); check(r.exec('\\u1234')[0] === '\\u1234', 'ctor32');`,
  `var src = '\\\\u{' + '0'.repeat(41943040) + '1234}'; var r = new RegExp(src, 'u'); check(r.exec('\\u1234')[0] === '\\u1234', 'ctor40');`,
  `var src = '\\\\u{' + '0'.repeat(50331648) + '1234}'; var r = new RegExp(src, 'u'); check(r.exec('\\u1234')[0] === '\\u1234', 'ctor48');`,
  `var src = '\\\\u{' + '0'.repeat(33554432) + '1234}'; check(src.length === 33554432+7, 'str32');`,
  `var src = '\\\\u{' + '0'.repeat(50331648) + '1234}'; check(src.length === 50331648+7, 'str48');`,
  `var src = '\\\\u{' + '0'.repeat(67108864) + '1234}'; check(src.length === 67108864+7, 'str64');`,
];
const which = process.argv[2] === undefined ? sources.map((_, i) => i) : process.argv[2].split(",").map(Number);
const cases = which.map((i) => { const plan = executionPlan(pre + sources[i]!, "raw", { flags: ["raw"], features: [], includes: [] }); const p = prepareNativeScripts(plan, "raw", []); assert.ok(p.ok, JSON.stringify(p)); return { scripts: p.modules, asynchronous: plan.asynchronous }; });
console.error(new Date().toISOString(), "building", which.length);
const built = createNativeBatchBuilder(workspaceSources())(cases);
if (!built.ok) assert.fail(JSON.stringify(built.outcome).slice(0, 3000));
const image = new NativeImageRunner(built.bytes, nativeTestResources.timeoutMs);
try { for (let k = 0; k < which.length; k++) { const t = Date.now(); const o = image.run(k) as any; console.log(JSON.stringify({ index: which[k], ms: Date.now() - t, kind: o.kind, detail: o.kind === "completed" ? undefined : String(o.detail ?? o.message ?? "").match(/stop reason = [^\n]*|Error[^\n]*|threw[^\n]*/)?.[0] })); } } finally { image.close(); }

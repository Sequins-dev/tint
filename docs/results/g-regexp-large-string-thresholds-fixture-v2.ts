import assert from "node:assert/strict";
import { workspaceSources } from "../../tools/workspace-sources.ts";
import { createNativeBatchBuilder, prepareNativeScripts, nativeTestResources } from "../../tools/test262-native.ts";
import { NativeImageRunner } from "../../tools/test262-native-process.ts";
import { executionPlan } from "../../tools/test262-execution.ts";
const pre = `function check(c, m) { if (!c) throw new Error(m); }\n`;
const sources = [
  `var s = '\\\\u{' + '0'.repeat(16777216) + '1234}'; check(s.length === 16777216+7, 'str16');`,
  `var s = '\\\\u{' + '0'.repeat(20971520) + '1234}'; check(s.length === 20971520+7, 'str20');`,
  `var s = '\\\\u{' + '0'.repeat(25165824) + '1234}'; check(s.length === 25165824+7, 'str24');`,
  `var s = '\\\\u{' + '0'.repeat(29360128) + '1234}'; check(s.length === 29360128+7, 'str28');`,
  `var r = new RegExp('\\\\u{' + '0'.repeat(20971520) + '1234}', 'u'); check(r.exec('\\u1234')[0] === '\\u1234', 'ctor20');`,
  `var r = new RegExp('\\\\u{' + '0'.repeat(29360128) + '1234}', 'u'); check(r.exec('\\u1234')[0] === '\\u1234', 'ctor28');`,
  `var r = eval(\`/\\\\u{\${"0".repeat(Math.pow(2, 24)) + "1234"}}/u\`); check(r.exec('\\u1234')[0] === '\\u1234', 'stmt16');`,
  `function build() { return '/\\\\u{' + '0'.repeat(Math.pow(2, 24)) + '1234}/u'; } var src = build(); var r = eval(src); check(r.exec('\\u1234')[0] === '\\u1234', 'stmt16fn');`,
];
const which = process.argv[2] === undefined ? sources.map((_, i) => i) : process.argv[2].split(",").map(Number);
const cases = which.map((i) => { const plan = executionPlan(pre + sources[i]!, "raw", { flags: ["raw"], features: [], includes: [] }); const p = prepareNativeScripts(plan, "raw", []); assert.ok(p.ok, JSON.stringify(p)); return { scripts: p.modules, asynchronous: plan.asynchronous }; });
console.error(new Date().toISOString(), "building", which.length);
const built = createNativeBatchBuilder(workspaceSources())(cases);
if (!built.ok) assert.fail(JSON.stringify(built.outcome).slice(0, 3000));
const image = new NativeImageRunner(built.bytes, nativeTestResources.timeoutMs);
try { for (let k = 0; k < which.length; k++) { const t = Date.now(); const o = image.run(k) as any; console.log(JSON.stringify({ index: which[k], ms: Date.now() - t, kind: o.kind, detail: o.kind === "completed" ? undefined : String(o.detail ?? o.message ?? "").match(/stop reason = [^\n]*|Error[^\n]*|threw[^\n]*/)?.[0] })); } } finally { image.close(); }

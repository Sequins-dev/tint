import assert from "node:assert/strict";
import { workspaceSources } from "../../tools/workspace-sources.ts";
import { createNativeBatchBuilder, prepareNativeScripts, nativeTestResources } from "../../tools/test262-native.ts";
import { NativeImageRunner } from "../../tools/test262-native-process.ts";
import { executionPlan } from "../../tools/test262-execution.ts";
const pre = `function check(c, m) { if (!c) throw new Error(m); }\n`;
const sources = [
  `var code = "({"; for (var i = 0; i < 1000; i++) code += "['foo' + " + i + "]: 'ok', "; code += "['bar']: 'ok'});"; var obj = eval(code); check(obj.foo999 === 'ok' && obj.bar === 'ok', 'eval1000');`,
  `var code = "({"; for (var i = 0; i < 10; i++) code += "['foo' + " + i + "]: 'ok', "; code += "['bar']: 'ok'});"; var obj = eval(code); check(obj.foo9 === 'ok', 'eval10');`,
  `function* g() { var a = { [yield 1]: 2, [yield 2]: 3}; return a; } var it = g(); it.next(); it.next("hello"); var n = it.next("world"); check(n.value.hello === 2 && n.value.world === 3, 'gen');`,
  `var expr = Symbol("hey"); var a = {get [expr]() { return 3; }, set[expr](v) { throw 2; }, set [expr] (w) { throw 4; }, get[expr](){return 5; }}; check(a[expr] === 5, 'acc'); try { a[expr] = 7; check(false,'nothrow'); } catch (e) { check(e === 4, 'set'); }`,
  `var log = ""; var obj = { "a": log += 'a', get [log += 'b']() {}, [log += 'c']: log += 'd', set [log += 'e'](a) {} }; check(log === "abcde", 'order'); var a; obj = { get [a = "hey"]() { return 1; }, get [a = {b : 4}.b]() { return 2; }, set [/x/.source](a) { throw 3; } }; check(obj.hey === 1 && obj[4] === 2, 'regex');`,
  `var bad = ["({[", "({[expr]})", "({[1, 2]: 3})", "function f() { [x]: 1 }", "({get [1;](): 1})", "a = {get@ [f1](){}, set [f1](a){}}"]; for (var s of bad) { try { Function(s); check(false, 'accepted ' + s); } catch (e) { check(e instanceof SyntaxError, 'kind ' + s); } }`,
  `var i = 0; var a = { [++i] : i, [++i] : i, [++i] : i, [++i] : i, [++i] : i, [++i] : i, [++i] : i, [++i] : i }; for (var j = 1; j < 9; j++) check(a[j] === j, 'idx'); i = 0; a = { [++i] : i, [++i] : i, [++i] : i, [3000] : 2999, [++i] : i, [++i] : i, [++i] : i, [++i] : i, [++i] : i, [++i] : i }; check(a[3000] === 2999, 'big');`,
];
const which = process.argv[2] === undefined ? sources.map((_, i) => i) : process.argv[2].split(",").map(Number);
const cases = which.map((i) => { const plan = executionPlan(pre + sources[i]!, "raw", { flags: ["raw"], features: [], includes: [] }); const p = prepareNativeScripts(plan, "raw", []); assert.ok(p.ok, JSON.stringify(p)); return { scripts: p.modules, asynchronous: plan.asynchronous }; });
console.error(new Date().toISOString(), "building", which.length);
const built = createNativeBatchBuilder(workspaceSources())(cases);
if (!built.ok) assert.fail(JSON.stringify(built.outcome).slice(0, 3000));
const image = new NativeImageRunner(built.bytes, nativeTestResources.timeoutMs);
try { for (let k = 0; k < which.length; k++) { const t = Date.now(); const o = image.run(k) as any; console.log(JSON.stringify({ index: which[k], ms: Date.now() - t, kind: o.kind, detail: o.kind === "completed" ? undefined : String(o.detail ?? o.message ?? "").match(/stop reason = [^\n]*|Error[^\n]*|threw[^\n]*/)?.[0] })); } } finally { image.close(); }

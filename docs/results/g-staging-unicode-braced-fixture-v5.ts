import assert from "node:assert/strict";
import { workspaceSources } from "../../tools/workspace-sources.ts";
import { createNativeBatchBuilder, prepareNativeScripts, nativeTestResources } from "../../tools/test262-native.ts";
import { NativeImageRunner } from "../../tools/test262-native-process.ts";
import { executionPlan } from "../../tools/test262-execution.ts";
import { readFileSync } from "node:fs";
const pre = `var assert = { compareArray(a, b) { if (a === null || b === null) { if (a !== b) throw new Error("null"); return; } if (a.length !== b.length) throw new Error("len"); for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error("el" + i); }, sameValue(a, b) { if (a !== b) throw new Error("sv"); }, throws(C, f) { try { f(); } catch (e) { if (!(e instanceof C)) throw new Error("kind"); return; } throw new Error("nothrow"); } };\n`;
const sources: string[] = JSON.parse(readFileSync(new URL("./g-staging-unicode-cases5.json", import.meta.url), "utf8")).map((c: [string, string]) => c[1].includes("/*HARNESS*/") ? "var assert = undefined;\n" + c[1] : c[1]);
const which = process.argv[2] === undefined ? sources.map((_, i) => i) : process.argv[2].split(",").map(Number);
const cases = which.map((i) => { const plan = executionPlan(pre + sources[i]!, "raw", { flags: ["raw"], features: [], includes: [] }); const p = prepareNativeScripts(plan, "raw", []); assert.ok(p.ok, JSON.stringify(p)); return { scripts: p.modules, asynchronous: plan.asynchronous }; });
console.error(new Date().toISOString(), "building", which.length);
const built = createNativeBatchBuilder(workspaceSources())(cases);
if (!built.ok) assert.fail(JSON.stringify(built.outcome).slice(0, 3000));
const image = new NativeImageRunner(built.bytes, nativeTestResources.timeoutMs);
try { for (let k = 0; k < which.length; k++) { const t = Date.now(); const o = image.run(k) as any; console.log(JSON.stringify({ index: which[k], ms: Date.now() - t, kind: o.kind, detail: o.kind === "completed" ? undefined : String(o.detail ?? o.message ?? "").match(/stop reason = [^\n]*|Error[^\n]*|threw[^\n]*/)?.[0] })); } } finally { image.close(); }

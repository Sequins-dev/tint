// Node-hosted diagnostic (never a native result): cost of the shared-entry hit path
// per direct eval: parse, lower, abstract, hash, in-place match.
import { createSourceTextView } from "@tint/source/text";
import { parseEvalScript, syntaxKeyHash, syntaxKeyMatches, syntaxKey } from "@tint/typescript/syntax";
import { lowerDirectEvalScript, directEvalInFunction } from "../../../packages/js-engine/src/lowering/index.ts";
import { abstractScriptLiterals } from "../../../packages/js-engine/src/native/script-compile.ts";
const sources = process.argv[2] === "try"
  ? ["99; do { -99; try { 39 } catch (e) { -1 } finally { 42; break; -2 }; } while (false);", "99; do { -99; try { [].x.x } catch (e) { -1; } finally { 42; continue; -3 }; -77 } while (false);"]
  : ["new.target", 'eval("new.target")', "eval('eval(`new.target`)')"];
const iterations = Number(process.argv[3] ?? "2000");
const phase = { parse: 0, lower: 0, abstract: 0, hash: 0, match: 0 };
for (let i = 0; i < iterations; i++) for (const text of sources) {
  let t = performance.now();
  const parsed = parseEvalScript(createSourceTextView(text), { strict: false, newTarget: true, superProperty: false, superCall: false });
  if (!parsed.ok) throw Error("parse");
  phase.parse += performance.now() - t; t = performance.now();
  const lowered = lowerDirectEvalScript(parsed.value, text, directEvalInFunction, { privateEnvironment: false, fieldInitializer: false });
  if (!lowered.ok) throw Error(JSON.stringify(lowered));
  phase.lower += performance.now() - t; t = performance.now();
  const abstracted = abstractScriptLiterals(lowered.value);
  phase.abstract += performance.now() - t; t = performance.now();
  const module = abstracted?.module ?? lowered.value;
  syntaxKeyHash(module);
  phase.hash += performance.now() - t; t = performance.now();
  if (i === 0) (globalThis as any).keys = ((globalThis as any).keys ?? new Map()).set(text, syntaxKey(module));
  syntaxKeyMatches(module, (globalThis as any).keys.get(text));
  phase.match += performance.now() - t;
}
const n = iterations * sources.length;
console.log(JSON.stringify({ evals: n, microsPerEval: Object.fromEntries(Object.entries(phase).map(([k, v]) => [k, Math.round((v / n) * 1000)])), loweredStatements: 0 }));

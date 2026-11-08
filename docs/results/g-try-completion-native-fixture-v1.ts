// Diagnostic: run each completion-values case in isolation natively, reporting every outcome.
import assert from "node:assert/strict";
import { workspaceSources } from "../../tools/workspace-sources.ts";
import { createNativeBatchBuilder, prepareNativeScripts, nativeTestResources } from "../../tools/test262-native.ts";
import { NativeImageRunner } from "../../tools/test262-native-process.ts";
import { executionPlan } from "../../tools/test262-execution.ts";
const evalCases: [string, unknown][] = [
  ['99; do { -99; try { 39 } catch (e) { -1 } finally { 42; break; -2 }; } while (false);', 42],
  ['99; do { -99; try { [].x.x } catch (e) { -1; } finally { 42; break; -3 }; } while (false);', 42],
  ['99; do { -99; try { 39 } catch (e) { -1 } finally { break; -2 }; } while (false);', undefined],
  ['99; do { -99; try { [].x.x } catch (e) { -1; } finally { break; -3 }; } while (false);', undefined],
  ['99; do { -99; try { 39 } catch (e) { -1 } finally { 42; break; -3 }; -77 } while (false);', 42],
  ['99; do { -99; try { [].x.x } catch (e) { -1; } finally { 42; break; -3 }; -77 } while (false);', 42],
  ['99; do { -99; try { 39 } catch (e) { -1 } finally { break; -3 }; -77 } while (false);', undefined],
  ['99; do { -99; try { [].x.x } catch (e) { -1; } finally { break; -3 }; -77 } while (false);', undefined],
  ['99; do { -99; try { 39 } catch (e) { -1 } finally { 42; continue; -3 }; } while (false);', 42],
  ['99; do { -99; try { [].x.x } catch (e) { -1; } finally { 42; continue; -3 }; } while (false);', 42],
  ['99; do { -99; try { 39 } catch (e) { -1 } finally { 42; continue; -3 }; -77 } while (false);', 42],
  ['99; do { -99; try { [].x.x } catch (e) { -1 } finally { 42; continue; -3 }; -77 } while (false);', 42],
];
const sources = [
  ...evalCases.map(([code, expected]) => `var r = eval(${JSON.stringify(code)}); if (r !== ${expected === undefined ? "undefined" : expected}) throw new Error("got " + r);`),
  // Same control flow without eval.
  `var n = 0; do { n++; if (n > 3) throw new Error("loop " + n); try { 39 } finally { continue; } } while (false);`,
  `var n = 0; do { n++; if (n > 3) throw new Error("loop " + n); try { [].x.x } catch (e) { -1 } finally { 42; continue; } } while (false);`,
  `var n = 0; do { n++; if (n > 3) throw new Error("loop " + n); try { 39 } finally { break; } } while (false);`,
];
const which = process.argv[2] === undefined ? sources.map((_, i) => i) : process.argv[2].split(",").map(Number);
const cases = which.map((i) => {
  const plan = executionPlan(sources[i]!, "raw", { flags: ["raw"], features: [], includes: [] });
  const prepared = prepareNativeScripts(plan, "raw", []);
  assert.ok(prepared.ok, JSON.stringify(prepared));
  return { scripts: prepared.modules, asynchronous: plan.asynchronous };
});
console.error(new Date().toISOString(), "building", which.length, "cases");
const built = createNativeBatchBuilder(workspaceSources())(cases);
if (!built.ok) assert.fail(JSON.stringify(built.outcome).slice(0, 4000));
const image = new NativeImageRunner(built.bytes, nativeTestResources.timeoutMs);
try {
  for (let k = 0; k < which.length; k++) {
    const started = Date.now();
    const outcome = image.run(k);
    console.log(JSON.stringify({ index: which[k], ms: Date.now() - started, outcome: { ...outcome, detail: (outcome as any).detail?.slice(0, 300) } }));
  }
} finally { image.close(); }

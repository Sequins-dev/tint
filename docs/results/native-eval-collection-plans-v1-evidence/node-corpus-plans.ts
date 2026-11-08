// Host-side equivalence corpus: declared runtime with and without a warm
// collection-plan cache (same compiler owner semantics). Not native evidence.
import { readFileSync, appendFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { lowerDirectEvalScript, lowerScript } from "@tint/js-engine/lowering";
import { prepareManagedSurfaceEntry, declareManagedJitRuntime, createManagedCollectionPlanCache, createManagedTypeContractCache } from "@tint/compiler/native";
import { createManagedScriptFixture } from "../../../tools/managed-script-fixture.ts";
import { managedNativeDifference } from "../../../tools/managed-native-equivalence.ts";
const [list, out] = process.argv.slice(2);
const fixture = createManagedScriptFixture(), runtime = declareManagedJitRuntime(fixture.runtime);
const plans = createManagedCollectionPlanCache(), contracts = createManagedTypeContractCache();
const files = readFileSync(list!, "utf8").split("\n").filter(Boolean);
let n = 0, same = 0, different = 0, coldMs = 0, warmMs = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const parsed = parseScript(createSourceTextView(text));
  if (!parsed.ok) continue;
  for (const mode of ["script", "eval"]) {
    const lowered = mode === "eval" ? lowerDirectEvalScript(parsed.value, text, 0, { privateEnvironment: false, fieldInitializer: false }) : lowerScript(parsed.value, text);
    if (!lowered.ok) continue;
    let t = performance.now();
    const cold = prepareManagedSurfaceEntry({ ...fixture, runtime, module: lowered.value, entry: "execute" });
    coldMs += performance.now() - t; t = performance.now();
    const warm = prepareManagedSurfaceEntry({ ...fixture, runtime, module: lowered.value, entry: "execute", collectionPlans: plans, typeContracts: contracts });
    warmMs += performance.now() - t;
    const difference = cold.ok && warm.ok
      ? managedNativeDifference(cold.value.native, warm.value.native) ?? (isDeepStrictEqual(cold.value.counts, warm.value.counts) && cold.value.entryOffset === warm.value.entryOffset ? undefined : "counts/entry")
      : (cold.ok === warm.ok && (cold.ok || warm.ok || cold.error.stage === warm.error.stage)) ? undefined : "outcome " + JSON.stringify([cold.ok ? "ok" : cold.error, warm.ok ? "ok" : warm.error]).slice(0, 300);
    n++;
    if (difference === undefined) same++; else different++;
    appendFileSync(out!, JSON.stringify({ file: file.replace(/.*test262\/test\//, ""), mode, ok: cold.ok, bytes: cold.ok ? cold.value.native.code.length : undefined, difference }) + "\n");
  }
  console.error(new Date().toISOString(), JSON.stringify({ files: files.indexOf(file) + 1, of: files.length, n, same, different, coldMs: Math.round(coldMs), warmMs: Math.round(warmMs) }));
}
console.log(JSON.stringify({ complete: true, n, same, different, coldMs: Math.round(coldMs), warmMs: Math.round(warmMs) }));

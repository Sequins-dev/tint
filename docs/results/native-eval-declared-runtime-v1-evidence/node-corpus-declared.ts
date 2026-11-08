// Host-side equivalence corpus: unchanged Test262 sources prepared as Scripts
// and direct evals against full and declaration-only runtime providers.
import { readFileSync, appendFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { createSourceTextView } from "@tint/source/text";
import { parseScript, type Statement } from "@tint/typescript/syntax";
import { lowerDirectEvalScript, lowerScript } from "@tint/js-engine/lowering";
import { prepareManagedSurfaceEntry } from "@tint/compiler/native";
import type { SourceModule } from "@tint/typescript/modules/model";
import { createManagedScriptFixture } from "../../../tools/managed-script-fixture.ts";
import { managedNativeDifference } from "../../../tools/managed-native-equivalence.ts";
const [list, out] = process.argv.slice(2);
const fixture = createManagedScriptFixture();
function declare(module: SourceModule): SourceModule {
  const statements: Statement[] = module.module.statements.map((s) =>
    s.kind === "function" && s.body.kind === "block"
      ? { ...s, body: { start: s.body.start, end: s.body.end, kind: "block", statements: [{ start: s.body.start, end: s.body.end, kind: "throw", expression: { start: s.body.start, end: s.body.end, kind: "string", value: "TINT_DECLARATION" } }] } }
      : s);
  return { ...module, module: { ...module.module, statements } };
}
const declared = { ...fixture.runtime, modules: fixture.runtime.modules.map(declare) };
const files = readFileSync(list!, "utf8").split("\n").filter(Boolean);
let n = 0, same = 0, different = 0, fullMs = 0, declMs = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const parsed = parseScript(createSourceTextView(text));
  if (!parsed.ok) continue;
  for (const mode of ["script", "eval"]) {
    const lowered = mode === "eval" ? lowerDirectEvalScript(parsed.value, text, 0, { privateEnvironment: false, fieldInitializer: false }) : lowerScript(parsed.value, text);
    if (!lowered.ok) continue;
    let t = performance.now();
    const full = prepareManagedSurfaceEntry({ ...fixture, module: lowered.value, entry: "execute" });
    fullMs += performance.now() - t; t = performance.now();
    const decl = prepareManagedSurfaceEntry({ ...fixture, runtime: declared, module: lowered.value, entry: "execute" });
    declMs += performance.now() - t;
    const difference = full.ok && decl.ok
      ? managedNativeDifference(full.value.native, decl.value.native) ?? (isDeepStrictEqual(full.value.counts, decl.value.counts) && full.value.entryOffset === decl.value.entryOffset ? undefined : "counts/entry")
      : isDeepStrictEqual(full, decl) ? undefined : "outcome " + JSON.stringify([full.ok ? "ok" : full.error, decl.ok ? "ok" : decl.error]).slice(0, 300);
    n++;
    if (difference === undefined) same++; else different++;
    appendFileSync(out!, JSON.stringify({ file: file.replace(/.*test262\/test\//, ""), mode, ok: full.ok, bytes: full.ok ? full.value.native.code.length : undefined, difference }) + "\n");
  }
  console.error(new Date().toISOString(), JSON.stringify({ files: files.indexOf(file) + 1, of: files.length, n, same, different, fullMs: Math.round(fullMs), declMs: Math.round(declMs) }));
}
console.log(JSON.stringify({ complete: true, n, same, different, fullMs: Math.round(fullMs), declMs: Math.round(declMs) }));

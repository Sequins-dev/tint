// Prototype: prepare eval entries against declaration-only runtime providers and
// compare the complete native module with the full-body runtime result.
import { isDeepStrictEqual } from "node:util";
import { createSourceTextView } from "@tint/source/text";
import { parseScript, type Statement } from "@tint/typescript/syntax";
import { lowerDirectEvalScript, lowerScript } from "@tint/js-engine/lowering";
import { prepareManagedSurfaceEntry } from "@tint/compiler/native";
import type { SourceModule } from "@tint/typescript/modules/model";
import { createManagedScriptFixture } from "../../../tools/managed-script-fixture.ts";
import { managedNativeDifference } from "../../../tools/managed-native-equivalence.ts";

const fixture = createManagedScriptFixture();
function declare(module: SourceModule): SourceModule {
  const statements: Statement[] = module.module.statements.map((s) =>
    s.kind === "function" && s.body.kind === "block"
      ? { ...s, body: { start: s.body.start, end: s.body.end, kind: "block", statements: [{ start: s.body.start, end: s.body.end, kind: "throw", expression: { start: s.body.start, end: s.body.end, kind: "string", value: "TINT_DECLARATION" } }] } }
      : s,
  );
  return { ...module, module: { ...module.module, statements } };
}
const declared = { ...fixture.runtime, modules: fixture.runtime.modules.map(declare) };
const samples = (process.argv[2] ?? "eval:/a/").split("\u0001");
let fullMs = 0, declMs = 0;
for (const sample of samples) {
  const [mode, text] = [sample.slice(0, sample.indexOf(":")), sample.slice(sample.indexOf(":") + 1)];
  const parsed = parseScript(createSourceTextView(text));
  if (!parsed.ok) throw Error("parse " + text);
  const lowered = mode === "eval" ? lowerDirectEvalScript(parsed.value, text, 0, { privateEnvironment: false, fieldInitializer: false }) : lowerScript(parsed.value, text);
  if (!lowered.ok) { console.log("skip-lower", JSON.stringify(text)); continue; }
  let t = performance.now();
  const full = prepareManagedSurfaceEntry({ ...fixture, module: lowered.value, entry: "execute" });
  fullMs += performance.now() - t; t = performance.now();
  const decl = prepareManagedSurfaceEntry({ ...fixture, runtime: declared, module: lowered.value, entry: "execute" });
  declMs += performance.now() - t;
  const same = full.ok && decl.ok ? managedNativeDifference(full.value.native, decl.value.native) === undefined && isDeepStrictEqual(full.value.counts, decl.value.counts) && full.value.entryOffset === decl.value.entryOffset : isDeepStrictEqual(full, decl);
  if (!same && full.ok && decl.ok) { const d = managedNativeDifference(full.value.native, decl.value.native); console.log("  difference", d); const m = /^function (\d+)/.exec(d ?? ""); if (m) { const i = Number(m[1]); console.log("   F", JSON.stringify(full.value.native.functions[i]).slice(0, 400)); console.log("   D", JSON.stringify(decl.value.native.functions[i]).slice(0, 400)); } }
  console.log(same ? "SAME" : "DIFF", full.ok, decl.ok, full.ok ? full.value.native.code.length : full.error.message, decl.ok ? decl.value.native.code.length : decl.error.message, JSON.stringify(text).slice(0, 60));
  if (false) {
    for (const k of Object.keys(full.value.native)) if (!isDeepStrictEqual((full.value.native as any)[k], (decl.value.native as any)[k])) console.log("  differs:", k);
    const fn = full.value.native as any, dn = decl.value.native as any;
    const fi = fn.managedImports.map((x: any) => JSON.stringify(x)), di = dn.managedImports.map((x: any) => JSON.stringify(x));
    console.log("  imports same-set", isDeepStrictEqual([...fi].sort(), [...di].sort()), fi.length, di.length);
    for (let i = 0; i < fi.length; i++) if (fi[i] !== di[i]) { console.log("   F", fi[i].slice(0, 300)); console.log("   D", di[i].slice(0, 300)); break; }
    for (let i = 0; i < fn.functions.length; i++) if (!isDeepStrictEqual(fn.functions[i], dn.functions[i])) { console.log("   Ff", JSON.stringify(fn.functions[i]).slice(0, 300)); console.log("   Df", JSON.stringify(dn.functions[i]).slice(0, 300)); break; }
    console.log("  managedReferences", JSON.stringify(fn.managedReferences).slice(0, 200), JSON.stringify(dn.managedReferences).slice(0, 200));
    console.log("  counts", JSON.stringify(full.value.counts), JSON.stringify(decl.value.counts));
  }
}
console.log(JSON.stringify({ samples: samples.length, fullMs: Math.round(fullMs), declMs: Math.round(declMs) }));

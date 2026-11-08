// Usage (from a worktree or frozen toolchain root): node dump-eval-ir.ts '<eval source>' [--fn=name]
// Prints the optimized managed JIT IR (post optimizeModule/prune) of one indirect-eval entry.
import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { lowerEvalScript } from "@tint/js-engine/lowering";
import { normalizeManagedSurfaceApplications } from "../../../packages/compiler/src/native/managed-applications.ts";
import { adaptManagedSurfaceEntry } from "../../../packages/compiler/src/native/managed-entry.ts";
import { prepareManagedJitProgram, lowerManagedJitProgram } from "../../../packages/compiler/src/native/managed-jit-program.ts";
import { createManagedScriptFixture } from "../../../tools/managed-script-fixture.ts";
const source = process.argv[2] ?? "x=x+1;", only = process.argv.find((a) => a.startsWith("--fn="))?.slice(5);
const fixture = createManagedScriptFixture();
const parsed = parseScript(createSourceTextView(source));
if (!parsed.ok) throw Error("parse");
const lowered = lowerEvalScript(parsed.value, source);
if (!lowered.ok) throw Error("lower " + JSON.stringify(lowered.error));
const read = fixture.read, frame = read.directory.frame!, surface = read.contracts.surface;
const normalized = normalizeManagedSurfaceApplications(lowered.value, fixture.specifiers, fixture.instantiations, surface);
if (!normalized.ok) throw Error(normalized.error);
const adapted = adaptManagedSurfaceEntry(normalized.value.module, "execute", [...fixture.specifiers], surface, { frame }, "none");
if (!adapted.ok) throw Error(adapted.error);
const aliases = surface.declarations.map((d: { name: string }) => d.name);
const prepared = prepareManagedJitProgram(adapted.value.module, adapted.value.entry, adapted.value.view!, aliases, fixture.runtime, undefined, undefined);
if (!prepared.ok) throw Error(prepared.error);
const ir = lowerManagedJitProgram(prepared.value, fixture.runtime.target);
if (!ir.ok) throw Error(ir.error);
const module = ir.value.module;
import("../../../packages/ir/src/scalar/index.ts").then((s: any) => { const stable = s.stableRecordLayouts(module); console.error("stable", stable); module.functions.forEach((fn: any, i: number) => { const g0 = s.provenRecordGuards(fn, 100000, stable), g1 = s.dataflowRecordGuards(fn, 2000000, stable); const g = g0 && g1 ? g0.map((v: number, i: number) => v | g1[i]) : (g0 ?? g1); if (!g) { console.error("fn", i, "no proof"); return; } let rc = 0, rcp = 0, r = 0, rp = 0; for (const b of fn.blocks) { const t = b.terminator; if (t.kind === "record-cell") { rc++; if (g[b.id] === 1) rcp++; } if (t.kind === "record") { r++; if (g[b.id] === 1) rp++; } } if (rc + r) console.error("fn", i, fn.name, "record-cell", rcp + "/" + rc, "record", rp + "/" + r); }); });
const fmt = (o: unknown) => JSON.stringify(o).replace(/"([a-zA-Z]+)":/g, "$1:").replace(/"/g, "'");
let totalBlocks = 0, totalOps = 0;
const kinds = new Map<string, number>();
module.functions.forEach((fn: any, index: number) => {
  totalBlocks += fn.blocks.length;
  for (const b of fn.blocks) { totalOps += b.instructions.length; kinds.set(b.terminator.kind, (kinds.get(b.terminator.kind) ?? 0) + 1); }
  if (only !== undefined && !String(fn.name).includes(only)) return;
  console.log(`fn#${index} ${fn.name} params=${fmt(fn.parameters)} slots=${fn.slots.length} blocks=${fn.blocks.length}${index === ir.value.entry ? " ENTRY" : ""}`);
  fn.blocks.forEach((b: any, bi: number) => {
    console.log(`  b${bi}:`);
    for (const op of b.instructions) console.log("    " + fmt(op));
    console.log("    => " + fmt(b.terminator));
  });
});
console.error(JSON.stringify({ functions: module.functions.length, blocks: totalBlocks, instructions: totalOps, terminators: Object.fromEntries(kinds) }));

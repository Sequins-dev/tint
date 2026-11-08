// Node-hosted diagnostic: repeated eval preparation through the real managed
// Script surface fixture. Host-side evidence only; never a native result.
import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { lowerDirectEvalScript } from "@tint/js-engine/lowering";
import {
  prepareManagedSurfaceEntry,
  createManagedTypeContractCache,
} from "@tint/compiler/native";
import { createManagedScriptFixture } from "../../../tools/managed-script-fixture.ts";

const count = Number(process.argv[2] ?? "20");
const t0 = performance.now();
import type { SourceModule } from "@tint/typescript/modules/model";
import type { Statement } from "@tint/typescript/syntax";
const fixture = createManagedScriptFixture();
function declare(module: SourceModule): SourceModule {
  const statements: Statement[] = module.module.statements.map((s) =>
    s.kind === "function" && s.body.kind === "block"
      ? { ...s, body: { start: s.body.start, end: s.body.end, kind: "block", statements: [{ start: s.body.start, end: s.body.end, kind: "throw", expression: { start: s.body.start, end: s.body.end, kind: "string", value: "TINT_DECLARATION" } }] } }
      : s);
  return { ...module, module: { ...module.module, statements } };
}
if (process.env.DECLARED === "1") (fixture as any).runtime = { ...fixture.runtime, modules: fixture.runtime.modules.map(declare) };
const t1 = performance.now();
console.error(JSON.stringify({ phase: "fixture", ms: t1 - t0 }));
const typeContracts =
  process.env.NO_CACHE === "1" ? undefined : createManagedTypeContractCache();
const times: number[] = [], cpus: number[] = [];
let codeBytes = 0;
for (let i = 0; i < count; i++) {
  const text = "/" + String.fromCharCode(1024 + i) + "/";
  const parsed = parseScript(createSourceTextView(text));
  if (!parsed.ok) throw Error("parse");
  const lowered = lowerDirectEvalScript(parsed.value, text, 0, {
    privateEnvironment: false,
    fieldInitializer: false,
  });
  if (!lowered.ok) throw Error(JSON.stringify(lowered));
  const s = performance.now(), c0 = process.cpuUsage();
  const prepared = prepareManagedSurfaceEntry({
    ...fixture,
    module: lowered.value,
    entry: "execute",
    ...(typeContracts === undefined ? {} : { typeContracts }),
  });
  const e = performance.now(), c1 = process.cpuUsage(c0);
  cpus.push((c1.user + c1.system) / 1000);
  if (!prepared.ok) throw Error(JSON.stringify(prepared));
  codeBytes = prepared.value.native.code.length;
  times.push(e - s);
}
times.sort((a, b) => a - b);
cpus.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    count,
    medianMs: times[Math.floor(times.length / 2)],
    minMs: times[0],
    maxMs: times[times.length - 1],
    codeBytes,
    cpuMedianMs: cpus[Math.floor(cpus.length / 2)],
    cpuMinMs: cpus[0],
  }),
);

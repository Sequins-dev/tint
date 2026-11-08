// Node-hosted: the reader's re-derivation work for the Script surface, with and
// without an owner-scoped restoration memo. Host diagnosis only.
import * as compiler from "@tint/compiler/native";
import { createManagedSurfaceRestorations, restoreManagedSurfaceTypes } from "../../../packages/compiler/src/native/managed-surface-text.ts";
import { createManagedScriptFixture } from "../../../tools/managed-script-fixture.ts";
const fixture = createManagedScriptFixture(), input = fixture.read.directory;
const facts = { records: input.records.flatMap((r) => [r.alias, ...r.aliases].map((alias) => ({ alias, layout: r.layout }))), signatures: input.signatures.flatMap((s) => [s.alias, ...s.aliases].map((alias) => ({ alias, parameters: s.parameters, returnType: s.returnType }))), runtimes: input.runtimes };
for (let round = 0; round < 3; round++) for (const memo of [false, true]) {
  const t = performance.now();
  const restorations = memo ? createManagedSurfaceRestorations() : undefined;
  const restored = restorations ? restorations.restore(input.types) : restoreManagedSurfaceTypes(input.types);
  if (!restored.ok) throw Error(restored.error);
  const t1 = performance.now();
  const rebuilt = (compiler.createManagedSurfaceDirectory as any)(input.name, restored.value, facts, input.frame, ...(restorations ? [restorations] : []));
  if (!rebuilt.ok) throw Error(rebuilt.error);
  console.log(JSON.stringify({ memo, ms: Math.round(performance.now() - t), restoreMs: Math.round(t1 - t), sameDigest: rebuilt.value.directory.digest === input.digest }));
}

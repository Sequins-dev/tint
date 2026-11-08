// Node-side emitted-size driver for runtime-compiled Script entries. Lowers each
// corpus entry as the in-image evaluator does (indirect eval / runtime Script),
// prepares it against the real AOT-selected surface and prints total bytes plus
// a per-function breakdown (--detail). Run from a frozen toolchain root.

import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { lowerScript, lowerEvalScript } from "@tint/js-engine/lowering";
import { prepareManagedSurfaceEntry } from "@tint/compiler/native";
import { createManagedScriptFixture } from "../../tools/managed-script-fixture.ts";

export const corpus: readonly {
  name: string;
  kind: "eval" | "script";
  source: string;
}[] = [
  { name: "empty-statement", kind: "eval", source: ";" },
  { name: "single-expression", kind: "eval", source: "1+1" },
  { name: "identifier", kind: "eval", source: "x" },
  {
    name: "increment-x256",
    kind: "eval",
    source: "var x=0;" + "x=x+1;".repeat(256),
  },
  {
    name: "harness-assert",
    kind: "eval",
    source: "assert.sameValue(typeof f, 'function', 'f is a function');",
  },
  {
    name: "agent-worker",
    kind: "script",
    source: `
  $262.agent.receiveBroadcast(function(sab) {
    const i32a = new Int32Array(sab);
    Atomics.add(i32a, 1, 1);

    const before = $262.agent.monotonicNow();
    const unpark = Atomics.wait(i32a, 0, 0, 200);
    const duration = $262.agent.monotonicNow() - before;

    $262.agent.report(duration);
    $262.agent.report(unpark);
    $262.agent.leaving();
  });
`,
  },
];
const fixture = createManagedScriptFixture();
const detail = process.argv.includes("--detail");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
for (const item of corpus) {
  if (only !== undefined && item.name !== only) continue;
  const parsed = parseScript(createSourceTextView(item.source));
  if (!parsed.ok) throw new Error(item.name + " parse");
  const lowered =
    item.kind === "eval"
      ? lowerEvalScript(parsed.value, item.source)
      : lowerScript(parsed.value, item.source, { runtimeCompiled: true });
  if (!lowered.ok)
    throw new Error(item.name + " lower " + JSON.stringify(lowered.error));
  const started = performance.now();
  const prepared = prepareManagedSurfaceEntry({
    ...fixture,
    module: lowered.value,
    entry: "execute",
  });
  const ms = performance.now() - started;
  if (!prepared.ok)
    throw new Error(item.name + " prepare " + JSON.stringify(prepared.error));
  const n = prepared.value.native;
  const local = n.functions.filter((f) => f.import !== true);
  const helpers = n.helpers.reduce((s, h) => s + h.byteLength, 0);
  const cells = n.cellHelpers.reduce(
    (s, h) => s + (h as { byteLength: number }).byteLength,
    0,
  );
  const fnBytes = local.reduce((s, f) => s + f.byteLength, 0);
  console.log(
    JSON.stringify({
      name: item.name,
      bytes: n.code.length,
      functions: local.length,
      functionBytes: fnBytes,
      helperBytes: helpers,
      helpers: n.helpers.length,
      cellHelperBytes: cells,
      cellHelpers: n.cellHelpers.length,
      strings: n.strings.length,
      managedImports: n.managedImports.length,
      prepareMs: Math.round(ms),
    }),
  );
  if (detail) {
    const byName = [...local]
      .sort((a, b) => b.byteLength - a.byteLength)
      .slice(0, 25);
    for (const f of byName)
      console.log("  fn", f.byteLength, f.frameBytes, f.name);
    const hk = new Map<string, [number, number]>();
    for (const h of n.helpers) {
      const e = hk.get(String(h.kind)) ?? [0, 0];
      e[0]++;
      e[1] += h.byteLength;
      hk.set(String(h.kind), e);
    }
    for (const [k, [c, b]] of [...hk]
      .sort((a, b) => b[1][1] - a[1][1])
      .slice(0, 15))
      console.log("  helper", k, c, b);
  }
}

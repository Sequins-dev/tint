import { registerHooks } from "node:module";
import { appendFileSync, writeFileSync } from "node:fs";
const prefix = process.env.TINT_P_QUALITY_AUDIT;
if (!prefix) throw Error("quality audit output missing");
const emit = (value) =>
  appendFileSync(prefix + ".jsonl", JSON.stringify(value) + "\n");
globalThis.__pQualityDecline = (file, line) => {
  emit({ kind: "proof-decline", file, line });
  return undefined;
};
globalThis.__pQualityList = (args, r) => {
  const m = args[0];
  emit({
    kind: "private-list-proof",
    functions: m.functions.length,
    contracts: args[1].length,
    roots: args[2],
    maxWork: args[3],
    accepted: r !== undefined,
    work: r?.work,
    rewritten: r?.rewritten,
    policy:
      "Diagnostic attempts managed graph proof and discards any transformed result; original representation continues.",
  });
};
globalThis.__pQualityOptimize = (m, r) => {
  const stats = (input) => {
    let instructions = 0,
      blocks = 0,
      slots = 0,
      unused = 0,
      unusedManaged = 0;
    for (const f of input.functions) {
      const used = new Set(f.parameters);
      if (f.receiverSlot !== undefined) used.add(f.receiverSlot);
      slots += f.slots.length;
      for (const b of f.blocks) {
        blocks++;
        if (b.exception) used.add(b.exception.slot);
        const t = b.terminator;
        if (["record", "cell", "record-cell"].includes(t.kind))
          used.add(t.slot);
        for (const op of b.instructions) {
          instructions++;
          if (op.kind === "load" || op.kind === "store") used.add(op.slot);
        }
      }
      for (let i = 0; i < f.slots.length; i++)
        if (!used.has(i)) {
          unused++;
          if (
            [
              "reference",
              "optional-reference",
              "string",
              "optional-string",
              "primitive",
              "general",
              "Uint8Array",
              "Uint16Array",
              "Uint32Array",
              "Float64Array",
            ].includes(f.slots[i])
          )
            unusedManaged++;
        }
    }
    return {
      functions: input.functions.length,
      instructions,
      blocks,
      slots,
      unusedSlots: unused,
      unusedManagedSlots: unusedManaged,
    };
  };
  emit({
    kind: "scalar-optimization",
    before: stats(m),
    after: stats(r.module),
    budgetExhausted: r.budgetExhausted,
    passes: r.passes,
  });
  if (m.functions.length > 10000) {
    writeFileSync(
      prefix + "-complete.json",
      JSON.stringify(
        {
          kind: "expected-compilation-diagnostic-stop",
          nativeExecuted: false,
          reason:
            "Captured large host optimization state before native emission.",
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    throw Error("P_DIAGNOSTIC_QUALITY_CAPTURE_COMPLETE");
  }
};
registerHooks({
  load(url, context, next) {
    const r = next(url, context);
    let source = String(r.source),
      changed = false;
    if (url.endsWith("/tools/test262-native.ts")) {
      const p = "denseReferenceLists: false,";
      if (!source.includes(p)) throw Error("managed private setting missing");
      source = source.replace(p, "denseReferenceLists: true,");
      changed = true;
    }
    if (url.endsWith("/packages/compiler/dist/native/index.js")) {
      const p = "surfacePlans.length === 0 &&";
      if (!source.includes(p)) throw Error("managed surface guard missing");
      source = source.replace(p, "");
      changed = true;
    }
    if (url.endsWith("/packages/ir/dist/optimization/reference-lists.js")) {
      source = source.replace(
        "export function lowerReferenceLists(",
        "function pOriginalPrivateList(",
      );
      source = source
        .split("\n")
        .map((s, i) =>
          s.replaceAll(
            "return undefined;",
            `return globalThis.__pQualityDecline('reference-lists.js',${i + 1});`,
          ),
        )
        .join("\n");
      source +=
        "\nexport function lowerReferenceLists(...args){const r=pOriginalPrivateList(...args);globalThis.__pQualityList(args,r);return undefined;}\n";
      changed = true;
    }
    if (url.endsWith("/packages/ir/dist/optimization/reachability.js")) {
      source = source
        .split("\n")
        .map((s, i) =>
          s.replaceAll(
            "return undefined;",
            `return globalThis.__pQualityDecline('reachability.js',${i + 1});`,
          ),
        )
        .join("\n");
      changed = true;
    }
    if (url.endsWith("/packages/ir/dist/optimization/index.js")) {
      const p = "export function optimizeModule(";
      if (!source.includes(p)) throw Error("optimizer entry missing");
      source =
        source.replace(p, "function pOriginalOptimizeModule(") +
        "\nexport function optimizeModule(...args){const r=pOriginalOptimizeModule(...args);globalThis.__pQualityOptimize(args[0],r);return r;}\n";
      changed = true;
    }
    return changed ? { ...r, source } : r;
  },
});

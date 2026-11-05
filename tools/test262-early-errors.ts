import { test262Checkout, test262Source } from "./test262-checkout.ts";
import { testMetadata, syntaxVariants } from "./test262.ts";
import { executionPlan } from "./test262-execution.ts";
import { createSourceText } from "@tint/source/text";
import { parseModule, parseScript } from "@tint/typescript/syntax";
import { validateJavaScriptBindings } from "@tint/typescript/binding";
const [checkout, selection = "."] = process.argv.slice(2);
if (!checkout)
  throw Error(
    "usage: node tools/test262-early-errors.ts <checkout> [selection]",
  );
const suite = test262Checkout(checkout, selection);
const counts: Record<string, number> = {};
const observations = suite.files.flatMap(({ filename, path }) => {
  const { source, sha256 } = test262Source(filename),
    metadata = testMetadata(source);
  return syntaxVariants(metadata).map((variant) => {
    const plan = executionPlan(source, variant, metadata);
    const bytes = new TextEncoder().encode(plan.source),
      text = createSourceText(bytes, bytes.length);
    if (!text.ok) throw Error("source decoding invariant");
    const parsed =
      plan.goal === "module"
        ? parseModule(text.value, "javascript")
        : parseScript(text.value);
    const diagnostic = parsed.ok
      ? validateJavaScriptBindings(parsed.value, plan.goal)
      : parsed.error;
    const negative =
      metadata.negative?.phase === "parse" ||
      metadata.negative?.phase === "early";
    const syntaxError =
      diagnostic !== undefined &&
      [
        "SYNTAX_ERROR",
        "LEXICAL_ERROR",
        "DUPLICATE_NAME",
        "INVALID_CONTEXT",
      ].includes(diagnostic.code);
    const status =
      diagnostic === undefined
        ? negative
          ? "negative-accepted"
          : "accepted"
        : syntaxError
          ? negative
            ? "negative-rejected"
            : "positive-rejected"
          : "unsupported-or-limit";
    counts[status] = (counts[status] ?? 0) + 1;
    return { path, sha256, variant, metadata, status, diagnostic };
  });
});
console.log(
  JSON.stringify(
    {
      kind: "early-error-inventory",
      conformance: false,
      executed: 0,
      host: process.version,
      revision: suite.revision,
      dirty: suite.dirty,
      selection,
      counts,
      observations,
    },
    null,
    2,
  ),
);

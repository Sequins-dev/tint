import { resolve } from "node:path";
import { test262Checkout, test262Source, within } from "./test262-checkout.ts";
import { testMetadata, syntaxVariants } from "./test262.ts";
import {
  executionPlan,
  judgeExecution,
  executionTotals,
} from "./test262-execution.ts";
import { executeNodeProcess } from "./test262-process.ts";
const [checkout, selection = "language/expressions/array"] =
  process.argv.slice(2);
if (checkout === undefined)
  throw new Error(
    "usage: node tools/test262-run.ts <test262-checkout> [path-under-test]",
  );
const suite = test262Checkout(checkout, selection),
  harnessRoot = resolve(suite.root, "harness");
const observations = suite.files.flatMap(({ filename, path }) => {
  const { source, sha256 } = test262Source(filename),
    metadata = testMetadata(source);
  return syntaxVariants(metadata).map((variant) => {
    const plan = executionPlan(source, variant, metadata);
    const harness = plan.harness.map((name) => ({
      filename: within(harnessRoot, name),
      ...test262Source(within(harnessRoot, name)),
    }));
    const outcome = executeNodeProcess({
      plan,
      filename,
      harness,
      timeoutMs: 5000,
    });
    return {
      path,
      sha256,
      variant,
      metadata,
      harness: harness.map((item, index) => ({
        name: plan.harness[index],
        sha256: item.sha256,
      })),
      outcome,
      status: judgeExecution(metadata, outcome),
    };
  });
});
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      kind: "runtime-execution",
      engine: {
        name: "Node.js",
        version: process.version,
        v8: process.versions.v8,
        adapter: "script-async-v2",
      },
      scope:
        "Selected variants only; unsupported capabilities remain in the denominator. Not a Tint conformance result.",
      revision: suite.revision,
      dirty: suite.dirty,
      selection,
      totals: executionTotals(observations.map((item) => item.status)),
      observations,
    },
    null,
    2,
  ),
);

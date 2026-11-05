import { test262Checkout, test262Source } from "./test262-checkout.ts";
import { testMetadata, syntaxVariants, inspectSyntax } from "./test262.ts";
const [checkout, selection = "language"] = process.argv.slice(2);
if (!checkout)
  throw new Error(
    "usage: node tools/test262-syntax.ts <test262-checkout> [path-under-test]",
  );
const suite = test262Checkout(checkout, selection);
const counts: Record<string, number> = {},
  blockers: Record<string, number> = {};
const observations = suite.files.flatMap(({ filename, path }) => {
  const { source: text, sha256 } = test262Source(filename);
  try {
    const metadata = testMetadata(text);
    return syntaxVariants(metadata).map((variant) => {
      const observation = inspectSyntax(text, variant, metadata);
      counts[observation.status] = (counts[observation.status] ?? 0) + 1;
      if (observation.diagnostic) {
        const key =
          observation.diagnostic.feature ?? observation.diagnostic.message;
        blockers[key] = (blockers[key] ?? 0) + 1;
      }
      return { path, sha256, variant, metadata, ...observation };
    });
  } catch (error) {
    // Host/tool failures stay visible rather than becoming test rejections.
    throw new Error(
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
});
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      kind: "syntax-inventory",
      conformance: false,
      executed: 0,
      revision: suite.revision,
      dirty: suite.dirty,
      selection,
      counts,
      blockers,
      observations,
    },
    null,
    2,
  ),
);

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test262Checkout, test262Source, within } from "./test262-checkout.ts";
import { testMetadata, syntaxVariants } from "./test262.ts";
import { executionPlan, executionTotals } from "./test262-execution.ts";
import {
  isRunTimestamp,
  type NativeObservation,
} from "./native-run-journal.ts";
import { nativeSelectionObservations } from "./native-selection-observations.ts";

const [checkout, journal, selection, output] = process.argv.slice(2);
if (
  checkout === undefined ||
  journal === undefined ||
  selection === undefined ||
  output === undefined
)
  throw Error(
    "usage: node tools/test262-native-extract.ts <checkout> <journal> <selection> <new-report>",
  );
const bytes = readFileSync(journal),
  text = bytes.toString();
if (!text.endsWith("\n"))
  throw Error("native journal has a partial final record");
const rows = text
  .trimEnd()
  .split("\n")
  .map((line) => JSON.parse(line));
const header = rows.shift();
if (
  rows.some(
    (row, index) =>
      ![
        "observation",
        "compilation",
        "diagnostic-pause",
        "resume",
        "complete",
      ].includes(row.kind) ||
      (row.kind === "complete" && index !== rows.length - 1),
  )
)
  throw Error("native journal contains mixed or unexpected run records");
const suite = test262Checkout(checkout, selection);
if (
  header?.kind !== "start" ||
  header.schemaVersion !== 2 ||
  !/^[a-f0-9]{64}$/.test(header.frozenToolchainSha256 ?? "") ||
  header.revision !== suite.revision ||
  header.dirty !== suite.dirty ||
  typeof header.selection !== "string"
)
  throw Error("native journal does not identify this pinned selection");
// Resolve actual membership so explicit shallow selectors remain extractable
// without allowing a child family outside the recorded parent population.
const parentPaths = new Set(
  test262Checkout(checkout, header.selection).files.map((file) => file.path),
);
if (!suite.files.every((file) => parentPaths.has(file.path)))
  throw Error("native journal selection does not cover the requested files");
const harnessRoot = resolve(suite.root, "harness");
const recorded: NativeObservation[] = rows
  .filter((row) => row.kind === "observation")
  .map(({ kind, ...row }) => row);
const recordedInputs = new Map(
  recorded.map((row) => [row.path + "\0" + row.variant, row]),
);
const expected = suite.files.flatMap(({ filename, path }) => {
  const { source, sha256 } = test262Source(filename),
    metadata = testMetadata(source);
  return syntaxVariants(metadata).map((variant) => {
    const plan = executionPlan(source, variant, metadata);
    const prior = recordedInputs.get(path + "\0" + variant);
    // Verify consumed fixture identities without re-running preparation with a
    // potentially newer compiler. Unsupported roots may never discover fixtures.
    const sibling = (name: string): string => {
      if (
        typeof name !== "string" ||
        name.length === 0 ||
        name === "." ||
        name === ".." ||
        /[\\/]/.test(name)
      )
        throw Error("invalid recorded fixture name");
      return within(dirname(filename), name);
    };
    const fixtureNames = new Set<string>();
    for (const fixture of prior?.fixtures ?? []) {
      const bytes = readFileSync(sibling(fixture.name));
      if (
        fixtureNames.has(fixture.name) ||
        createHash("sha256").update(bytes).digest("hex") !== fixture.sha256
      )
        throw Error("selected fixture identity differs");
      fixtureNames.add(fixture.name);
    }
    for (const name of prior?.absent ?? [])
      if (existsSync(sibling(name)))
        throw Error("recorded absent fixture now exists");
    return {
      path,
      sha256,
      metadata,
      variant,
      canSuspend: plan.canSuspend,
      ...(prior?.fixtures === undefined ? {} : { fixtures: prior.fixtures }),
      ...(prior?.absent === undefined ? {} : { absent: prior.absent }),
      harness: plan.harness.map((name) => ({
        name,
        sha256: test262Source(within(harnessRoot, name)).sha256,
      })),
    };
  });
});
const observations = nativeSelectionObservations(recorded, expected);
const batches = new Set(observations.map((row) => row.batch));
// Date the family by when its own observations completed, never by when it
// was extracted: a later extraction must not make older outcomes look newer.
const startedAt = isRunTimestamp(header.startedAt)
  ? header.startedAt
  : rows.find((row) => row.kind === "resume" && isRunTimestamp(row.startedAt))
      ?.startedAt;
let generatedAt: string | undefined = undefined;
for (const row of observations) {
  if (!isRunTimestamp(row.completedAt)) {
    generatedAt = undefined;
    break;
  }
  if (generatedAt === undefined || row.completedAt > generatedAt)
    generatedAt = row.completedAt;
}
const report = {
  schemaVersion: 1,
  kind: "runtime-execution",
  ...(startedAt === undefined ? {} : { startedAt }),
  ...(generatedAt === undefined
    ? {
        generatedAtUnavailable:
          "source journal observations predate recorded completion times",
      }
    : { generatedAt }),
  extractedAt: new Date().toISOString(),
  engine: {
    name: "Tint",
    adapter: header.engine,
    target: "macos-arm64",
    bootstrap: header.nodeVersion,
    debugger: header.debugger,
    debuggerLaunch: header.debuggerLaunch,
    debuggerStdio: header.debuggerStdio,
    debuggerTracing: header.debuggerTracing,
    executableWriteback: header.executableWriteback,
  },
  scope:
    "Complete selected family extracted from a single native journal prefix; all expected variants, source/harness identities, recorded fixture bytes and absent sibling paths verified. No whole-suite coverage claim.",
  variantPolicy:
    "All syntaxVariants; no failures or unsupported variants removed. No combining snapshots or retries.",
  revision: suite.revision,
  dirty: suite.dirty,
  selection,
  sourceSnapshot: header.sourceSnapshot,
  sourceSnapshotFile: header.sourceSnapshotFile,
  frozenToolchainSha256: header.frozenToolchainSha256,
  executionResources: header.executionResources,
  provenance: {
    journal,
    journalSha256: createHash("sha256").update(bytes).digest("hex"),
    journalBytes: bytes.length,
    observedVariants: recorded.length,
  },
  compilation: {
    batchSize: header.batchSize,
    batches: rows
      .filter(
        (row) => row.kind === "compilation" && batches.has(row.compilation.id),
      )
      .map((row) => row.compilation),
  },
  totals: executionTotals(observations.map((row) => row.status)),
  observations,
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({ selection, report: output, totals: report.totals }),
);

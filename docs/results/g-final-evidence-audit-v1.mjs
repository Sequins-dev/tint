// Read-only evidence audit; never runs native tests or combines observations into a native report.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  enumerateVariants,
  readJournal,
  aggregateEvidence,
} from "../../tools/test262-coverage-ledger.ts";
const load = (p) => JSON.parse(readFileSync(p, "utf8")),
  hash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const roots = new Set([
  "AggregateError",
  "Array",
  "ArrayIteratorPrototype",
  "BigInt",
  "Boolean",
  "Date",
  "Error",
  "FinalizationRegistry",
  "Infinity",
  "JSON",
  "Map",
  "MapIteratorPrototype",
  "Math",
  "NaN",
  "NativeErrors",
  "Number",
  "Object",
  "Promise",
  "Proxy",
  "Reflect",
  "Set",
  "SetIteratorPrototype",
  "Symbol",
  "ThrowTypeError",
  "WeakMap",
  "WeakRef",
  "WeakSet",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "global",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "undefined",
]);
const owned = (path) =>
  path.startsWith("built-ins/") && roots.has(path.split("/")[1]);
const baseline = load("docs/results/test262-coverage-ledger-v18.json");
const inventory = enumerateVariants(
  process.argv[2] ??
    "/Users/stephenbelanger/Code/nodejs/tint/.tint-bootstrap/test262",
);
assert.equal(inventory.revision, "91c70759363c46557b694792bf34a2551a7af5ba");
assert.equal(inventory.dirty, false);
assert.equal(
  [...inventory.variants.values()].filter((x) => owned(x.path)).length,
  21619,
);
const reports = [];
const seen = new Set();
async function add(file, date, dateSource) {
  if (seen.has(file)) return;
  seen.add(file);
  let data, observations, totals;
  if (file.endsWith(".jsonl")) {
    const r = await readJournal(file);
    assert.equal(r.complete, true, file);
    data = r.header;
    observations = r.observations;
    totals = r.totals;
  } else {
    data = load(file);
    observations = data.observations;
    totals = data.totals;
  }
  assert.ok(Array.isArray(observations), file);
  if (!observations.some((o) => owned(o.path))) return;
  reports.push({
    file,
    date,
    dateSource,
    engine: data.engine,
    frozenToolchainSha256: data.frozenToolchainSha256 ?? null,
    sourceSnapshot: data.sourceSnapshot ?? null,
    selection: data.selection,
    ...(data.rootSelection === undefined
      ? {}
      : {
          rootSelection: data.rootSelection,
          requestedVariants: data.requestedVariants,
          complete: true,
        }),
    complete: true,
    totals,
    observations,
  });
}
for (const [n, r] of baseline.reports.entries()) {
  const root = (r.rootSelection ?? r.selection).split(" ")[0];
  if (
    root === "." ||
    root === "built-ins" ||
    root === "built-ins/*" ||
    owned(root) ||
    [...roots].some((x) => root === "built-ins/" + x)
  )
    await add(r.file, r.date, r.dateSource);
  if (n % 150 === 0)
    console.error(
      "baseline candidates",
      n,
      "accepted G candidates",
      reports.length,
    );
}
const baseResult = aggregateEvidence(inventory.variants, reports);
assert.equal(
  baseResult.rejected.length,
  0,
  JSON.stringify(baseResult.rejected.slice(0, 3)),
);
const initial = baseResult.ledger.filter((x) => owned(x.path));
for (const family of roots) {
  const expected = baseline.directories.find(
    (x) => x.directory === "built-ins/" + family,
  );
  const actual = initial.filter((x) =>
    x.path.startsWith("built-ins/" + family + "/"),
  );
  assert.equal(actual.length, expected.total);
  for (const status of [
    "pass",
    "fail",
    "unsupported",
    "timeout",
    "crash",
    "harnessError",
    "unmeasured",
  ])
    assert.equal(
      actual.filter((x) => x.status === status).length,
      expected[status] ?? 0,
      family + ":" + status,
    );
}
const children = load("docs/results/g-array-complete-selections-v19.json");
for (const r of children.reports)
  await add(
    r.report,
    children.generatedAt,
    "immutable Array child checkpoint extraction time",
  );
const files = load(
  "docs/results/cluster-g-array-additional-completed-files-v4.json",
);
for (const r of files.reports)
  await add(
    r.report,
    files.createdAt,
    "immutable complete-file checkpoint extraction time",
  );
for (const [report, audit] of [
  [
    "docs/results/test262-number-unmeasured-native-v1.json",
    "docs/results/g-number-unmeasured-completion-audit-v1.json",
  ],
  [
    "docs/results/test262-small-builtins-gaps-native-v1.json",
    "docs/results/g-small-builtins-gaps-completion-audit-v1.json",
  ],
  [
    "docs/results/test262-error-family-current-native-v1.json",
    "docs/results/g-error-family-current-completion-audit-v1.json",
  ],
  [
    "docs/results/test262-date-ledger18-gaps-native-v1.json",
    "docs/results/g-date-ledger18-gaps-completion-audit-v1.json",
  ],
  [
    "docs/results/test262-array-ledger18-gaps-native-v1.json",
    "docs/results/g-array-ledger18-gaps-completion-audit-v1.json",
  ],
  [
    "docs/results/test262-g-stragglers-native-v1.json",
    "docs/results/g-stragglers-completion-audit-v1.json",
  ],
])
  if (existsSync(report) && existsSync(audit))
    await add(
      report,
      load(audit).completedAt,
      "immutable completion audit time",
    );
const result = aggregateEvidence(inventory.variants, reports);
assert.equal(
  result.rejected.length,
  0,
  JSON.stringify(result.rejected.slice(0, 3)),
);
const rows = result.ledger.filter((x) => owned(x.path));
assert.equal(rows.length, 21619);
const totals = {};
for (const r of rows) totals[r.status] = (totals[r.status] ?? 0) + 1;
const directories = [...roots].sort().map((name) => {
  const rs = rows.filter((r) => r.path.startsWith("built-ins/" + name + "/"));
  const counts = {};
  for (const r of rs) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return { selection: "built-ins/" + name, total: rs.length, statuses: counts };
});
const output = {
  kind: "cluster-g-owned-variant-evidence-audit",
  conformance: false,
  generatedAt: new Date().toISOString(),
  revision: inventory.revision,
  ownedFamilies: 37,
  denominator: 21619,
  scope:
    "Deduplicated G-owned pinned variants across separate complete native reports on multiple frozen toolchains and recorded policies. Not a new native execution or uniform current-toolchain/full-suite percentage. UTC Date rechecks remain distinct from historical Manila measurements.",
  baseline: {
    ledger: "docs/results/test262-coverage-ledger-v18.json",
    sha256: hash("docs/results/test262-coverage-ledger-v18.json"),
    inputMain: baseline.inputMain,
    allOwnedBaselineTotalsReproduced: true,
  },
  allPinnedSourceHarnessMetadataAndJudgementsVerified: true,
  allInputSelectionsComplete: true,
  totals,
  directories,
  remaining: rows.filter((r) => r.status !== "pass"),
  reports: reports.map(
    ({
      file,
      date,
      dateSource,
      sourceSnapshot,
      frozenToolchainSha256,
      selection,
      rootSelection,
      requestedVariants,
      totals,
    }) => ({
      file,
      sha256: hash(file),
      date,
      dateSource,
      sourceSnapshot,
      frozenToolchainSha256,
      selection,
      rootSelection,
      requestedVariants,
      totals,
    }),
  ),
};
const file =
  process.argv[3] ?? ".tint-bootstrap/g-final-evidence-audit-reproduction.json";
writeFileSync(file, JSON.stringify(output, null, 2) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({
    file,
    ownedFamilies: 37,
    denominator: 21619,
    totals,
    remaining: output.remaining.length,
  }),
);

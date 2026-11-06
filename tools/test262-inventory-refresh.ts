/**
 * Conservative refresh of a saved native Test262 group inventory.
 *
 * A refresh starts from an immutable base inventory and replaces only
 * explicitly named directory selections. Each replacement must be a complete
 * native report for exactly the population the base inventory already
 * accepted for that family, verified against the pinned checkout's source and
 * harness hashes and against its own completed journal. File modification
 * times never select evidence, so a newer focused or partial report cannot
 * displace a complete family report.
 *
 * This is Node-only tooling over saved evidence; it executes no tests.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const statuses = [
  "pass",
  "fail",
  "unsupported",
  "timeout",
  "harness-error",
  "crash",
] as const;
type Status = (typeof statuses)[number];
interface Totals {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly unsupported: number;
  readonly timeouts: number;
  readonly harnessErrors: number;
  readonly crashes: number;
  readonly passFraction: number | null;
}
interface Observation {
  readonly path: string;
  readonly sha256: string;
  readonly variant: string;
  readonly status: Status;
  readonly harness: readonly {
    readonly name: string;
    readonly sha256: string;
  }[];
}
interface Report {
  readonly kind: string;
  readonly selection: string;
  readonly revision: string;
  readonly dirty: boolean;
  readonly sourceSnapshot: { readonly sha256: string; readonly files: number };
  readonly frozenToolchainSha256?: string;
  readonly resumption?: { readonly restoredVariants: number };
  readonly engine: { readonly adapter: string };
  readonly executionResources: unknown;
  readonly totals: Totals;
  readonly observations: readonly Observation[];
}
interface SelectionEntry {
  selection: string;
  report: string;
  reportSha256: string;
  reportModified: string;
  totals: Totals;
  kind: string;
  sourceSnapshot?: { sha256: string; files: number };
  [key: string]: unknown;
}
interface Family {
  group: string;
  variants: number;
  recordedOutcomes: number;
  nativePassFraction: number | null;
  fullReport: {
    selection: string;
    report: string;
    reportModified: string;
    totals: Totals;
  } | null;
  [key: string]: unknown;
}
export interface Inventory {
  kind: string;
  generatedAt: string;
  revision: string;
  selections: SelectionEntry[];
  families: Family[];
  summary: { families: number; recordedDistinctVariants: number };
  [key: string]: unknown;
}

/** Evidence access, injectable so the policy is testable without a checkout. */
export interface EvidenceSource {
  /** Bytes of a saved report or journal by file name. */
  readResult(name: string): Uint8Array;
  /** Bytes of a pinned checkout file relative to its `test/` directory. */
  readTest(path: string): Uint8Array;
  /** Bytes of a pinned harness include by name. */
  readHarness(name: string): Uint8Array;
  /** Pinned checkout revision. */
  readonly checkoutRevision: string;
  /** Author time of the commit recording a saved report; never a file mtime. */
  recordedAt(name: string): string;
}
export interface Replacement {
  readonly selection: string;
  readonly report: string;
  readonly journal: string;
}
export interface RefreshVerification {
  readonly selection: string;
  readonly previousReport: string;
  readonly report: string;
  readonly reportSha256: string;
  readonly journal: string;
  readonly journalSha256: string;
  readonly population: number;
  readonly sourceHashesVerified: number;
  readonly harnessHashesVerified: number;
  readonly previousTotals: Totals;
  readonly totals: Totals;
  readonly sourceSnapshot: { readonly sha256: string; readonly files: number };
  readonly frozenToolchainSha256: string | null;
  readonly adapter: string;
  readonly executionResourcesSha256: string;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function json<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
function fail(selection: string, message: string): never {
  throw new Error(`${selection}: ${message}`);
}
export function totalsOf(observations: readonly { status: Status }[]): Totals {
  const count = (status: Status) =>
    observations.filter((item) => item.status === status).length;
  const total = observations.length,
    passed = count("pass");
  return {
    total,
    passed,
    failed: count("fail"),
    unsupported: count("unsupported"),
    timeouts: count("timeout"),
    harnessErrors: count("harness-error"),
    crashes: count("crash"),
    passFraction: total === 0 ? null : passed / total,
  };
}
function keys(report: Report, selection: string): Set<string> {
  const result = new Set<string>();
  for (const item of report.observations) {
    if (!statuses.includes(item.status))
      fail(selection, `unknown status ${String(item.status)}`);
    const key = item.path + "\0" + item.variant;
    if (result.has(key)) fail(selection, `duplicate observation ${item.path}`);
    result.add(key);
  }
  return result;
}

/** Verifies one replacement; throws with the first violated criterion. */
export function verifyReplacement(
  base: Inventory,
  replacement: Replacement,
  evidence: EvidenceSource,
): RefreshVerification {
  const { selection } = replacement;
  if (evidence.checkoutRevision !== base.revision)
    fail(selection, "checkout revision differs from the base inventory");
  const entry = base.selections.find((item) => item.selection === selection);
  const family = base.families.find((item) => item.group === selection);
  if (!entry || entry.kind !== "directory")
    fail(selection, "base inventory has no directory selection");
  if (!family?.fullReport || family.fullReport.report !== entry.report)
    fail(selection, "only a complete family report can be replaced");
  if (family.recordedOutcomes !== family.variants)
    fail(selection, "base family is not completely recorded");
  if (entry.report === replacement.report)
    fail(selection, "replacement is already the selected report");

  const previousBytes = evidence.readResult(entry.report);
  if (sha256(previousBytes) !== entry.reportSha256)
    fail(selection, "selected base report no longer matches its hash");
  const previous = json<Report>(previousBytes);
  const reportBytes = evidence.readResult(replacement.report),
    report = json<Report>(reportBytes);

  if (report.kind !== "runtime-execution")
    fail(selection, "replacement is not a runtime execution report");
  if (report.selection !== selection)
    fail(selection, `replacement selection is ${report.selection}`);
  if (report.revision !== base.revision)
    fail(selection, "replacement revision differs from the pinned suite");
  if (report.dirty !== false) fail(selection, "replacement suite was dirty");
  if (report.resumption?.restoredVariants !== 0)
    fail(selection, "replacement must record zero restored variants");
  if (report.observations.length !== report.totals.total)
    fail(selection, "observation count differs from totals");
  if (!isDeepStrictEqual(totalsOf(report.observations), report.totals))
    fail(selection, "totals are inconsistent with observation statuses");

  // Same population as the accepted family: no focused, partial or widened run.
  const population = keys(report, selection);
  if (population.size !== family.variants)
    fail(selection, "replacement does not cover the family population");
  if (!isDeepStrictEqual(population, keys(previous, selection)))
    fail(selection, "replacement population differs from the base report");

  let harnessHashesVerified = 0;
  const harness = new Map<string, string>();
  for (const item of report.observations) {
    if (sha256(evidence.readTest(item.path)) !== item.sha256)
      fail(selection, `source hash differs for ${item.path}`);
    for (const include of item.harness) {
      let digest = harness.get(include.name);
      if (digest === undefined) {
        digest = sha256(evidence.readHarness(include.name));
        harness.set(include.name, digest);
      }
      if (digest !== include.sha256)
        fail(selection, `harness hash differs for ${include.name}`);
      harnessHashesVerified++;
    }
  }

  const journalBytes = evidence.readResult(replacement.journal);
  const rows = new TextDecoder()
    .decode(journalBytes)
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const start = rows[0]!,
    end = rows.at(-1)!;
  if (
    start.kind !== "start" ||
    start.selection !== selection ||
    start.revision !== report.revision ||
    start.dirty !== false ||
    !isDeepStrictEqual(start.sourceSnapshot, report.sourceSnapshot) ||
    start.frozenToolchainSha256 !== report.frozenToolchainSha256
  )
    fail(selection, "journal identity differs from the report");
  if (rows.some((row) => row.kind === "resume"))
    fail(selection, "journal records a resumption");
  const journaled = rows.filter((row) => row.kind === "observation");
  if (
    !isDeepStrictEqual(
      new Set(
        journaled.map((row) => `${String(row.path)}\0${String(row.variant)}`),
      ),
      population,
    )
  )
    fail(selection, "journal observations differ from the report");
  if (end.kind !== "complete" || !isDeepStrictEqual(end.totals, report.totals))
    fail(selection, "journal is not completed with the report totals");

  return {
    selection,
    previousReport: entry.report,
    report: replacement.report,
    reportSha256: sha256(reportBytes),
    journal: replacement.journal,
    journalSha256: sha256(journalBytes),
    population: population.size,
    sourceHashesVerified: report.observations.length,
    harnessHashesVerified,
    previousTotals: entry.totals,
    totals: report.totals,
    sourceSnapshot: report.sourceSnapshot,
    frozenToolchainSha256: report.frozenToolchainSha256 ?? null,
    adapter: report.engine.adapter,
    executionResourcesSha256: sha256(JSON.stringify(report.executionResources)),
  };
}

export interface RefreshOptions {
  readonly baseName: string;
  readonly generatedAt: string;
  readonly replacements: readonly Replacement[];
}

/** Produces a new inventory; the base object is not modified. */
export function refreshInventory(
  base: Inventory,
  evidence: EvidenceSource,
  options: RefreshOptions,
): Inventory {
  const next = structuredClone(base);
  const verifications = options.replacements.map((item) =>
    verifyReplacement(base, item, evidence),
  );
  if (
    new Set(verifications.map((item) => item.selection)).size !==
    verifications.length
  )
    throw new Error("a selection may be replaced only once per refresh");
  for (const verified of verifications) {
    const entry = next.selections.find(
      (i) => i.selection === verified.selection,
    )!;
    const family = next.families.find((i) => i.group === verified.selection)!;
    const reportModified = evidence.recordedAt(verified.report);
    Object.assign(entry, {
      report: verified.report,
      reportSha256: verified.reportSha256,
      reportModified,
      totals: verified.totals,
      sourceSnapshot: verified.sourceSnapshot,
    });
    family.fullReport = {
      selection: verified.selection,
      report: verified.report,
      reportModified,
      totals: verified.totals,
    };
    family.nativePassFraction = verified.totals.passFraction;
  }
  // Same-population replacements cannot change the recorded footprint.
  if (!isDeepStrictEqual(next.summary, base.summary))
    throw new Error("summary changed during a same-population refresh");
  next.generatedAt = options.generatedAt;
  next.policy = {
    ...(base.policy as Record<string, unknown>),
    latest: `Conservative refresh of ${options.baseName}: only the refreshed selections listed here were re-verified; all other rows are inherited unchanged. Different frozen sources and resources remain separate; no combined current whole-suite pass rate.`,
  };
  next.baseInventory = options.baseName;
  next.refreshedSelections = verifications.map((item) => item.selection);
  next.refreshAudit = {
    method:
      "Conservative reconciliation from the base inventory; no full rescan of saved reports. Inherited reportAudit counts describe the base capture.",
    selectionPolicy:
      "Replace only explicitly named directory selections with a complete report for the identical family population, zero restored variants, a clean pinned revision, source and harness hashes matching the pinned checkout, and a completed journal matching the report. Modification times never select evidence; reportModified for refreshed rows is the recording commit's author time.",
    verifications,
  };
  return next;
}

function gitText(cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

/** Evidence source over a results directory and a pinned Test262 checkout. */
export function fileEvidence(
  repository: string,
  results: string,
  checkout: string,
): EvidenceSource {
  if (gitText(checkout, ["status", "--porcelain"]) !== "")
    throw new Error("pinned Test262 checkout is dirty");
  return {
    readResult: (name) => readFileSync(join(results, basename(name))),
    readTest: (path) => readFileSync(join(checkout, "test", path)),
    readHarness: (name) =>
      readFileSync(join(checkout, "harness", basename(name))),
    checkoutRevision: gitText(checkout, ["rev-parse", "HEAD"]),
    recordedAt(name) {
      const time = gitText(repository, [
        "log",
        "-1",
        "--format=%aI",
        "--",
        join(results, basename(name)),
      ]);
      if (!time) throw new Error(`${name} is not committed`);
      return new Date(time).toISOString();
    },
  };
}

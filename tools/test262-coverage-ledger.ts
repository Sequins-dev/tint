import { createHash } from "node:crypto";
import {
  createReadStream,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { test262Checkout, test262Source, within } from "./test262-checkout.ts";
import { testMetadata, syntaxVariants } from "./test262.ts";
import {
  executionPlan,
  executionTotals,
  judgeExecution,
} from "./test262-execution.ts";
import type {
  NativeObservation,
  NativeObservationInput,
} from "./native-run-journal.ts";

export const pinnedRevision = "91c70759363c46557b694792bf34a2551a7af5ba";
const scope =
  "Deduplicated aggregate of separate complete native runs on varying toolchains; not a whole-suite run or a measurement of the current compiler. Pass fraction is a current-evidence lower bound over the full pinned denominator.";
const precedence =
  "Latest report generatedAt/timestamp/completedAt/startedAt, otherwise linked journal start time or first Git addition commit date, otherwise report first Git addition commit date. Equal dates: lexically greatest repository-relative filename wins. No filesystem mtimes. Missing dates reject evidence. Canonical reports and journals compete by this same rule; later failures replace earlier passes.";
const key = (row: Pick<NativeObservationInput, "path" | "variant">) =>
  row.path + "\0" + row.variant;
const progress = (message: string) =>
  console.error(`[coverage-ledger ${new Date().toISOString()}] ${message}`);

/** Publishing an extraction must not make its older observations appear newer. */
export function fallbackEvidenceDate(
  file: string,
  linkedJournal: string | undefined,
  additions: ReadonlyMap<string, string>,
): { date: string; dateSource: string } {
  const journalDate =
    linkedJournal === undefined ? undefined : additions.get(linkedJournal);
  return journalDate === undefined
    ? {
        date: additions.get(file) ?? "",
        dateSource: "first Git addition commit (run date unavailable)",
      }
    : {
        date: journalDate,
        dateSource:
          "linked journal first Git addition commit (run date unavailable)",
      };
}

export function enumerateVariants(checkout: string) {
  progress("reading checkout revision, tracked state and file inventory");
  const suite = test262Checkout(checkout, ".");
  const variants = new Map<string, NativeObservationInput>();
  const hashes = new Map<string, string>();
  for (const [index, file] of suite.files.entries()) {
    const { source, sha256 } = test262Source(file.filename);
    const metadata = testMetadata(source);
    for (const variant of syntaxVariants(metadata)) {
      const plan = executionPlan(source, variant, metadata);
      const harness = plan.harness.map((name) => {
        if (!hashes.has(name))
          hashes.set(
            name,
            test262Source(within(resolve(suite.root, "harness"), name)).sha256,
          );
        return { name, sha256: hashes.get(name)! };
      });
      const input = {
        path: file.path,
        variant,
        sha256,
        metadata,
        harness,
        canSuspend: plan.canSuspend,
      };
      variants.set(key(input), input);
    }
    if (index % 5000 === 0)
      progress(
        `inventory ${index}/${suite.files.length} files, ${variants.size} variants`,
      );
  }
  return {
    revision: suite.revision,
    dirty: suite.dirty,
    files: suite.files.length,
    variants,
  };
}

// JSON is an external report format. Runtime validation happens before rows enter
// the ledger; the structural type here describes the runner's persisted envelope.
interface Header {
  kind?: string;
  revision?: string;
  dirty?: boolean;
  engine?: string | { name?: string; adapter?: string; target?: string };
  selection?: string;
  rootSelection?: string;
  requestedVariants?: number;
  complete?: boolean;
  generatedAt?: string;
  timestamp?: string;
  completedAt?: string;
  startedAt?: string;
  frozenToolchainSha256?: string;
  sourceSnapshot?: { sha256?: string };
  derivation?: { frozenToolchainSha256?: string; journal?: string };
  provenance?: { journal?: string };
  totals?: ReturnType<typeof executionTotals>;
  observations?: NativeObservation[];
}
export interface Evidence {
  file: string;
  date: string;
  dateSource: string;
  engine: Header["engine"];
  frozenToolchainSha256: string | null;
  sourceSnapshot: Header["sourceSnapshot"] | null;
  selection: string;
  rootSelection?: string;
  requestedVariants?: number;
  complete?: boolean;
  totals: ReturnType<typeof executionTotals> | undefined;
  observations: NativeObservation[];
}
export async function readJournal(file: string) {
  const stream = createReadStream(file);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let header: Header | undefined;
  let complete = false;
  let totals: ReturnType<typeof executionTotals> | undefined;
  const observations: NativeObservation[] = [];
  try {
    for await (const line of lines) {
      const row = JSON.parse(line);
      if (header === undefined) {
        if (row.kind !== "start") throw Error("missing journal start");
        header = row;
      } else if (complete) throw Error("record after complete");
      else if (row.kind === "observation") observations.push(row);
      else if (row.kind === "complete") {
        complete = true;
        totals = row.totals;
      } else if (
        !["compilation", "diagnostic-pause", "resume"].includes(row.kind)
      )
        throw Error("unknown journal record");
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  // readline accepts unterminated lines, whereas runner journals require a final newline.
  const { readSync, fstatSync } = await import("node:fs");
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size,
      last = Buffer.alloc(1);
    if (size === 0) throw Error("empty journal");
    readSync(fd, last, 0, 1, size - 1);
    if (last[0] !== 10) throw Error("truncated journal");
  } finally {
    closeSync(fd);
  }
  if (
    complete &&
    !isDeepStrictEqual(
      totals,
      executionTotals(observations.map((row) => row.status)),
    )
  )
    throw Error("inconsistent journal completion totals");
  return { header, observations, complete, totals };
}
function selected(path: string, selection: string) {
  return (
    selection === "." || path === selection || path.startsWith(selection + "/")
  );
}
function validate(
  row: NativeObservation,
  expected: Map<string, NativeObservationInput>,
): string | undefined {
  const input = expected.get(key(row));
  if (!input) return "path/variant not in pinned denominator";
  if (row.sha256 !== input.sha256) return "source sha256 mismatch";
  if (!isDeepStrictEqual(row.harness, input.harness))
    return "harness names/order/hashes mismatch";
  if (!isDeepStrictEqual(row.metadata, input.metadata))
    return "metadata mismatch";
  if (
    !row.outcome ||
    !["completed", "error", "unsupported", "timeout", "crash"].includes(
      row.outcome.kind,
    )
  )
    return "invalid outcome";
  if (judgeExecution(input.metadata, row.outcome) !== row.status)
    return "outcome/status mismatch";
  return undefined;
}
export function aggregateEvidence(
  expected: Map<string, NativeObservationInput>,
  reports: Evidence[],
) {
  const chosen = new Map<
    string,
    { observation: NativeObservation; evidence: Evidence }
  >();
  const rejected: {
    file: string;
    reason: string;
    path?: string;
    variant?: string;
  }[] = [];
  const accepted: Evidence[] = [];
  let processed = 0;
  for (const report of [...reports].sort(
    (a, b) =>
      Date.parse(a.date) - Date.parse(b.date) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  )) {
    if (++processed % 100 === 0)
      progress(`validated ${processed}/${reports.length} candidates`);
    let invalid = false;
    const seen = new Set<string>();
    const reject = (reason: string, row?: NativeObservation) => {
      invalid = true;
      rejected.push({
        file: report.file,
        reason,
        ...(row ? { path: row.path, variant: row.variant } : {}),
      });
    };
    for (const row of report.observations) {
      const reason = validate(row, expected);
      if (reason) reject(reason, row);
      else if (!selected(row.path, report.rootSelection ?? report.selection))
        reject("observation outside selection", row);
      else if (seen.has(key(row))) reject("duplicate observation", row);
      seen.add(key(row));
    }
    const count =
      report.rootSelection !== undefined
        ? (report.requestedVariants ?? 0)
        : [...expected.values()].filter((row) =>
            selected(row.path, report.rootSelection ?? report.selection),
          ).length;
    if (count === 0 || seen.size !== count)
      reject(`incomplete selection: ${seen.size}/${count} variants`);
    if (
      !isDeepStrictEqual(
        report.totals,
        executionTotals(report.observations.map((row) => row.status)),
      )
    )
      reject("inconsistent report totals");
    if (!Number.isFinite(Date.parse(report.date)))
      reject("missing/invalid evidence date");
    if (
      report.complete === false ||
      (report.rootSelection !== undefined && report.complete !== true)
    )
      reject("explicit subset is not complete");
    if (invalid) continue;
    accepted.push(report);
    for (const observation of report.observations)
      chosen.set(key(observation), { observation, evidence: report });
  }
  const ledger = [...expected.values()].map((input) => {
    const found = chosen.get(key(input));
    return {
      path: input.path,
      variant: input.variant,
      sha256: input.sha256,
      syntaxNegative: ["parse", "early"].includes(
        input.metadata.negative?.phase ?? "",
      ),
      status: found?.observation.status ?? ("unmeasured" as const),
      report: found?.evidence.file ?? null,
    };
  });
  return { ledger, rejected, accepted };
}
type LedgerRow = ReturnType<typeof aggregateEvidence>["ledger"][number];
type ReportProvenance = Omit<Evidence, "observations" | "totals"> & {
  selectedVariants: number;
};

/** Canonical UTF-8 JSONL: binary path/variant order, fixed field order, one LF
 * after every compact JSON object, including the final row. No run timestamps. */
export function canonicalTable(rows: readonly LedgerRow[]) {
  const text = [...rows]
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
    .map(
      (row) =>
        JSON.stringify({
          path: row.path,
          variant: row.variant,
          sha256: row.sha256,
          syntaxNegative: row.syntaxNegative,
          status: row.status,
          report: row.report,
        }) + "\n",
    )
    .join("");
  return { text, sha256: createHash("sha256").update(text).digest("hex") };
}

export function compactEvidence(
  reports: ReportProvenance[],
  table: ReturnType<typeof canonicalTable>,
  variants: number,
) {
  return {
    acceptedArtifacts: reports.map((report) => report.file).sort(),
    reports: reports.filter((report) => report.selectedVariants > 0),
    fullTable: {
      format:
        "UTF-8 JSONL; binary path/variant order; fields path, variant, sha256, syntaxNegative, status, report; compact JSON; final LF",
      sha256: table.sha256,
      bytes: Buffer.byteLength(table.text),
      variants,
    },
  };
}

function counts(rows: { status: string }[]) {
  const count = (status: string) =>
    rows.filter((row) => row.status === status).length;
  return {
    total: rows.length,
    pass: count("pass"),
    fail: count("fail"),
    unsupported: count("unsupported"),
    harnessError: count("harness-error"),
    crash: count("crash"),
    timeout: count("timeout"),
    unmeasured: count("unmeasured"),
  };
}
function directory(path: string) {
  const parts = path.split("/");
  // Families at depth 3 for language, Annex B, Temporal and staging; other
  // built-ins/Intl use depth 2 to keep methods of one API together.
  return parts
    .slice(
      0,
      Math.min(
        parts.length - 1,
        ["language", "annexB", "staging"].includes(parts[0]!) ||
          parts[1] === "Temporal"
          ? 3
          : 2,
      ),
    )
    .join("/");
}
function git(...args: string[]) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}
export async function main(args: string[]) {
  const [checkout, output, flag, fullPath] = args;
  if (
    !checkout ||
    !output ||
    !(
      args.length === 2 ||
      (args.length === 4 && flag === "--full" && fullPath)
    ) ||
    !/test262-coverage-ledger-v\d+\.json$/.test(output)
  )
    throw Error(
      "usage: node tools/test262-coverage-ledger.ts <pinned-checkout> <docs/results/test262-coverage-ledger-vN.json> [--full <ignored-jsonl-path>]",
    );
  if (fullPath) {
    try {
      execFileSync("git", ["check-ignore", "--quiet", "--", fullPath]);
    } catch {
      throw Error(
        "--full destination must be ignored by Git (for example .tint-bootstrap/coverage-ledger.jsonl)",
      );
    }
  }
  const inventory = enumerateVariants(checkout);
  if (
    inventory.revision !== pinnedRevision ||
    inventory.dirty ||
    inventory.variants.size !== 103264
  )
    throw Error("expected clean pinned checkout with 103264 variants");
  const inputMain = git("rev-parse", "main");
  const files = git(
    "ls-tree",
    "-r",
    "--name-only",
    inputMain,
    "--",
    "docs/results",
  )
    .split("\n")
    .filter(
      (file) =>
        /\.(json|jsonl)$/.test(file) && !file.includes("coverage-ledger"),
    );
  const additions = new Map<string, string>();
  let date = "";
  for (const line of git(
    "log",
    inputMain,
    "--diff-filter=A",
    "--format=@%cI",
    "--name-only",
    "--",
    "docs/results",
  ).split("\n")) {
    if (line.startsWith("@")) date = line.slice(1);
    else if (line) additions.set(line, date);
  }
  const reports: Evidence[] = [],
    excluded: { file: string; reason: string }[] = [];
  for (const [index, file] of files.entries()) {
    if (index % 100 === 0)
      progress(
        `evidence ${index}/${files.length} files, ${reports.length} native candidates`,
      );
    try {
      let header: Header,
        observations: NativeObservation[],
        totals: Evidence["totals"];
      if (file.endsWith(".jsonl")) {
        const journal = await readJournal(file);
        if (!journal.complete) {
          excluded.push({ file, reason: "interrupted journal prefix" });
          continue;
        }
        header = journal.header!;
        observations = journal.observations;
        totals = journal.totals;
        if (
          typeof header.engine !== "string" ||
          !header.engine.startsWith("native-")
        )
          continue;
      } else {
        header = JSON.parse(readFileSync(file, "utf8"));
        if (
          header.kind !== "runtime-execution" ||
          typeof header.engine !== "object" ||
          header.engine?.name !== "Tint" ||
          !header.engine.adapter?.startsWith("native-")
        )
          continue;
        observations = header.observations ?? [];
        totals = header.totals;
      }
      if (
        header.revision !== pinnedRevision ||
        header.dirty !== false ||
        !header.selection
      ) {
        excluded.push({ file, reason: "revision/dirty/selection mismatch" });
        continue;
      }
      let recordedDate =
        header.generatedAt ??
        header.timestamp ??
        header.completedAt ??
        header.startedAt;
      let dateSource = "report timestamp";
      const journalName =
        header.provenance?.journal ?? header.derivation?.journal;
      let linkedJournal: string | undefined;
      if (!recordedDate && journalName) {
        // Only read a linked journal's first line; never follow arbitrary external paths.
        linkedJournal = files.find(
          (f) =>
            f === journalName ||
            f === "docs/results/" + journalName.split("/").at(-1),
        );
        if (linkedJournal) {
          const reader = createInterface({
            input: createReadStream(linkedJournal),
            crlfDelay: Infinity,
          });
          try {
            for await (const line of reader) {
              recordedDate = JSON.parse(line).startedAt;
              break;
            }
          } finally {
            reader.close();
          }
          if (recordedDate) dateSource = "linked journal startedAt";
        }
      }
      if (!recordedDate) {
        const fallback = fallbackEvidenceDate(file, linkedJournal, additions);
        recordedDate = fallback.date;
        dateSource = fallback.dateSource;
      }
      reports.push({
        file,
        date: recordedDate ?? "",
        dateSource,
        engine: header.engine,
        frozenToolchainSha256:
          header.frozenToolchainSha256 ??
          header.derivation?.frozenToolchainSha256 ??
          null,
        sourceSnapshot: header.sourceSnapshot ?? null,
        selection: header.selection,
        ...(header.complete === undefined ? {} : { complete: header.complete }),
        ...(header.rootSelection === undefined
          ? {}
          : {
              rootSelection: header.rootSelection,
              requestedVariants: header.requestedVariants ?? 0,
              complete: header.complete ?? false,
            }),
        totals,
        observations,
      });
    } catch (error) {
      excluded.push({ file, reason: String(error) });
    }
  }
  progress(`validating ${reports.length} complete native candidates`);
  const { ledger, rejected, accepted } = aggregateEvidence(
    inventory.variants,
    reports,
  );
  const groups = new Map<string, typeof ledger>();
  for (const row of ledger) {
    const name = directory(row.path);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(row);
  }
  const directories = [...groups]
    .map(([directory, rows]) => ({ directory, ...counts(rows) }))
    .sort(
      (a, b) =>
        b.total - b.pass - (a.total - a.pass) ||
        a.directory.localeCompare(b.directory),
    );
  const totals = counts(ledger);
  const used = new Set(ledger.map((row) => row.report));
  const provenance = accepted.map(({ observations, totals, ...report }) => ({
    ...report,
    selectedVariants: ledger.filter((row) => row.report === report.file).length,
  }));
  const current = provenance.filter((report) => used.has(report.file));
  const spread = new Map<string, number>();
  for (const report of current) {
    const id =
      report.frozenToolchainSha256 ??
      `unknown frozen toolchain; source snapshot ${report.sourceSnapshot?.sha256 ?? "unknown"}`;
    spread.set(id, (spread.get(id) ?? 0) + report.selectedVariants);
  }
  const table = canonicalTable(ledger);
  const result = {
    schemaVersion: 2,
    kind: "test262-coverage-ledger",
    generatedAt: new Date().toISOString(),
    scope,
    precedence,
    inputMain,
    revision: pinnedRevision,
    files: inventory.files,
    denominator: ledger.length,
    totals,
    passFractionLowerBound: totals.pass / ledger.length,
    directories,
    evidenceAge: {
      oldest: current[0]?.date ?? null,
      newest: current.at(-1)?.date ?? null,
      note: "Git addition dates are proxies where run timestamps are absent; unknown toolchains remain explicitly unknown.",
    },
    toolchains: [...spread].map(([identity, variants]) => ({
      identity,
      variants,
    })),
    ...compactEvidence(provenance, table, ledger.length),
    excluded,
    rejected,
  };
  const markdown = [
    "# Native Test262 coverage ledger",
    "",
    scope,
    "",
    `Pinned revision: \`${pinnedRevision}\`. Input main: \`${inputMain}\`. Generated: ${result.generatedAt}.`,
    "",
    `**${totals.pass}/${ledger.length} passes (${(100 * result.passFractionLowerBound).toFixed(2)}% current-evidence lower bound).** Fail ${totals.fail}; unsupported ${totals.unsupported}; harness error ${totals.harnessError}; crash ${totals.crash}; timeout ${totals.timeout}; unmeasured ${totals.unmeasured}.`,
    "",
    `Evidence dates: ${result.evidenceAge.oldest} through ${result.evidenceAge.newest}; ${spread.size} toolchain/source identities (including unknown). ${result.evidenceAge.note} See JSON reports/toolchains for per-report dates, date sources and selected-variant counts.`,
    "",
    `${accepted.length} accepted complete artifacts; ${excluded.length} excluded artifacts; ${rejected.length} rejection diagnostics. Rejected artifacts contribute no observations. Syntax negatives remain in the denominator; parser-gate reports are not imported.`,
    "",
    precedence,
    "",
    `Canonical full-table SHA-256: \`${table.sha256}\`. The per-variant table is omitted from committed output; regenerate with \`--full .tint-bootstrap/coverage-ledger.jsonl\` and verify with \`shasum -a 256\`.`,
    "",
    "Directories are disjoint depth 2–3 families, sorted by unmeasured plus non-pass variants.",
    "",
    "| Directory | Total | Pass | Fail | Unsupported | Harness error | Crash | Timeout | Unmeasured |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...directories.map(
      (d) =>
        `| ${d.directory} | ${d.total} | ${d.pass} | ${d.fail} | ${d.unsupported} | ${d.harnessError} | ${d.crash} | ${d.timeout} | ${d.unmeasured} |`,
    ),
    "",
  ].join("\n");
  if (fullPath) writeFileSync(fullPath, table.text, { flag: "wx" });
  // Reserve both immutable destinations before writing either committed artifact.
  const summary = output.replace(/\.json$/, ".md");
  const jsonFd = openSync(output, "wx");
  try {
    const mdFd = openSync(summary, "wx");
    try {
      writeFileSync(jsonFd, JSON.stringify(result, null, 2) + "\n");
      writeFileSync(mdFd, markdown);
    } finally {
      closeSync(mdFd);
    }
  } finally {
    closeSync(jsonFd);
  }
  progress(`wrote ${output}: ${JSON.stringify(totals)}`);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv.slice(2));

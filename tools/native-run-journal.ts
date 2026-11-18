import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  judgeExecution,
  type ExecutionOutcome,
  type ExecutionStatus,
  executionTotals,
} from "./test262-execution.ts";
import type { TestMetadata, SyntaxVariant } from "./test262.ts";
import type { NativeDiagnosticPause } from "./native-run-control.ts";
export interface NativeObservationInput {
  readonly path: string;
  readonly sha256: string;
  readonly variant: SyntaxVariant;
  readonly canSuspend: boolean;
  readonly metadata: TestMetadata;
  readonly absent?: readonly string[];
  readonly fixtures?: readonly {
    readonly name: string;
    readonly sha256: string;
  }[];
  readonly harness: readonly {
    readonly name: string | undefined;
    readonly sha256: string;
  }[];
}
export interface NativeObservation extends NativeObservationInput {
  readonly outcome: ExecutionOutcome;
  readonly status: ExecutionStatus;
  readonly elapsedMs: number;
  readonly batch?: number;
  /** ISO time the variant's outcome was recorded; absent in older journals. */
  readonly completedAt?: string;
}
export interface NativeCompilation {
  readonly id: number;
  readonly variants: number;
  readonly compileMs: number;
  /** A staged image's first launch, separate from every case's execution
   * budget; absent for failed builds and in older journals. */
  readonly admissionMs?: number;
  /** Linked-unit batches: compiling their cases' Script units while routing
   * them (memoized, so not part of `compileMs`). */
  readonly unitCompileMs?: number;
  /** The first batch after the linked-unit host was compiled or loaded from
   * its cache records that one-time cost here. */
  readonly hostPreparationMs?: number;
  readonly outcome: string;
  readonly kind: "syntax" | "execution";
  /** Present for batches of separately linked Script units. */
  readonly linking?: "units";
  /** Why an unsupported batch did not compile. */
  readonly reason?: string;
  /** Why a linked-unit case was built as a whole program. */
  readonly fallback?: string;
}
export interface NativeRunCheckpoint {
  readonly observations: NativeObservation[];
  readonly batches: NativeCompilation[];
  readonly diagnosticPauses: NativeDiagnosticPause[];
  readonly resumptions: object[];
  complete: boolean;
  /** The journal's recorded start; absent before timestamped journals. */
  startedAt?: string;
  /** The completion record's time, when the journal was already complete. */
  completedAt?: string;
}
/** An ISO-8601 instant as written by Date#toISOString. */
export function isRunTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
/** Report timestamps for a native run or regenerated journal. `startedAt` is
 * the journal's original start (the first resume for older journals, otherwise
 * this process). `generatedAt` is when the observations completed: this run's
 * completion, or the completion recorded by an already complete journal. A
 * legacy complete journal has no such time; regenerating it must not date old
 * observations as new, so the report says why the field is missing. */
export function nativeReportTimes(
  checkpoint: Pick<
    NativeRunCheckpoint,
    "startedAt" | "completedAt" | "resumptions"
  >,
  runStartedAt: string,
  runCompletedAt: string | undefined,
):
  | { readonly startedAt: string; readonly generatedAt: string }
  | { readonly startedAt: string; readonly generatedAtUnavailable: string } {
  let startedAt = checkpoint.startedAt;
  if (startedAt === undefined)
    for (const event of checkpoint.resumptions) {
      const time = (event as { startedAt?: unknown }).startedAt;
      if (isRunTimestamp(time)) {
        startedAt = time;
        break;
      }
    }
  startedAt ??= runStartedAt;
  const generatedAt = runCompletedAt ?? checkpoint.completedAt;
  return generatedAt === undefined
    ? {
        startedAt,
        generatedAtUnavailable:
          "regenerated from a journal completed before completion times were recorded",
      }
    : { startedAt, generatedAt };
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function identity(header: Record<string, unknown>): object {
  // Paths and the run's own start time are provenance, not run identity.
  const { sourceSnapshotFile, startedAt, ...value } = header;
  return value;
}
function linkingIdentity(header: object): void {
  if (!object(header)) throw Error("invalid native linking identity");
  const mode = header.nativeLinkingMode,
    index = header.nativeServiceUnitIndexSha256;
  if (mode === undefined && index === undefined) return;
  if (mode === "monolithic" && index === null) return;
  if (
    mode === "aot-native-services-v1" &&
    typeof index === "string" &&
    /^[a-f0-9]{64}$/.test(index)
  )
    return;
  throw Error("invalid native linking identity");
}
function journalAppender(
  path: string,
  sealed = false,
): (record: object) => void {
  return (record) => {
    if (sealed) throw Error("completed native journal is read-only");
    appendFileSync(path, JSON.stringify(record) + "\n");
    if (object(record) && record.kind === "complete") sealed = true;
  };
}
/** Validate a quiescent run before opening its append-only continuation. The
 * caller owns process/session exclusion; completed observations are never retried. */
export function createNativeRunJournal(
  path: string | undefined,
  header: Record<string, unknown>,
  options: { readonly resume?: boolean } = {},
): {
  readonly append: (record: object) => void;
  readonly checkpoint: NativeRunCheckpoint;
} {
  linkingIdentity(header);
  const checkpoint: NativeRunCheckpoint = {
    observations: [],
    batches: [],
    diagnosticPauses: [],
    resumptions: [],
    complete: false,
  };
  if (path === undefined) {
    if (options.resume) throw Error("resume requires a journal path");
    return { append: () => {}, checkpoint };
  }
  if (!options.resume) {
    writeFileSync(path, JSON.stringify(header) + "\n", { flag: "wx" });
    return {
      append: journalAppender(path),
      checkpoint,
    };
  }
  const bytes = readFileSync(path),
    text = bytes.toString();
  if (!text.endsWith("\n")) throw Error("truncated native run journal");
  const rows: unknown[] = text
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  const first = rows.shift();
  if (
    !object(first) ||
    first.kind !== "start" ||
    first.schemaVersion !== 2 ||
    typeof first.frozenToolchainSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(first.frozenToolchainSha256) ||
    !isDeepStrictEqual(identity(first), identity(header))
  )
    throw Error("native journal resume identity differs");
  if (first.startedAt !== undefined) {
    if (!isRunTimestamp(first.startedAt))
      throw Error("invalid native journal start time");
    checkpoint.startedAt = first.startedAt;
  }
  const keys = new Set<string>();
  for (const row of rows) {
    if (!object(row) || checkpoint.complete)
      throw Error("unexpected native journal record");
    if (row.kind === "observation") {
      if (
        typeof row.path !== "string" ||
        typeof row.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(row.sha256) ||
        !["sloppy", "strict", "raw", "module"].includes(String(row.variant)) ||
        !object(row.metadata) ||
        !Array.isArray(row.metadata.flags) ||
        !Array.isArray(row.metadata.includes) ||
        !Array.isArray(row.metadata.features) ||
        !Array.isArray(row.harness) ||
        typeof row.canSuspend !== "boolean" ||
        !object(row.outcome) ||
        !["completed", "error", "unsupported", "timeout", "crash"].includes(
          String(row.outcome.kind),
        ) ||
        !number(row.elapsedMs) ||
        (row.completedAt !== undefined && !isRunTimestamp(row.completedAt))
      )
        throw Error("malformed native observation");
      const { kind, ...saved } = row;
      const observation = saved as unknown as NativeObservation,
        key = observation.path + "\0" + observation.variant;
      if (keys.has(key)) throw Error("duplicate native observation");
      keys.add(key);
      if (
        judgeExecution(observation.metadata, observation.outcome) !==
        observation.status
      )
        throw Error("inconsistent native observation status");
      if (
        observation.batch !== undefined &&
        (!Number.isInteger(observation.batch) ||
          checkpoint.batches[observation.batch] === undefined)
      )
        throw Error("missing native observation compilation");
      checkpoint.observations.push(observation);
    } else if (row.kind === "compilation") {
      const item = row.compilation;
      if (
        !object(item) ||
        item.id !== checkpoint.batches.length ||
        !number(item.variants) ||
        !Number.isInteger(item.variants) ||
        item.variants < 1 ||
        !number(item.compileMs) ||
        [item.admissionMs, item.unitCompileMs, item.hostPreparationMs].some(
          (value) => value !== undefined && !number(value),
        ) ||
        typeof item.outcome !== "string" ||
        (item.kind !== "syntax" && item.kind !== "execution") ||
        (item.linking !== undefined && item.linking !== "units")
      )
        throw Error("malformed native compilation");
      checkpoint.batches.push(item as unknown as NativeCompilation);
    } else if (row.kind === "diagnostic-pause") {
      if (!number(row.elapsedMs)) throw Error("malformed diagnostic pause");
      checkpoint.diagnosticPauses.push({
        kind: "diagnostic-pause",
        elapsedMs: row.elapsedMs,
      });
    } else if (row.kind === "resume") checkpoint.resumptions.push(row);
    else if (row.kind === "complete") {
      if (
        !isDeepStrictEqual(
          row.totals,
          executionTotals(checkpoint.observations.map((item) => item.status)),
        )
      )
        throw Error("inconsistent journal completion");
      if (row.completedAt !== undefined) {
        if (!isRunTimestamp(row.completedAt))
          throw Error("invalid native journal completion time");
        checkpoint.completedAt = row.completedAt;
      }
      checkpoint.complete = true;
    } else throw Error("unknown native journal record");
  }
  if (!checkpoint.complete) {
    const event = {
      kind: "resume",
      startedAt: new Date().toISOString(),
      previousJournalSha256: createHash("sha256").update(bytes).digest("hex"),
      observedVariants: checkpoint.observations.length,
    };
    appendFileSync(path, JSON.stringify(event) + "\n");
    checkpoint.resumptions.push(event);
  }
  return { checkpoint, append: journalAppender(path, checkpoint.complete) };
}
/** Every continuation uses the same captured Node compiler, tools and source
 * graph. A live workspace cannot silently replace a frozen bootstrap compiler. */
export function frozenNativeRunIdentity(
  entryUrl: string,
  sourceSnapshot: object,
): string | undefined {
  const path = fileURLToPath(new URL("../toolchain.json", entryUrl));
  if (!existsSync(path)) return undefined;
  const bytes = readFileSync(path),
    manifest: unknown = JSON.parse(bytes.toString());
  if (
    !object(manifest) ||
    !isDeepStrictEqual(manifest.sourceSnapshot, sourceSnapshot) ||
    !Array.isArray(manifest.files) ||
    manifest.nodeVersion !== process.version
  )
    throw Error("frozen native toolchain identity differs");
  const root = dirname(path);
  for (const item of manifest.files) {
    if (
      !object(item) ||
      typeof item.path !== "string" ||
      item.path.startsWith("/") ||
      item.path.split("/").includes("..") ||
      typeof item.sha256 !== "string"
    )
      throw Error("invalid frozen toolchain entry");
    const file = readFileSync(resolve(root, item.path));
    if (
      file.length !== item.bytes ||
      createHash("sha256").update(file).digest("hex") !== item.sha256
    )
      throw Error("frozen toolchain file differs: " + item.path);
  }
  return createHash("sha256").update(bytes).digest("hex");
}
/** Compare source/harness bytes and variant policy before skipping any prior
 * prefix. Source changes fail before the first newly executed variant. */
export function sameNativeObservationInput(
  prior: NativeObservation,
  input: NativeObservationInput,
): boolean {
  const before: NativeObservationInput = {
    path: prior.path,
    sha256: prior.sha256,
    variant: prior.variant,
    canSuspend: prior.canSuspend,
    metadata: prior.metadata,
    harness: prior.harness,
    ...(prior.fixtures === undefined ? {} : { fixtures: prior.fixtures }),
    ...(prior.absent === undefined ? {} : { absent: prior.absent }),
  };
  return isDeepStrictEqual(
    JSON.parse(JSON.stringify(before)),
    JSON.parse(JSON.stringify(input)),
  );
}

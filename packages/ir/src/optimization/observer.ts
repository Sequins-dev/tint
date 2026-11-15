import type { ModuleIR } from "../scalar/index.ts";

/** One optimizer phase run over the module. `visited` is charged work (the
 * budget unit), `rewritten` the pass's own change count and `skipped` the
 * functions it left unchanged because of a local analysis limit. Native code
 * emission reports as a final codegen phase whose `skipped` counts analyses that
 * exceeded a size limit in some function and fell back to conservative code. */
export interface PassStatistics {
  /** Functions retained unchanged by a phase-local analysis limit. */
  readonly skipped?: number;
  readonly phase: "scalar" | "codegen";
  readonly pass:
    | "simplify-control-flow"
    | "dispatch-string-chains"
    | "thread-branches"
    | "compact-slots"
    | "bulk-list-copies"
    | "reuse-union-reads"
    | "prove-cell-states"
    | "promote-loop-cells"
    | "split-optional-numbers"
    | "lower-proven-record-reads"
    | "ssa-constants"
    | "fold-constants"
    | "coalesce-defaults"
    | "function-local-cleanup"
    | "forward-local-loads"
    | "propagate-slot-copies"
    | "cache-list-vectors"
    | "remove-unread-stores"
    | "remove-dead-scalars"
    | "scalar-replace-records"
    | "devirtualize-closures"
    | "select-array-access"
    | "hoist-loop-invariants"
    | "inline-small-functions"
    | "remove-unreachable"
    | "dense-reference-lists"
    | "emit-native-code";
  readonly visited: number;
  readonly rewritten: number;
}

/** A completed pass and the module it produced. When `budgetExhausted` is set
 * the pass did not finish: `module` is the checkpoint the optimizer keeps and
 * no later pass runs. */
export interface PassEvent {
  readonly statistics: PassStatistics;
  readonly module: ModuleIR;
  readonly budgetExhausted: boolean;
}

/** An optimization decision. `applied` remarks describe a transformation that
 * happened, `missed` ones a candidate the pass declined and why. `start`/`end`
 * is the source span of the deciding instruction in the IR's span space (a
 * program's linked source offsets; 0/0 when unknown). */
export interface OptimizationRemark {
  readonly pass: string;
  readonly outcome: "applied" | "missed";
  /** The IR function the decision was made in. */
  readonly function: string;
  readonly start: number;
  readonly end: number;
  readonly message: string;
}

/** Receives remarks. Passes only build remarks when a sink is present. */
export type RemarkSink = (remark: OptimizationRemark) => void;

/** Opt-in observation of an optimization run. Every hook is optional and
 * none can change the result: an observed run emits the same module as an
 * unobserved one. Hosts measure time between hooks themselves (this package
 * has no clock), so each hook's own cost should be excluded by the host. */
export interface OptimizationObserver {
  /** The input module, before the first pass. */
  readonly begin?: (module: ModuleIR) => void;
  /** After each pass, in pipeline order (passes may repeat). */
  readonly pass?: (event: PassEvent) => void;
  readonly remark?: RemarkSink;
}

function padEnd(text: string, width: number): string {
  let padded = text;
  while (padded.length < width) padded = padded + " ";
  return padded;
}
function padStart(text: string, width: number): string {
  let padded = text;
  while (padded.length < width) padded = " " + padded;
  return padded;
}
/** Non-negative `value` with `digits` decimals (pass times). */
function fixed(value: number, digits: number): string {
  if (!(value >= 0 && value < 1e15)) return String(value);
  let scale = 1;
  for (let digit = 0; digit < digits; digit++) scale = scale * 10;
  const rounded = Math.round(value * scale),
    whole = Math.floor(rounded / scale);
  if (digits === 0) return String(whole);
  let fraction = String(rounded - whole * scale);
  while (fraction.length < digits) fraction = "0" + fraction;
  return String(whole) + "." + fraction;
}
function jsonString(text: string): string {
  let quoted = '"';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i),
      character = text.charAt(i);
    if (character === '"') quoted = quoted + '\\"';
    else if (character === "\\") quoted = quoted + "\\\\";
    else if (code === 10) quoted = quoted + "\\n";
    else if (code === 13) quoted = quoted + "\\r";
    else if (code === 9) quoted = quoted + "\\t";
    else if (code < 32) {
      const digits = "0123456789abcdef";
      quoted =
        quoted +
        "\\u00" +
        digits.charAt(Math.floor(code / 16)) +
        digits.charAt(code % 16);
    } else quoted = quoted + character;
  }
  return quoted + '"';
}

/** A pass statistic as reported: with its wall time when measured. */
export interface PassReport {
  readonly statistics: PassStatistics;
  readonly budgetExhausted: boolean;
  /** Milliseconds since the previous hook; undefined when not measured. */
  readonly milliseconds?: number;
}

/** Text table of pass reports in pipeline order, with totals. */
export function formatPassTable(reports: readonly PassReport[]): string {
  const timed = reports.some(
    (report) => report !== undefined && report.milliseconds !== undefined,
  );
  let text =
    padStart("#", 3) +
    "  " +
    padEnd("pass", 26) +
    padStart("visited", 12) +
    padStart("rewritten", 11) +
    padStart("skipped", 9) +
    (timed ? padStart("ms", 10) : "") +
    "  budget\n";
  let visited = 0,
    rewritten = 0,
    skipped = 0,
    milliseconds = 0,
    exhausted = false;
  for (let index = 0; index < reports.length; index++) {
    const report = reports[index];
    if (report === undefined) throw "pass report invariant";
    const statistics = report.statistics,
      passSkipped = statistics.skipped ?? 0,
      time = report.milliseconds ?? 0;
    visited += statistics.visited;
    rewritten += statistics.rewritten;
    skipped += passSkipped;
    milliseconds += time;
    if (report.budgetExhausted) exhausted = true;
    text =
      text +
      padStart(String(index), 3) +
      "  " +
      padEnd(statistics.pass, 26) +
      padStart(String(statistics.visited), 12) +
      padStart(String(statistics.rewritten), 11) +
      padStart(String(passSkipped), 9) +
      (timed ? padStart(fixed(time, 1), 10) : "") +
      (report.budgetExhausted ? "  exhausted" : "") +
      "\n";
  }
  return (
    text +
    "     " +
    padEnd("total", 26) +
    padStart(String(visited), 12) +
    padStart(String(rewritten), 11) +
    padStart(String(skipped), 9) +
    (timed ? padStart(fixed(milliseconds, 1), 10) : "") +
    (exhausted ? "  exhausted" : "") +
    "\n"
  );
}

/** JSON document of pass reports: `{"budgetExhausted":..,"passes":[..]}`. */
export function formatPassJSON(reports: readonly PassReport[]): string {
  let exhausted = false,
    passes = "";
  for (let index = 0; index < reports.length; index++) {
    const report = reports[index];
    if (report === undefined) throw "pass report invariant";
    const statistics = report.statistics,
      passSkipped = statistics.skipped,
      time = report.milliseconds;
    if (report.budgetExhausted) exhausted = true;
    passes =
      passes +
      (index === 0 ? "" : ",") +
      '{"index":' +
      String(index) +
      ',"phase":' +
      jsonString(statistics.phase) +
      ',"pass":' +
      jsonString(statistics.pass) +
      ',"visited":' +
      String(statistics.visited) +
      ',"rewritten":' +
      String(statistics.rewritten) +
      (passSkipped === undefined ? "" : ',"skipped":' + String(passSkipped)) +
      ',"budgetExhausted":' +
      (report.budgetExhausted ? "true" : "false") +
      (time === undefined ? "" : ',"milliseconds":' + fixed(time, 3)) +
      "}";
  }
  return (
    '{"budgetExhausted":' +
    (exhausted ? "true" : "false") +
    ',"passes":[' +
    passes +
    "]}\n"
  );
}

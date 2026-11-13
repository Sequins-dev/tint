// Opt-in compiler observability for Node-hosted builds (bootstrap-compiler.ts,
// hosted fixtures). See docs/compiler-observability.md. Every feature only
// observes the build except TINT_OPT_PASS_LIMIT, which truncates the
// optimizer pipeline for miscompile bisection.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModuleIR, FunctionIR } from "@tint/ir/scalar";
import {
  formatPassJSON,
  formatPassTable,
  type PassEvent,
  type PassReport,
} from "@tint/ir/optimization";
import type { BuildRequest, ImageFunctionRange } from "@tint/compiler/build";
import type { LocatedRemark } from "@tint/compiler/native";
import { formatFunction, functionSize } from "../ir-dump/format.ts";
import {
  codeSizeReport,
  formatCodeSizeTable,
  type IRPassSize,
} from "../code-size/report.ts";

export interface RemarkFilter {
  readonly pass: readonly string[];
  readonly function: readonly string[];
  readonly file: readonly string[];
  readonly outcome: readonly string[];
}
export interface ObservabilityOptions {
  /** Pass statistics table (stderr) and <output>.pass-stats.json. */
  readonly passStats: boolean;
  /** Function-name substring ("" = all): <output>.passes/ per-pass IR. */
  readonly passDumps?: string;
  /** <output>.remarks.jsonl, filtered. */
  readonly remarks?: RemarkFilter;
  /** Code size table (stderr) and <output>.code-size.json. */
  readonly codeSize: boolean;
  /** Stop the program's optimization after this many passes. */
  readonly passLimit?: number;
}

/** `pass=…,function=…,file=…,outcome=applied|missed`; a bare term filters
 * function names; "" or "1" selects every remark. Terms with the same key
 * are alternatives; different keys must all match. */
export function parseRemarkFilter(spec: string): RemarkFilter {
  const filter = { pass: [], function: [], file: [], outcome: [] } as {
    pass: string[];
    function: string[];
    file: string[];
    outcome: string[];
  };
  if (spec === "" || spec === "1") return filter;
  for (const term of spec.split(",")) {
    if (term === "") continue;
    const at = term.indexOf("=");
    const key = at < 0 ? "function" : term.slice(0, at),
      value = at < 0 ? term : term.slice(at + 1);
    if (
      key !== "pass" &&
      key !== "function" &&
      key !== "file" &&
      key !== "outcome"
    )
      throw Error("TINT_REMARKS: unknown filter key " + key);
    if (key === "outcome" && value !== "applied" && value !== "missed")
      throw Error("TINT_REMARKS: outcome must be applied or missed");
    filter[key].push(value);
  }
  return filter;
}
/** A located remark as written: with its function's source name. */
export interface ReportedRemark extends LocatedRemark {
  readonly sourceFunction?: string;
}
export function remarkSelected(
  filter: RemarkFilter,
  remark: ReportedRemark,
): boolean {
  const any = (terms: readonly string[], value: string | undefined) =>
    terms.length === 0 ||
    (value !== undefined && terms.some((term) => value.includes(term)));
  return (
    any(filter.pass, remark.pass) &&
    (any(filter.function, remark.function) ||
      any(filter.function, remark.sourceFunction)) &&
    any(filter.file, remark.file) &&
    (filter.outcome.length === 0 || filter.outcome.includes(remark.outcome))
  );
}

/** Options from the environment, with CLI flag aliases for tools that take
 * flags (`--pass-stats`, `--code-size`). */
export function observabilityOptions(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = [],
): ObservabilityOptions {
  const limit = env.TINT_OPT_PASS_LIMIT;
  if (
    limit !== undefined &&
    (!/^\d+$/.test(limit) || !Number.isSafeInteger(Number(limit)))
  )
    throw Error("TINT_OPT_PASS_LIMIT must be a non-negative integer");
  return {
    passStats: env.TINT_PASS_STATS === "1" || argv.includes("--pass-stats"),
    codeSize: env.TINT_CODE_SIZE === "1" || argv.includes("--code-size"),
    ...(env.TINT_DUMP_PASSES === undefined
      ? {}
      : { passDumps: env.TINT_DUMP_PASSES }),
    ...(env.TINT_REMARKS === undefined
      ? {}
      : { remarks: parseRemarkFilter(env.TINT_REMARKS) }),
    ...(limit === undefined ? {} : { passLimit: Number(limit) }),
  };
}
export function observabilityRequested(options: ObservabilityOptions): boolean {
  return (
    options.passStats ||
    options.codeSize ||
    options.passDumps !== undefined ||
    options.remarks !== undefined ||
    options.passLimit !== undefined
  );
}

/** Resolves generated function names to `module:function` source names,
 * including derived functions (`name$direct`, `name:sparse`, ...). */
export function sourceNameResolver(
  names: ReadonlyMap<string, string>,
): (name: string) => string | undefined {
  const cache = new Map<string, string | undefined>();
  return (name) => {
    if (cache.has(name)) return cache.get(name);
    let resolved = names.get(name);
    for (let end = name.length - 1; resolved === undefined && end > 0; end--)
      if (name[end] === "$" || name[end] === ":")
        resolved = names.get(name.slice(0, end));
    cache.set(name, resolved);
    return resolved;
  };
}

/** Keys functions by name, disambiguating repeated names by occurrence. */
function functionKeys(module: ModuleIR): string[] {
  const seen = new Map<string, number>();
  return module.functions.map((fn) => {
    const count = seen.get(fn.name) ?? 0;
    seen.set(fn.name, count + 1);
    return count === 0 ? fn.name : fn.name + "#" + count;
  });
}

interface Tracked {
  readonly fn: FunctionIR;
  readonly instructions: number;
  readonly blocks: number;
  /** Stable text, for dumped functions only. */
  readonly text?: string;
}

export interface BuildObservation {
  /** Spread into a BuildRequest. */
  readonly request: Pick<
    BuildRequest,
    "optimizationObserver" | "optimizationPassLimit" | "onEmittedFunctions"
  >;
  /** Writes the requested artifacts next to `output`; returns their paths. */
  finish(output: string, log?: (text: string) => void): string[];
}

export function createBuildObservation(
  options: ObservabilityOptions,
): BuildObservation {
  const reports: PassReport[] = [],
    irPasses: IRPassSize[] = [],
    remarks: string[] = [],
    remarkSeen = new Set<string>(),
    dumps: { index: number; pass: string; text: string; changed: string[] }[] =
      [],
    dumpIndex: {
      index: number;
      pass: string;
      budgetExhausted: boolean;
      visited: number;
      rewritten: number;
      skipped?: number;
      file?: string;
      changed: string[];
      removed: string[];
    }[] = [];
  let emitted: readonly ImageFunctionRange[] | undefined,
    tracked = new Map<string, Tracked>(),
    inputSize: { instructions: number; blocks: number } | undefined,
    clock = 0;
  const trackIR = options.codeSize || options.passDumps !== undefined;
  const dumpFilter = options.passDumps;
  let sourceName: (name: string) => string | undefined = () => undefined;
  function dumped(fn: FunctionIR): boolean {
    return (
      dumpFilter !== undefined &&
      (fn.name.includes(dumpFilter) ||
        (sourceName(fn.name)?.includes(dumpFilter) ?? false))
    );
  }
  /** Updates the tracked functions; returns changed and removed keys with
   * their size deltas. */
  function observe(module: ModuleIR): {
    changed: { key: string; before?: Tracked; after: Tracked }[];
    removed: { key: string; before: Tracked }[];
  } {
    const keys = functionKeys(module),
      next = new Map<string, Tracked>(),
      changed: { key: string; before?: Tracked; after: Tracked }[] = [];
    module.functions.forEach((fn, index) => {
      const key = keys[index] ?? fn.name,
        before = tracked.get(key);
      if (before !== undefined && before.fn === fn) {
        next.set(key, before);
        return;
      }
      const size = functionSize(fn),
        text = dumped(fn)
          ? formatFunction(fn, {
              stable: {
                module,
                ...(sourceName(fn.name) === undefined
                  ? {}
                  : { source: sourceName(fn.name)! }),
              },
            })
          : undefined;
      const after: Tracked = {
        fn,
        ...size,
        ...(text === undefined ? {} : { text }),
      };
      next.set(key, after);
      // Renumbering rebuilds unchanged functions: compare their contents.
      if (
        before !== undefined &&
        before.instructions === after.instructions &&
        before.blocks === after.blocks &&
        (text === undefined
          ? before.fn.blocks === fn.blocks && before.fn.slots === fn.slots
          : before.text === text)
      )
        return;
      changed.push(
        before === undefined ? { key, after } : { key, before, after },
      );
    });
    const removed: { key: string; before: Tracked }[] = [];
    for (const [key, before] of tracked)
      if (!next.has(key)) removed.push({ key, before });
    tracked = next;
    return { changed, removed };
  }
  function totals(): { instructions: number; blocks: number } {
    let instructions = 0,
      blocks = 0;
    for (const entry of tracked.values()) {
      instructions += entry.instructions;
      blocks += entry.blocks;
    }
    return { instructions, blocks };
  }
  const observer = {
    functionNames(names: ReadonlyMap<string, string>): void {
      sourceName = sourceNameResolver(names);
    },
    begin(module: ModuleIR): void {
      if (trackIR) {
        tracked = new Map();
        observe(module);
        inputSize = totals();
        if (dumpFilter !== undefined) {
          const texts: string[] = [],
            names: string[] = [];
          for (const [key, entry] of tracked)
            if (entry.text !== undefined) {
              texts.push(entry.text);
              names.push(key);
            }
          dumps.push({
            index: -1,
            pass: "input",
            text: texts.join("\n\n"),
            changed: names,
          });
        }
      }
      clock = performance.now();
    },
    pass(event: PassEvent): void {
      const elapsed = performance.now() - clock,
        index = reports.length,
        statistics = event.statistics;
      reports.push({
        statistics,
        budgetExhausted: event.budgetExhausted,
        milliseconds: elapsed,
      });
      if (trackIR) {
        const { changed, removed } = observe(event.module);
        const size = totals();
        if (options.codeSize)
          irPasses.push({
            index,
            pass: statistics.pass,
            instructions: size.instructions,
            blocks: size.blocks,
            functions: [
              ...changed.map((entry) => ({
                name: entry.key,
                before: entry.before?.instructions ?? 0,
                after: entry.after.instructions,
              })),
              ...removed.map((entry) => ({
                name: entry.key,
                before: entry.before.instructions,
                after: 0,
              })),
            ].filter((entry) => entry.before !== entry.after),
          });
        if (dumpFilter !== undefined) {
          const shown = changed.filter(
              (entry) => entry.after.text !== undefined,
            ),
            gone = removed
              .filter((entry) => entry.before.text !== undefined)
              .map((entry) => entry.key);
          const file =
            shown.length === 0
              ? undefined
              : String(index).padStart(3, "0") + "-" + statistics.pass + ".ir";
          if (file !== undefined)
            dumps.push({
              index,
              pass: statistics.pass,
              text: shown.map((entry) => entry.after.text).join("\n\n"),
              changed: shown.map((entry) => entry.key),
            });
          dumpIndex.push({
            index,
            pass: statistics.pass,
            budgetExhausted: event.budgetExhausted,
            visited: statistics.visited,
            rewritten: statistics.rewritten,
            ...(statistics.skipped === undefined
              ? {}
              : { skipped: statistics.skipped }),
            ...(file === undefined ? {} : { file }),
            changed: shown.map((entry) => entry.key),
            removed: gone,
          });
        }
      }
      // Exclude this hook's own bookkeeping from the next pass's time.
      clock = performance.now();
    },
    remark(located: LocatedRemark): void {
      const filter = options.remarks,
        source = sourceName(located.function);
      const remark: ReportedRemark =
        source === undefined ? located : { ...located, sourceFunction: source };
      if (filter === undefined || !remarkSelected(filter, remark)) return;
      const line = JSON.stringify(remark);
      // Repeated inlining rounds revisit the same declined calls.
      if (remarkSeen.has(line)) return;
      remarkSeen.add(line);
      remarks.push(line);
    },
  };
  // A pass limit observes too: its report states where optimization stopped.
  const observing = observabilityRequested(options);
  return {
    request: {
      ...(observing
        ? {
            optimizationObserver: {
              functionNames: observer.functionNames,
              begin: observer.begin,
              pass: observer.pass,
              ...(options.remarks === undefined
                ? {}
                : { remark: observer.remark }),
            },
          }
        : {}),
      ...(options.passLimit === undefined
        ? {}
        : { optimizationPassLimit: options.passLimit }),
      ...(options.codeSize
        ? {
            onEmittedFunctions: (functions: readonly ImageFunctionRange[]) => {
              emitted = functions;
            },
          }
        : {}),
    },
    finish(output, log = (text) => process.stderr.write(text)) {
      const written: string[] = [];
      if (options.passLimit !== undefined)
        log(
          `optimization stopped after ${reports.length} of at most ${options.passLimit} passes\n`,
        );
      if (options.passStats) {
        log(formatPassTable(reports));
        writeFileSync(output + ".pass-stats.json", formatPassJSON(reports));
        written.push(output + ".pass-stats.json");
      }
      if (options.remarks !== undefined) {
        writeFileSync(
          output + ".remarks.jsonl",
          remarks.map((line) => line + "\n").join(""),
        );
        written.push(output + ".remarks.jsonl");
        log(`${remarks.length} remarks -> ${output}.remarks.jsonl\n`);
      }
      if (dumpFilter !== undefined) {
        const directory = output + ".passes";
        rmSync(directory, { recursive: true, force: true });
        mkdirSync(directory, { recursive: true });
        for (const dump of dumps)
          writeFileSync(
            join(
              directory,
              dump.index < 0
                ? "input.ir"
                : String(dump.index).padStart(3, "0") + "-" + dump.pass + ".ir",
            ),
            dump.text + "\n",
          );
        writeFileSync(
          join(directory, "index.json"),
          JSON.stringify(
            {
              kind: "tint-pass-dumps",
              version: 1,
              filter: dumpFilter,
              input: dumps[0]?.changed ?? [],
              passes: dumpIndex,
            },
            null,
            1,
          ) + "\n",
        );
        written.push(directory);
        log(`pass dumps -> ${directory}\n`);
      }
      if (options.codeSize) {
        const report = codeSizeReport(
          emitted ?? [],
          inputSize,
          irPasses,
          (fn) => (fn.module === "program" ? sourceName(fn.name) : undefined),
        );
        writeFileSync(
          output + ".code-size.json",
          JSON.stringify(report, null, 1) + "\n",
        );
        written.push(output + ".code-size.json");
        log(formatCodeSizeTable(report));
      }
      return written;
    },
  };
}

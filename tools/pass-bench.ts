// Optimizer pass benchmark: compile time per pass on a fixed input (a frozen
// workload's source), so new or changed passes show their compile-time cost.
//
//   node tools/pass-bench.ts <workload> [--compiler <native-binary>]
//        [--rounds N] [--save <file.json>] [--compare <file.json>]
//
// The compiler is the current tree, Node-hosted (run `pnpm build` first), or
// with --compiler a native tint-compiler binary (for example a stage2 built
// from the tree). Each round compiles .tint-bootstrap/workload-<name>/source
// with --pass-stats; the report is the median milliseconds of each pass,
// matched across rounds and baselines by name and occurrence (phases repeat,
// and inserting a pass must not misalign the rest), with its work and
// rewrites. Ahead-of-time builds are not work-limited, so any pass reporting
// budget exhaustion fails the benchmark. The final emit-native-code row is
// code generation; its `skipped` counts codegen analyses that hit their
// per-function size limit and fell back to conservative code.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface PassRecord {
  readonly pass: string;
  readonly visited: number;
  readonly rewritten: number;
  readonly skipped?: number;
  readonly budgetExhausted: boolean;
  readonly milliseconds?: number;
}
interface PassStatisticsFile {
  readonly budgetExhausted: boolean;
  readonly passes: readonly PassRecord[];
}
/** One pass of the benchmark: `key` is name#occurrence. */
export interface PassTiming {
  readonly key: string;
  readonly pass: string;
  readonly visited: number;
  readonly rewritten: number;
  readonly skipped: number;
  readonly milliseconds: number;
}
export interface PassBenchmark {
  readonly compiler: string;
  readonly rounds: number;
  readonly totalMilliseconds: number;
  readonly passes: readonly PassTiming[];
}

/** Keys each pass by name and occurrence (`fold-constants#2`). */
export function keyedPasses(
  file: PassStatisticsFile,
): { key: string; record: PassRecord }[] {
  const seen = new Map<string, number>();
  return file.passes.map((record) => {
    const occurrence = (seen.get(record.pass) ?? 0) + 1;
    seen.set(record.pass, occurrence);
    return { key: record.pass + "#" + String(occurrence), record };
  });
}
function median(values: readonly number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
/** Median per-pass times over rounds; the first round's work counts (the
 * compile is deterministic, so they agree). Throws on budget exhaustion
 * or on rounds that ran different pass sequences. */
export function summarize(
  compiler: string,
  rounds: readonly PassStatisticsFile[],
): PassBenchmark {
  const first = rounds[0];
  if (first === undefined) throw Error("no rounds");
  for (const round of rounds) {
    const exhausted = round.passes.find((pass) => pass.budgetExhausted);
    if (round.budgetExhausted || exhausted !== undefined)
      throw Error(
        "optimization budget exhausted" +
          (exhausted === undefined ? "" : " in " + exhausted.pass) +
          ": ahead-of-time builds must not be work-limited",
      );
  }
  const keyed = rounds.map(keyedPasses);
  const order = keyed[0] ?? [];
  for (const round of keyed)
    if (
      round.map((item) => item.key).join() !==
      order.map((item) => item.key).join()
    )
      throw Error("rounds ran different pass sequences");
  const passes = order.map(({ key, record }, index) => ({
    key,
    pass: record.pass,
    visited: record.visited,
    rewritten: record.rewritten,
    skipped: record.skipped ?? 0,
    milliseconds: median(
      keyed.map((round) => round[index]?.record.milliseconds ?? 0),
    ),
  }));
  return {
    compiler,
    rounds: rounds.length,
    totalMilliseconds: passes.reduce((sum, pass) => sum + pass.milliseconds, 0),
    passes,
  };
}
function format(value: number, width: number): string {
  return value.toFixed(1).padStart(width);
}
/** The report table; with a baseline, each pass's change in milliseconds
 * and percent, and passes only one side ran. */
export function report(
  current: PassBenchmark,
  baseline: PassBenchmark | undefined,
): string {
  const lines: string[] = [];
  const before = new Map<string, PassTiming>();
  for (const pass of baseline?.passes ?? []) before.set(pass.key, pass);
  lines.push(
    "pass".padEnd(34) +
      "visited".padStart(12) +
      "rewritten".padStart(11) +
      "skipped".padStart(9) +
      "ms".padStart(10) +
      (baseline === undefined
        ? ""
        : "base ms".padStart(10) + "delta".padStart(10)),
  );
  for (const pass of current.passes) {
    const old = before.get(pass.key);
    before.delete(pass.key);
    let line =
      pass.key.padEnd(34) +
      String(pass.visited).padStart(12) +
      String(pass.rewritten).padStart(11) +
      String(pass.skipped).padStart(9) +
      format(pass.milliseconds, 10);
    if (baseline !== undefined)
      line +=
        old === undefined
          ? "       new"
          : format(old.milliseconds, 10) +
            format(pass.milliseconds - old.milliseconds, 10);
    lines.push(line);
  }
  for (const [key, old] of before)
    lines.push(
      key.padEnd(34) +
        "".padStart(42) +
        format(old.milliseconds, 10) +
        "   removed",
    );
  let total = "total".padEnd(66) + format(current.totalMilliseconds, 10);
  if (baseline !== undefined) {
    const delta = current.totalMilliseconds - baseline.totalMilliseconds;
    total +=
      format(baseline.totalMilliseconds, 10) +
      format(delta, 10) +
      " (" +
      ((100 * delta) / baseline.totalMilliseconds).toFixed(1) +
      "%)";
  }
  lines.push(total);
  return lines.join("\n");
}

function compileOnce(
  compiler: string | undefined,
  source: string,
  output: string,
): PassStatisticsFile {
  const environment = { ...process.env, TZ: "UTC" };
  const result =
    compiler === undefined
      ? spawnSync(
          process.execPath,
          [
            "tools/bootstrap-compiler.ts",
            output,
            "--source-root",
            source,
            "--pass-stats",
          ],
          { encoding: "utf8", env: environment },
        )
      : spawnSync(compiler, [source, output, "--pass-stats"], {
          encoding: "utf8",
          env: environment,
        });
  if (result.status !== 0)
    throw Error(
      "compile failed (" +
        String(result.status ?? result.signal) +
        "):\n" +
        (result.stderr ?? "").slice(-2000),
    );
  return JSON.parse(
    readFileSync(output + ".pass-stats.json", "utf8"),
  ) as PassStatisticsFile;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const argv = process.argv.slice(2);
  const option = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at < 0 ? undefined : argv[at + 1];
  };
  const name = argv.find(
    (arg, i) =>
      !arg.startsWith("--") &&
      !["--compiler", "--rounds", "--save", "--compare"].includes(
        argv[i - 1] ?? "",
      ),
  );
  if (name === undefined)
    throw Error(
      "usage: pass-bench.ts <workload> [--compiler <binary>] [--rounds N] [--save file] [--compare file]",
    );
  const compilerOption = option("--compiler");
  const compiler =
    compilerOption === undefined ? undefined : resolve(compilerOption);
  const rounds = Number(option("--rounds") ?? "3");
  if (!Number.isInteger(rounds) || rounds < 1)
    throw Error("--rounds must be a positive integer");
  const source = resolve(".tint-bootstrap", "workload-" + name, "source");
  const scratch = mkdtempSync(join(tmpdir(), "tint-pass-bench-"));
  const files: PassStatisticsFile[] = [];
  try {
    for (let round = 0; round < rounds; round++) {
      files.push(compileOnce(compiler, source, join(scratch, "out")));
      process.stderr.write("round " + String(round + 1) + "/" + rounds + "\n");
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const current = summarize(compiler ?? "node (tree)", files);
  const comparePath = option("--compare");
  const baseline =
    comparePath === undefined
      ? undefined
      : (JSON.parse(readFileSync(comparePath, "utf8")) as PassBenchmark);
  console.log(report(current, baseline));
  const savePath = option("--save");
  if (savePath !== undefined)
    writeFileSync(savePath, JSON.stringify(current, undefined, 2) + "\n");
}

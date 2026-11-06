import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Batch {
  variants: number;
  compileMs: number;
  kind: string;
}
interface Aggregate {
  key: string;
  journals: number;
  completeJournals: number;
  batches: number;
  compiledVariants: number;
  observations: number;
  compileMs: number;
  observationElapsedMs: number;
  withinBatchElapsedDeltaMs: number;
  executionWallMs: null;
  compileMsPerVariant: number | null;
  medianBatchCompileMs: number | null;
  projectedCompileHours: number | null;
}
interface Accumulator {
  row: Aggregate;
  times: number[];
}
function accumulator(key: string): Accumulator {
  return {
    row: {
      key,
      journals: 0,
      completeJournals: 0,
      batches: 0,
      compiledVariants: 0,
      observations: 0,
      compileMs: 0,
      observationElapsedMs: 0,
      withinBatchElapsedDeltaMs: 0,
      executionWallMs: null,
      compileMsPerVariant: null,
      medianBatchCompileMs: null,
      projectedCompileHours: null,
    },
    times: [],
  };
}
function finish(value: Accumulator): Aggregate {
  const { row, times } = value;
  times.sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  row.medianBatchCompileMs =
    times.length === 0
      ? null
      : times.length % 2
        ? times[middle]!
        : (times[middle - 1]! + times[middle]!) / 2;
  row.compileMsPerVariant =
    row.compiledVariants === 0 ? null : row.compileMs / row.compiledVariants;
  row.projectedCompileHours =
    row.compileMsPerVariant === null
      ? null
      : (row.compileMsPerVariant * 103264) / 3600000;
  return row;
}
/** Historical elapsedMs is variant latency, including compilation and earlier
 * launches. It cannot establish execution wall time or end-to-end throughput.
 * Projections are compilation-only extrapolations, not coverage or forecasts. */
export function analyzeNativeJournals(
  inputs: readonly { path: string; text: string }[],
) {
  const engines = new Map<string, Accumulator>(),
    directories = new Map<string, Accumulator>(),
    phases = new Map<string, Accumulator>();
  function bucket(map: Map<string, Accumulator>, key: string) {
    let value = map.get(key);
    if (value === undefined) {
      value = accumulator(key);
      map.set(key, value);
    }
    return value;
  }
  const journals = inputs.flatMap((input) => {
    const lines = input.text.split("\n"),
      truncatedTail = lines.pop() !== "";
    const rows = lines
      .filter((line) => line.trim() !== "")
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          throw Error(`${input.path}:${index + 1}: malformed journal row`);
        }
      });
    const header = rows[0];
    if (
      header?.kind !== "start" ||
      typeof header.engine !== "string" ||
      typeof header.selection !== "string"
    )
      return [];
    const complete = rows.some((row) => row.kind === "complete");
    const own = accumulator(input.path),
      engine = bucket(engines, header.engine);
    const selectionDirectory = (
      header.selection.endsWith(".js")
        ? dirname(header.selection)
        : header.selection
    )
      .split("/")
      .slice(0, 3)
      .join("/");
    const directory = bucket(
      directories,
      header.engine + ":" + selectionDirectory,
    );
    const targets = [own, engine, directory];
    for (const target of targets) {
      target.row.journals++;
      if (complete) target.row.completeJournals++;
    }
    let previous: { batch: number; elapsedMs: number } | undefined;
    for (const row of rows) {
      if (row.kind === "compilation") {
        const batch: Batch = row.compilation;
        if (
          !Number.isFinite(batch?.compileMs) ||
          batch.compileMs < 0 ||
          !Number.isInteger(batch.variants) ||
          batch.variants < 1
        )
          throw Error(input.path + ": invalid compilation");
        for (const target of [
          ...targets,
          bucket(phases, header.engine + ":" + batch.kind),
        ]) {
          target.row.batches++;
          target.row.compiledVariants += batch.variants;
          target.row.compileMs += batch.compileMs;
          target.times.push(batch.compileMs);
        }
      } else if (row.kind === "observation") {
        if (!Number.isFinite(row.elapsedMs) || row.elapsedMs < 0)
          throw Error(input.path + ": invalid observation");
        for (const target of targets) {
          target.row.observations++;
          target.row.observationElapsedMs += row.elapsedMs;
          if (
            previous !== undefined &&
            row.batch !== undefined &&
            previous.batch === row.batch
          )
            target.row.withinBatchElapsedDeltaMs += Math.max(
              0,
              row.elapsedMs - previous.elapsedMs,
            );
        }
        previous = row;
      }
    }
    return [
      {
        ...finish(own),
        engine: header.engine,
        selection: header.selection,
        complete,
        truncatedTail,
      },
    ];
  });
  const sorted = (map: Map<string, Accumulator>) =>
    [...map.values()]
      .map(finish)
      .sort((a, b) => b.compileMs - a.compileMs || a.key.localeCompare(b.key));
  return {
    schemaVersion: 1,
    scope:
      "Journal workload, including overlapping selections and interrupted runs; not unique suite coverage. Execution wall time is unavailable in historical journals. withinBatchElapsedDeltaMs is an approximation excluding each first launch and including preparation skew. Whole-suite projections include compilation only at observed batch occupancy.",
    engines: sorted(engines),
    directories: sorted(directories),
    phases: sorted(phases),
    journals,
  };
}
function journalsUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? journalsUnder(path)
        : entry.isFile() && entry.name.endsWith(".jsonl")
          ? [path]
          : [];
    })
    .sort();
}
if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const directory = process.argv[2] ?? "docs/results";
  console.log(
    JSON.stringify(
      analyzeNativeJournals(
        journalsUnder(directory).map((path) => ({
          path,
          text: readFileSync(path, "utf8"),
        })),
      ),
      null,
      2,
    ),
  );
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string };
  children?: number[];
}
/** Sample weights are elapsed profiler intervals, not CPU accounting. Use
 * process.cpuUsage or /usr/bin/time alongside this attribution. */
export function analyzeCPUProfile(profile: {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
}) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node])),
    parents = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  function ownStage(node: ProfileNode): string | undefined {
    const { functionName: name, url } = node.callFrame;
    if (name === "(garbage collector)") return "gc";
    if (name === "spawnSync") return "external-process-wait";
    if (/\/(?:syntax|scanner|parser)\//.test(url)) return "parse";
    if (/\/binding\//.test(url)) return "bind";
    if (/\/checker\//.test(url)) return "check";
    if (/\/specializ/.test(url)) return "specialize";
    if (
      /\/closure\/(?:lower|value|expression|statement)|\/lowering\//.test(url)
    )
      return "lower";
    if (/\/codegen\//.test(url)) return "codegen";
    if (/\/image\//.test(url)) return "image-link-sign";
    if (name === "linkModules" || /\/modules\/link/.test(url))
      return "source-link";
    if (/\/ir\//.test(url)) return "ir-optimize";
    if (/writeFileSync|fsyncSync|renameSync/.test(name)) return "writeback";
    return undefined;
  }
  const stages = new Map<string, number>(),
    leaves = new Map<string, number>();
  let sampledMs = 0;
  for (let index = 0; index < profile.samples.length; index++) {
    const weight = (profile.timeDeltas[index] ?? 0) / 1000;
    sampledMs += weight;
    let node = nodes.get(profile.samples[index]!);
    const leaf =
      node === undefined
        ? "unknown"
        : node.callFrame.functionName + " @ " + node.callFrame.url;
    leaves.set(leaf, (leaves.get(leaf) ?? 0) + weight);
    let stage: string | undefined;
    while (node !== undefined) {
      stage = ownStage(node);
      if (stage !== undefined) break;
      const parent = parents.get(node.id);
      node = parent === undefined ? undefined : nodes.get(parent);
    }
    stage ??= "other";
    stages.set(stage, (stages.get(stage) ?? 0) + weight);
  }
  return {
    sampledMs,
    stages: [...stages]
      .map(([stage, sampledMs]) => ({ stage, sampledMs }))
      .sort((a, b) => b.sampledMs - a.sampledMs),
    leaves: [...leaves]
      .map(([frame, sampledMs]) => ({ frame, sampledMs }))
      .sort((a, b) => b.sampledMs - a.sampledMs)
      .slice(0, 40),
  };
}

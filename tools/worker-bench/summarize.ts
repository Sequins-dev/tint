// Summarizes measure.ts output (docs/results/worker-runtime-baseline-v1.md):
//   node tools/worker-bench/summarize.ts <result.json> ...
// Kernels: each run's steady time is the mean of its iterations after the
// cold one. Transport: each run's value is the median of its samples in
// microseconds per operation. Cells are medians across rounds with the
// interquartile range; ratios are paired within each round.
import { readFileSync } from "node:fs";

interface Observation {
  readonly member: string;
  readonly passed: boolean;
  readonly lines: readonly string[];
}
interface Result {
  readonly set: string;
  readonly rounds: readonly {
    readonly load: readonly number[];
    readonly observations: readonly Observation[];
  }[];
}

function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position),
    high = Math.ceil(position);
  const a = sorted[low] ?? NaN,
    b = sorted[high] ?? NaN;
  return a + (b - a) * (position - low);
}
function stats(values: readonly number[]): [number, number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  return [
    quantile(sorted, 0.5),
    quantile(sorted, 0.25),
    quantile(sorted, 0.75),
  ];
}
function median(values: readonly number[]): number {
  return stats(values)[0];
}
function cell(values: readonly number[], digits = 2): string {
  if (values.length === 0) return "–";
  const [m, q1, q3] = stats(values);
  return `${m.toFixed(digits)} (${q1.toFixed(digits)}–${q3.toFixed(digits)})`;
}
function ratio(values: readonly number[]): string {
  if (values.length === 0) return "–";
  const [m, q1, q3] = stats(values);
  return `${m.toFixed(2)}× (${q1.toFixed(2)}–${q3.toFixed(2)})`;
}

/** member → metric → per-round values (NaN where a run failed). */
type Table = Map<string, Map<string, number[]>>;
function kernelValues(observation: Observation): Map<string, number> {
  const steady = new Map<string, number[]>(),
    cold = new Map<string, number>();
  for (const line of observation.lines) {
    if (!line.startsWith("WORKER_BENCH_KERNEL ")) continue;
    const [, , kernel, iteration, ms] = line.split(" ");
    if (kernel === undefined) continue;
    if (iteration === "0") cold.set(kernel, Number(ms));
    else {
      const list = steady.get(kernel) ?? [];
      list.push(Number(ms));
      steady.set(kernel, list);
    }
  }
  const values = new Map<string, number>();
  for (const [kernel, list] of steady)
    values.set(kernel, list.reduce((a, b) => a + b, 0) / list.length);
  for (const [kernel, ms] of cold) values.set(kernel + ":cold", ms);
  return values;
}
function transportValues(observation: Observation): Map<string, number> {
  const samples = new Map<string, number[]>();
  for (const line of observation.lines) {
    if (!line.startsWith("WORKER_BENCH {")) continue;
    const sample = JSON.parse(line.slice(13)) as {
      operation: string;
      count: number;
      elapsed: number;
    };
    const list = samples.get(sample.operation) ?? [];
    list.push((sample.elapsed * 1000) / sample.count);
    samples.set(sample.operation, list);
  }
  const values = new Map<string, number>();
  for (const [operation, list] of samples) values.set(operation, median(list));
  return values;
}

const tables = new Map<string, Table>();
const loads: number[] = [];
const failures: string[] = [];
for (const file of process.argv.slice(2)) {
  const result = JSON.parse(readFileSync(file, "utf8")) as Result;
  const table: Table = tables.get(result.set) ?? new Map();
  tables.set(result.set, table);
  result.rounds.forEach((round, index) => {
    loads.push(round.load[0] ?? NaN);
    for (const observation of round.observations) {
      if (!observation.passed)
        failures.push(`${file} round ${index + 1} ${observation.member}`);
      const values = result.set.includes("transport")
        ? transportValues(observation)
        : kernelValues(observation);
      const metrics = table.get(observation.member) ?? new Map();
      table.set(observation.member, metrics);
      for (const [metric, value] of values) {
        const list = metrics.get(metric) ?? [];
        list[index] = observation.passed ? value : NaN;
        metrics.set(metric, list);
      }
    }
  });
}
function paired(table: Table, a: string, b: string, metric: string): number[] {
  const left = table.get(a)?.get(metric) ?? [],
    right = table.get(b)?.get(metric) ?? [];
  const out: number[] = [];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i],
      y = right[i];
    if (x !== undefined && y !== undefined && Number.isFinite(x / y))
      out.push(x / y);
  }
  return out;
}
const finite = (values: readonly number[] | undefined): number[] =>
  (values ?? []).filter((value) => Number.isFinite(value));

const kernels = tables.get("kernels");
if (kernels !== undefined) {
  const names = [...(kernels.get("tint-raw")?.keys() ?? [])].filter(
    (metric) => !metric.endsWith(":cold"),
  );
  console.log("### Kernel steady state (ms per iteration)\n");
  const columns = [
    "tint-plain",
    "tint-copying",
    "tint-raw",
    "tint-main",
    "node-plain",
    "node-raw",
    "node-main",
    "node-worker",
  ];
  console.log("| Kernel | " + columns.join(" | ") + " |");
  console.log("| --- |" + columns.map(() => " ---: |").join(""));
  for (const name of names)
    console.log(
      `| ${name} | ` +
        columns
          .map((column) => cell(finite(kernels.get(column)?.get(name))))
          .join(" | ") +
        " |",
    );
  console.log("\n### Paired ratios (steady state)\n");
  const pairs: [string, string][] = [
    ["tint-copying", "tint-plain"],
    ["tint-raw", "tint-plain"],
    ["tint-main", "tint-plain"],
    ["tint-plain", "node-plain"],
    ["tint-raw", "node-raw"],
    ["tint-main", "node-main"],
  ];
  console.log(
    "| Kernel | " + pairs.map(([a, b]) => `${a} / ${b}`).join(" | ") + " |",
  );
  console.log("| --- |" + pairs.map(() => " ---: |").join(""));
  for (const name of names)
    console.log(
      `| ${name} | ` +
        pairs.map(([a, b]) => ratio(paired(kernels, a, b, name))).join(" | ") +
        " |",
    );
  console.log("\n### Cold iteration (ms)\n");
  console.log("| Kernel | " + columns.join(" | ") + " |");
  console.log("| --- |" + columns.map(() => " ---: |").join(""));
  for (const name of names)
    console.log(
      `| ${name} | ` +
        columns
          .map((column) =>
            cell(finite(kernels.get(column)?.get(name + ":cold"))),
          )
          .join(" | ") +
        " |",
    );
}
const placements = tables.get("placements");
if (placements !== undefined) {
  const names = [...(placements.get("tint-plain")?.keys() ?? [])].filter(
    (metric) => !metric.endsWith(":cold"),
  );
  const columns = [
    "tint-plain",
    "tint-main",
    "tint-worker",
    "node-plain",
    "node-main",
    "node-worker",
  ];
  console.log("### Placements, steady state (ms per iteration)\n");
  console.log("| Kernel | " + columns.join(" | ") + " |");
  console.log("| --- |" + columns.map(() => " ---: |").join(""));
  for (const name of names)
    console.log(
      `| ${name} | ` +
        columns
          .map((column) => cell(finite(placements.get(column)?.get(name))))
          .join(" | ") +
        " |",
    );
  const pairs: [string, string][] = [
    ["tint-main", "tint-plain"],
    ["tint-worker", "tint-plain"],
    ["tint-plain", "node-plain"],
    ["tint-main", "node-main"],
    ["tint-worker", "node-worker"],
  ];
  console.log("\n### Placements, paired ratios\n");
  console.log(
    "| Kernel | " + pairs.map(([a, b]) => `${a} / ${b}`).join(" | ") + " |",
  );
  console.log("| --- |" + pairs.map(() => " ---: |").join(""));
  for (const name of names)
    console.log(
      `| ${name} | ` +
        pairs
          .map(([a, b]) => ratio(paired(placements, a, b, name)))
          .join(" | ") +
        " |",
    );
}
const worker = tables.get("worker");
if (worker !== undefined) {
  const names = [...(worker.get("tint-worker")?.keys() ?? [])].filter(
    (metric) => !metric.endsWith(":cold"),
  );
  console.log("\n### Kernels inside a Worker (ms per iteration)\n");
  console.log(
    "| Kernel | tint-worker | node-worker | tint-worker / node-worker | tint-worker / tint-plain (medians, unpaired) |",
  );
  console.log("| --- | ---: | ---: | ---: | ---: |");
  for (const name of names) {
    const plain = finite(kernels?.get("tint-plain")?.get(name));
    const inWorker = finite(worker.get("tint-worker")?.get(name));
    console.log(
      `| ${name} | ${cell(inWorker)} | ${cell(finite(worker.get("node-worker")?.get(name)))} | ${ratio(paired(worker, "tint-worker", "node-worker", name))} | ${plain.length === 0 ? "–" : (median(inWorker) / median(plain)).toFixed(1) + "×"} |`,
    );
  }
}
const transport = tables.get("transport");
if (transport !== undefined) {
  const operations = [...(transport.get("node-transport")?.keys() ?? [])];
  console.log("\n### Transport (µs per operation)\n");
  console.log("| Operation | Tint | Node | Tint / Node |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const operation of operations)
    console.log(
      `| ${operation} | ${cell(finite(transport.get("tint-transport")?.get(operation)))} | ${cell(finite(transport.get("node-transport")?.get(operation)))} | ${ratio(paired(transport, "tint-transport", "node-transport", operation))} |`,
    );
}
const steps = tables.get("transport-steps");
if (steps !== undefined) {
  const operations = [...(steps.get("node-transport")?.keys() ?? [])];
  const columns = [
    "tint-transport-a",
    "tint-transport-b",
    "tint-transport-c",
    "node-transport",
  ];
  console.log("\n### Transport steps (µs per operation)\n");
  console.log(
    "| Operation | " + columns.join(" | ") + " | b / a | c / b | c / Node |",
  );
  console.log(
    "| --- |" + columns.map(() => " ---: |").join("") + " ---: | ---: | ---: |",
  );
  for (const operation of operations)
    console.log(
      `| ${operation} | ` +
        columns
          .map((column) => cell(finite(steps.get(column)?.get(operation))))
          .join(" | ") +
        ` | ${ratio(paired(steps, "tint-transport-b", "tint-transport-a", operation))} | ${ratio(paired(steps, "tint-transport-c", "tint-transport-b", operation))} | ${ratio(paired(steps, "tint-transport-c", "node-transport", operation))} |`,
    );
}
for (const [name, node] of [
  ["transport-pair", "node-transport"],
  ["typed-transport-pair", "node-typed-transport"],
]) {
  const pair = name === undefined ? undefined : tables.get(name);
  if (pair === undefined || node === undefined) continue;
  const prefix = node.replace("node-", "tint-");
  const a = prefix + "-a",
    b = prefix + "-b";
  console.log(`\n### ${name} (µs per operation)\n`);
  console.log(`| Operation | ${a} | ${b} | ${node} | b / a | b / Node |`);
  console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const operation of pair.get(node)?.keys() ?? [])
    console.log(
      `| ${operation} | ${cell(finite(pair.get(a)?.get(operation)))} | ${cell(finite(pair.get(b)?.get(operation)))} | ${cell(finite(pair.get(node)?.get(operation)))} | ${ratio(paired(pair, b, a, operation))} | ${ratio(paired(pair, b, node, operation))} |`,
    );
}
const [loadMedian, loadLow, loadHigh] = stats(finite(loads));
console.log(
  `\nLoad (1-minute, at round starts): median ${loadMedian.toFixed(2)}, IQR ${loadLow.toFixed(2)}–${loadHigh.toFixed(2)}.`,
);
if (failures.length !== 0)
  console.log("Failed observations: " + failures.join("; "));

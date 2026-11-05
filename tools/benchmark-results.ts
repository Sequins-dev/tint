export interface Sample {
  readonly index: number;
  readonly duration_ns: number;
  readonly operations: number;
}
export type SamplesByName = Map<string, Sample[]>;
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw Error("invalid benchmark record");
  return value as Record<string, unknown>;
}
function integer(value: unknown, positive: boolean): number {
  const n =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof n !== "number" ||
    !Number.isSafeInteger(n) ||
    n < (positive ? 1 : 0)
  )
    throw Error("invalid benchmark measurement");
  return n;
}
function append(
  results: SamplesByName,
  name: string,
  data: Record<string, unknown>,
): void {
  const samples = results.get(name) ?? [],
    index = integer(data.index, false);
  if (index !== samples.length)
    throw Error("duplicate or missing benchmark sample: " + name);
  samples.push({
    index,
    duration_ns: integer(data.duration_ns, true),
    operations: integer(data.operations, true),
  });
  results.set(name, samples);
}
function complete(
  results: SamplesByName,
  completed: number | undefined,
): SamplesByName {
  if (completed === undefined || completed !== results.size || completed === 0)
    throw Error("incomplete benchmark run");
  return results;
}
export function readNodeSamples(text: string): SamplesByName {
  const results: SamplesByName = new Map();
  let completed: number | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = record(JSON.parse(line)),
      data = record(event.data);
    if (event.type === "bench:sample") {
      const path = data.namePath;
      if (
        !Array.isArray(path) ||
        !path.every((part) => typeof part === "string")
      )
        throw Error("invalid benchmark name");
      append(results, path.join(" > "), data);
    } else if (event.type === "bench:summary") {
      if (completed !== undefined || data.success !== true)
        throw Error("benchmark run failed or contains multiple summaries");
      const counts = record(data.counts);
      if (integer(counts.failed, false) !== 0)
        throw Error("failed benchmark cases");
      completed = integer(counts.completed, true);
      if (integer(counts.total, true) !== completed)
        throw Error("skipped or incomplete benchmark cases");
    }
  }
  return complete(results, completed);
}
export function readNativeSamples(text: string): SamplesByName {
  const results: SamplesByName = new Map();
  let completed: number | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    const data = record(JSON.parse(line));
    if (typeof data.name === "string") append(results, data.name, data);
    else if (data.completed !== undefined) {
      if (completed !== undefined) throw Error("duplicate completion");
      completed = integer(data.completed, true);
    } else throw Error("unknown native benchmark record");
  }
  return complete(results, completed);
}
export function summarizeSamples(samples: readonly Sample[]) {
  if (samples.length === 0) throw Error("missing samples");
  const values = samples
    .map((sample, index) => {
      if (sample.index !== index) throw Error("invalid sample order");
      return (
        integer(sample.duration_ns, true) / integer(sample.operations, true)
      );
    })
    .sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length,
    middle = Math.floor(values.length / 2);
  const median =
    values.length % 2
      ? values[middle]!
      : (values[middle - 1]! + values[middle]!) / 2;
  const deviation = Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        values.length,
    ),
    cv = deviation / mean;
  return {
    samples: [...samples],
    medianNsPerOperation: median,
    meanNsPerOperation: mean,
    minNsPerOperation: values[0]!,
    maxNsPerOperation: values.at(-1)!,
    coefficientOfVariation: cv,
    noisy: cv > 0.05,
  };
}
export function compareBenchmarks(node: SamplesByName, native: SamplesByName) {
  if (node.size !== native.size) throw Error("benchmark sets differ");
  return [...node].map(([name, nodeSamples]) => {
    const nativeSamples = native.get(name);
    if (nativeSamples === undefined)
      throw Error("missing native benchmark: " + name);
    if (
      nativeSamples.length !== nodeSamples.length ||
      nodeSamples.some(
        (sample, i) => sample.operations !== nativeSamples[i]?.operations,
      )
    )
      throw Error("benchmark sample plans differ: " + name);
    const n = summarizeSamples(nodeSamples),
      t = summarizeSamples(nativeSamples);
    return {
      name,
      node: n,
      native: t,
      nativeToNode: t.meanNsPerOperation / n.meanNsPerOperation,
      medianNativeToNode: t.medianNsPerOperation / n.medianNsPerOperation,
      noisy: n.noisy || t.noisy,
    };
  });
}

// Prints per-test-file native costs in seconds for tools/gate/test-costs.json
// from native-images.jsonl journals: the file's image builds, admissions and
// executions, which exclude memory-slot and launch-lock waits. A file without
// journaled images costs its worker's wall time. Files absent from the
// journals keep their cost from the existing table.
import { readFileSync } from "node:fs";

interface Event {
  phase: string;
  worker?: number;
  file?: string;
  at?: number;
  elapsedMs?: number;
  failed?: boolean;
}

export function nativeFileCosts(
  journals: readonly string[],
): Map<string, number> {
  const files = new Map<number, string>(),
    work = new Map<number, number>(),
    started = new Map<number, number>(),
    wall = new Map<number, number>();
  for (const text of journals)
    for (const line of text.split("\n")) {
      if (!line) continue;
      const event = JSON.parse(line) as Event;
      const worker = event.worker;
      if (worker === undefined) continue;
      if (event.phase === "worker-start") {
        if (event.file) files.set(worker, event.file);
        if (event.at !== undefined) started.set(worker, event.at);
      } else if (event.phase === "worker-end") {
        const start = started.get(worker);
        if (start !== undefined && event.at !== undefined)
          wall.set(worker, event.at - start);
      } else if (
        event.phase === "build" ||
        event.phase === "admission" ||
        event.phase === "execution"
      )
        work.set(worker, (work.get(worker) ?? 0) + (event.elapsedMs ?? 0));
    }
  const costs = new Map<string, number>();
  for (const [worker, file] of files) {
    const ms = work.get(worker) || wall.get(worker) || 0;
    costs.set(file, (costs.get(file) ?? 0) + Math.round(ms / 1000));
  }
  return costs;
}

if (import.meta.main) {
  const table = new URL("./test-costs.json", import.meta.url);
  const costs = JSON.parse(readFileSync(table, "utf8")) as Record<
    string,
    number
  >;
  for (const [file, cost] of nativeFileCosts(
    process.argv.slice(2).map((path) => readFileSync(path, "utf8")),
  ))
    costs[file] = cost;
  const sorted = Object.fromEntries(
    Object.entries(costs).sort((a, b) => a[0].localeCompare(b[0])),
  );
  console.log(JSON.stringify(sorted, null, 2));
}

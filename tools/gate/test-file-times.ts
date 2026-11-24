// A node:test reporter that writes one tab-separated row per test file: the
// file, its top-level test count and the sum of their durations in
// milliseconds. The gate passes it beside the spec reporter. The runner
// reports a file's events in file order, not as they happen, so arrival
// times say nothing about a file's wall time.
import { relative } from "node:path";

interface TestEvent {
  type: string;
  data?: {
    file?: string;
    nesting?: number;
    details?: { duration_ms?: number };
  };
}

export default async function* testFileTimes(
  source: AsyncIterable<TestEvent>,
): AsyncGenerator<string> {
  const files = new Map<string, { tests: number; durationMs: number }>();
  for await (const event of source) {
    const file = event.data?.file;
    if (
      file === undefined ||
      (event.type !== "test:pass" && event.type !== "test:fail") ||
      event.data?.nesting !== 0
    )
      continue;
    const times = files.get(file) ?? { tests: 0, durationMs: 0 };
    times.tests++;
    times.durationMs += event.data.details?.duration_ms ?? 0;
    files.set(file, times);
  }
  for (const [file, times] of [...files].sort((a, b) =>
    a[0].localeCompare(b[0]),
  ))
    yield [
      relative(process.cwd(), file),
      times.tests,
      Math.round(times.durationMs),
    ].join("\t") + "\n";
}

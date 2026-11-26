import { spawnSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("./check-test-files.json", import.meta.url), "utf8"),
) as {
  concurrent: string[];
  memory: string[];
  native: string[];
};

/** Measured seconds per test file on the CI runners, used only to balance
 * shards (see docs/validation-gate.md). Stale or missing entries cost
 * balance, never coverage. */
const shardCosts = JSON.parse(
  readFileSync(new URL("./gate/test-costs.json", import.meta.url), "utf8"),
) as Record<string, number>;

export function checkTestFiles(): string[] {
  return globSync(["packages/*/test/*.test.ts", "tools/*.test.ts"]).sort();
}

export function classifiedCheckTests(files = checkTestFiles()) {
  const { concurrent, memory, native } = manifest;
  const exclusive = [...memory, ...native].sort();
  const classified = new Set<string>();
  for (const file of [...concurrent, ...exclusive]) {
    if (classified.has(file)) throw Error("Duplicate check test: " + file);
    classified.add(file);
  }
  const found = new Set(files);
  const unclassified = files.filter((file) => !classified.has(file));
  const stale = [...classified].filter((file) => !found.has(file));
  if (unclassified.length || stale.length)
    throw Error(
      [
        ...unclassified.map((file) => "Unclassified check test: " + file),
        ...stale.map((file) => "Missing classified check test: " + file),
      ].join("\n"),
    );
  return { concurrent, exclusive, memory, native };
}

export function nativeTestConcurrency(value: string | undefined): string {
  const concurrency = value ?? "2";
  if (
    !/^[1-9][0-9]*$/.test(concurrency) ||
    !Number.isSafeInteger(Number(concurrency))
  ) {
    throw Error("TINT_GATE_NATIVE_CONCURRENCY must be a positive integer");
  }
  return concurrency;
}

export interface CheckTestShard {
  readonly index: number;
  readonly count: number;
}

/** Parses `INDEX/COUNT` (1-based), as in `--shard=2/3`. */
export function parseCheckTestShard(value: string): CheckTestShard {
  const match = /^([1-9][0-9]?)\/([1-9][0-9]?)$/.exec(value);
  const index = Number(match?.[1]),
    count = Number(match?.[2]);
  if (!match || index > count)
    throw Error("Expected a test shard INDEX/COUNT, got " + value);
  return { index, count };
}

/** Test files that share a single cached multi-case native binary via
 * `sharedFixtureImage`. Co-locating them in the same CI shard avoids
 * rebuilding the same full-realm image independently on every shard runner. */
const sharedFixtureGroups: readonly (readonly string[])[] = [
  [
    "tools/native-general-elements.test.ts",
    "tools/native-general-intrinsics.test.ts",
    "tools/native-general-numbers.test.ts",
    "tools/native-general-property-caches.test.ts",
    "tools/node-buffer-codecs.test.ts",
  ],
];

/**
 * Splits a group into `count` shards of similar measured cost: longest files
 * first, each to the currently lightest shard (ties to the lower shard). A
 * file without a recorded cost weighs the median recorded cost. Every file
 * lands in exactly one shard; each shard lists its heaviest files first so
 * they start before the light ones. Files belonging to a shared-image group
 * are scheduled together on one shard so the cached image builds once.
 */
export function shardCheckTests(
  files: readonly string[],
  shard: CheckTestShard,
  costs: Readonly<Record<string, number>> = shardCosts,
): string[] {
  const known = files
    .map((file) => costs[file])
    .filter((cost) => cost !== undefined)
    .sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)]! : 1;
  const fileSet = new Set(files);
  const grouped = new Set<string>();
  const units: { readonly files: readonly string[]; readonly cost: number }[] =
    [];
  for (const group of sharedFixtureGroups) {
    const present = group.filter((file) => fileSet.has(file));
    if (present.length > 1) {
      for (const file of present) grouped.add(file);
      const sorted = [...present].sort(
        (a, b) =>
          (costs[b] ?? fallback) - (costs[a] ?? fallback) || a.localeCompare(b),
      );
      const cost = sorted.reduce(
        (total, file) => total + (costs[file] ?? fallback),
        0,
      );
      units.push({ files: sorted, cost });
    }
  }
  for (const file of files) {
    if (grouped.has(file)) continue;
    units.push({ files: [file], cost: costs[file] ?? fallback });
  }
  units.sort(
    (a, b) => b.cost - a.cost || a.files[0]!.localeCompare(b.files[0]!),
  );
  const loads = Array.from({ length: shard.count }, () => 0);
  const selected: string[] = [];
  for (const unit of units) {
    const lightest = loads.indexOf(Math.min(...loads));
    loads[lightest]! += unit.cost;
    if (lightest === shard.index - 1) selected.push(...unit.files);
  }
  return selected;
}

export function checkTestArguments(
  group: string | undefined,
  concurrency = process.env.TINT_GATE_NATIVE_CONCURRENCY,
  shard?: CheckTestShard,
): string[] {
  const tests = classifiedCheckTests();
  if (group === undefined || !Object.hasOwn(tests, group))
    throw Error("Expected check test group: " + Object.keys(tests).join(", "));
  const all = tests[group as keyof typeof tests];
  const files = shard === undefined ? all : shardCheckTests(all, shard);
  if (files.length === 0) throw Error("Empty check test group: " + group);
  const args = ["--test"];
  if (group === "native" || group === "exclusive") {
    args.push("--test-concurrency=" + nativeTestConcurrency(concurrency));
  }
  return [...args, ...files];
}

if (import.meta.main) {
  const [group, ...options] = process.argv.slice(2);
  if (group === "native-concurrency") {
    console.log(
      nativeTestConcurrency(process.env.TINT_GATE_NATIVE_CONCURRENCY),
    );
  } else {
    let shard: CheckTestShard | undefined;
    for (const option of options) {
      if (option.startsWith("--shard=") && shard === undefined)
        shard = parseCheckTestShard(option.slice("--shard=".length));
      else throw Error("Unknown check test option: " + option);
    }
    const args = checkTestArguments(group, undefined, shard);
    if (group === "native" && process.env.TINT_GATE_NATIVE_IMAGES) {
      args.unshift(
        "--import=" + new URL("./gate/native-worker.ts", import.meta.url).href,
      );
    }
    // Per-file times balance CI shards; the spec output stays on stdout.
    const times = process.env.TINT_GATE_TEST_FILE_TIMES;
    if (times) {
      args.unshift(
        "--test-reporter=spec",
        "--test-reporter-destination=stdout",
        "--test-reporter=" +
          new URL("./gate/test-file-times.ts", import.meta.url).href,
        "--test-reporter-destination=" + times,
      );
    }
    const run = spawnSync(process.execPath, args, {
      stdio: "inherit",
    });
    if (run.error !== undefined) throw run.error;
    process.exitCode = run.status ?? 1;
  }
}

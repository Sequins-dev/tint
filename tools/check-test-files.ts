import { spawnSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("./check-test-files.json", import.meta.url), "utf8"),
) as {
  concurrent: string[];
  memory: string[];
  native: string[];
};

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

export function checkTestArguments(
  group: string | undefined,
  concurrency = process.env.TINT_GATE_NATIVE_CONCURRENCY,
): string[] {
  const tests = classifiedCheckTests();
  if (group === undefined || !Object.hasOwn(tests, group))
    throw Error("Expected check test group: " + Object.keys(tests).join(", "));
  const files = tests[group as keyof typeof tests];
  if (files.length === 0) throw Error("Empty check test group: " + group);
  const args = ["--test"];
  if (group === "native" || group === "exclusive") {
    args.push("--test-concurrency=" + nativeTestConcurrency(concurrency));
  }
  return [...args, ...files];
}

if (import.meta.main) {
  const group = process.argv[2];
  if (group === "native-concurrency") {
    console.log(
      nativeTestConcurrency(process.env.TINT_GATE_NATIVE_CONCURRENCY),
    );
  } else {
    const args = checkTestArguments(group);
    if (group === "native" && process.env.TINT_GATE_NATIVE_IMAGES) {
      args.unshift(
        "--import=" + new URL("./gate/native-worker.ts", import.meta.url).href,
      );
    }
    const run = spawnSync(process.execPath, args, {
      stdio: "inherit",
    });
    if (run.error !== undefined) throw run.error;
    process.exitCode = run.status ?? 1;
  }
}

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

if (import.meta.main) {
  const tests = classifiedCheckTests();
  const group = process.argv[2];
  if (group === undefined || !Object.hasOwn(tests, group))
    throw Error("Expected check test group: " + Object.keys(tests).join(", "));
  const files = tests[group as keyof typeof tests];
  if (files.length === 0) throw Error("Empty check test group: " + group);
  const run = spawnSync(process.execPath, ["--test", ...files], {
    stdio: "inherit",
  });
  if (run.error !== undefined) throw run.error;
  process.exitCode = run.status ?? 1;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  darwinAArch64Target,
  linuxAArch64Target,
  linuxX86_64Target,
} from "@tint/platform/target";
import { compilerUsage, parseCompilerArguments } from "../src/cli-arguments.ts";

test("the compiler targets its own host unless --target names another", () => {
  for (const host of [
    darwinAArch64Target,
    linuxAArch64Target,
    linuxX86_64Target,
  ]) {
    assert.deepEqual(parseCompilerArguments(["src", "out"], host), {
      root: "src",
      output: "out",
      debugSymbols: false,
      passStatistics: false,
      target: host,
      workers: 0,
      spillDirectory: undefined,
      workerHeapMiB: 704,
      memoryBudgetMiB: undefined,
      workerStatistics: false,
    });
  }
  const parallel = parseCompilerArguments(
    [
      "src",
      "out",
      "--workers",
      "2",
      "--spill-dir",
      "/tmp/spill",
      "--worker-heap-mb",
      "512",
      "--memory-budget-mb",
      "2800",
      "--worker-stats",
    ],
    darwinAArch64Target,
  );
  assert.deepEqual(parallel, {
    root: "src",
    output: "out",
    debugSymbols: false,
    passStatistics: false,
    target: darwinAArch64Target,
    workers: 2,
    spillDirectory: "/tmp/spill",
    workerHeapMiB: 512,
    memoryBudgetMiB: 2800,
    workerStatistics: true,
  });
  const cross = parseCompilerArguments(
    ["src", "out", "--target", "linux-aarch64", "--debug-symbols"],
    darwinAArch64Target,
  );
  assert.equal(cross?.target, linuxAArch64Target);
  assert.equal(cross?.debugSymbols, true);
  assert.equal(
    parseCompilerArguments(
      ["src", "out", "--pass-stats", "--target", "darwin-aarch64"],
      linuxAArch64Target,
    )?.target,
    darwinAArch64Target,
  );
});

test("compiler usage lists Linux x86-64 as a standard target", () => {
  assert.match(compilerUsage, /--target selects [^\n]*linux-x86_64/);
  assert.doesNotMatch(compilerUsage, /linux-x86_64 target is experimental/);
});

test("compiler argument errors are usage errors", () => {
  const host = darwinAArch64Target;
  for (const args of [
    [],
    ["src"],
    ["src", "out", "--target"],
    ["src", "out", "--target", "darwin-arm64"],
    ["src", "out", "--target", "linux-aarch64", "--target", "linux-aarch64"],
    ["src", "out", "--debug-symbols", "--debug-symbols"],
    ["src", "out", "--pass-stats", "--pass-stats"],
    ["src", "out", "--workers"],
    ["src", "out", "--workers", "-1"],
    ["src", "out", "--workers", "abc"],
    ["src", "out", "--workers", "65"],
    ["src", "out", "--workers", "1", "--workers", "2"],
    ["src", "out", "--spill-dir"],
    ["src", "out", "--spill-dir", ""],
    ["src", "out", "--worker-heap-mb", "32"],
    ["src", "out", "--worker-heap-mb", "4096"],
    ["src", "out", "--memory-budget-mb", "64"],
    ["src", "out", "--worker-stats", "--worker-stats"],
    ["src", "out", "extra"],
  ])
    assert.equal(parseCompilerArguments(args, host), undefined, args.join(" "));
});

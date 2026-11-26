// Shared runner helpers for `argv`-dispatched multi-case native binaries.
// Each case runs in its own isolated native LLDB process (asserting
// stopped-at-entry and expected exit status or signal), while sharing one
// compiled binary across compatible cases.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import { lldbStartCommands } from "./lldb-launch.ts";
import { admitDarwinFixture, runDarwinFixture } from "./native-admission.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import {
  nativeArtifact,
  runNativeBatch,
  type NativeResult,
} from "./native-target-runner.ts";

export const nodeProcessModule = "packages/native-runtime/src/node/process.ts";

/** Parse an inline ESM module for inclusion in a combined fixture binary. */
export function parseFixtureModule(
  id: string,
  text: string,
  dependencies: readonly [string, string][] = [],
): SourceModule {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, `${id}: ${JSON.stringify(parsed)}`);
  return {
    id,
    module: parsed.value,
    dependencies: new Map(dependencies),
  };
}

/** Build the standard ESM `await import(...)` dispatcher source for general
 * combined binaries. Each case module is evaluated lazily only when selected
 * by `argv[1]`. */
export function generalImportDispatcher(
  cases: readonly {
    readonly name: string;
    readonly specifier: string;
    readonly async?: boolean;
  }[],
): string {
  const branches = cases
    .map(
      ({ name, specifier, async: isAsync }) =>
        `    case ${JSON.stringify(name)}: return ${isAsync ? "await " : ""}(await import(${JSON.stringify(specifier)})).run();`,
    )
    .join("\n");
  return `import { argv } from "node:process";
export async function run() {
  switch (argv[1]) {
${branches}
    default: return 99;
  }
}
`;
}

/** Build the static typed dispatcher source for typed combined binaries (typed
 * compilation does not implement dynamic `import()` or `async` lowering). */
export function typedCaseDispatcher(
  cases: readonly {
    readonly name: string;
    readonly specifier: string;
  }[],
): string {
  const imports = cases
    .map(
      ({ specifier }, index) =>
        `import { run as runCase${index} } from ${JSON.stringify(specifier)};`,
    )
    .join("\n");
  const branches = cases
    .map(
      ({ name }, index) =>
        `  if (name === ${JSON.stringify(name)}) return runCase${index}();`,
    )
    .join("\n");
  return `import { argv } from "node:process";
${imports}
export function run(): number {
  const name = argv[1] ?? "";
${branches}
  return 99;
}
`;
}

const admittedBinaries = new Set<string>();

/** Run one case of a prepared native binary under LLDB in its own isolated
 * process (defaulting to two runs, matching `verifyHostedFixture`). */
export function runNativeSuiteCase(
  binary: string,
  args: readonly string[],
  options: {
    readonly runs?: number;
    readonly expectedStatus?: number;
    readonly cleanup?: boolean;
  } = {},
): readonly NativeResult[] {
  const mode = process.env.TINT_BUILD_ONLY;
  if (mode === "1" || mode === "defer-admission") return [];
  const target = nativeFixtureTarget();
  const runs = options.runs ?? 2;
  const expectedStatus = options.expectedStatus ?? 42;
  try {
    if (target.os === "darwin" && !admittedBinaries.has(binary)) {
      admitDarwinFixture(binary);
      admittedBinaries.add(binary);
    }
    const artifact = nativeArtifact(
      target.name,
      binary,
      binary + ".manifest.json",
    );
    const invocations = Array.from({ length: runs }, () => ({
      artifact,
      args: [...args],
    }));
    const results = runNativeBatch(invocations);
    for (const result of results) {
      if (result.kind === "execution-unavailable")
        throw Error("execution unavailable: " + result.reason);
      assert.ok(
        result.kind === "exited" && result.status === expectedStatus,
        `case ${JSON.stringify(args)}: ${JSON.stringify(result)}`,
      );
    }
    return results;
  } finally {
    if (options.cleanup === true && process.env.TINT_KEEP_NATIVE !== "1") {
      admittedBinaries.delete(binary);
      rmSync(dirname(binary), { recursive: true, force: true });
    }
  }
}

/** Run one trap-expecting case of a prepared native binary under LLDB. */
export function runNativeSuiteTrap(
  binary: string,
  args: readonly string[],
  expected: {
    readonly x64Signal: string;
    readonly darwinPattern: RegExp;
  },
): void {
  const mode = process.env.TINT_BUILD_ONLY;
  if (mode === "1" || mode === "defer-admission") return;
  const target = nativeFixtureTarget();
  if (target.arch === "x86_64") {
    const [result] = runNativeBatch([
      {
        artifact: nativeArtifact("linux-x86_64", binary),
        args: [...args],
      },
    ]);
    assert.equal(result?.kind, "signaled", JSON.stringify(result));
    assert.equal(result.signal, expected.x64Signal, JSON.stringify(result));
    return;
  }
  const result = runDarwinFixture(binary, () =>
    spawnSync(
      "lldb",
      [
        "--no-lldbinit",
        "--batch",
        ...lldbStartCommands(),
        "-o",
        "continue",
        "-o",
        "script assert lldb.process.GetState() == lldb.eStateStopped",
        "-o",
        "kill",
        "--",
        binary,
        ...args,
      ],
      { encoding: "utf8", timeout: 60000 },
    ),
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, expected.darwinPattern, result.stdout);
}

export function cleanupNativeBinary(binary: string | undefined): void {
  if (binary === undefined || process.env.TINT_KEEP_NATIVE === "1") return;
  admittedBinaries.delete(binary);
  rmSync(dirname(binary), { recursive: true, force: true });
}

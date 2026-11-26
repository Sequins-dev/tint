// Native `node:process` (`argv` and `exitCode` via explicit ESM import only —
// no global `process` object) and pure top-level ESM / dynamic `import()`
// execution semantics.
//
// Tests typed and general/untyped pure top-level ESM execution (including
// top-level `await` and `await import(...)`), 0 args, multiple args,
// empty-string args, UTF-8 multi-byte and emoji args, `process.exitCode`
// (default 0, explicit 42, overwrite, reset to undefined, uncaught error /
// rejected promise / unsettled promise exiting 1),
// `typeof globalThis.process === "undefined"`, lazy evaluation of unselected
// dynamic import subgraphs (both side-effect and typed-helper static deps),
// exact ESM post-order / diamond deduplication / TLA reconciliation / cached
// namespace identity on re-import, Linux x86-64 ELF compilation, and Node
// reference semantics.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { prepareHostedFixture } from "./hosted-fixture.ts";
import { admitDarwinFixture } from "./native-admission.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import { parseFixtureModule } from "./native-suite-runner.ts";
import { nativeArtifact, runNativeBatch } from "./native-target-runner.ts";

const nodeProcessModule = "packages/native-runtime/src/node/process.ts";

function runBinaryCases(
  binary: string,
  cases: readonly {
    readonly args: readonly string[];
    readonly expectedStatus: number;
  }[],
): void {
  const target = nativeFixtureTarget();
  try {
    if (target.os === "darwin") admitDarwinFixture(binary);
    const artifact = nativeArtifact(
      target.name,
      binary,
      binary + ".manifest.json",
    );
    const results = runNativeBatch(
      cases.map(({ args }) => ({ artifact, args: [...args] })),
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const expected = cases[i];
      if (result?.kind === "execution-unavailable")
        throw Error("execution unavailable: " + result.reason);
      assert.ok(
        result?.kind === "exited" &&
          expected !== undefined &&
          result.status === expected.expectedStatus,
        `case ${i} (${JSON.stringify(expected)}): ${JSON.stringify(result)}`,
      );
    }
  } finally {
    if (process.env.TINT_KEEP_NATIVE !== "1")
      rmSync(dirname(binary), { recursive: true, force: true });
  }
}

test("node:process argv and exitCode work on the typed top-level ESM path", () => {
  const binary = prepareHostedFixture(
    `import process, { argv } from "node:process";
function dispatch(): void {
  if (process.argv !== argv) { process.exitCode = 1; return; }
  if (process.exitCode !== undefined) { process.exitCode = 2; return; }
  if (argv.length < 1) { process.exitCode = 3; return; }
  const program = argv[0] ?? "";
  if (program.length === 0) { process.exitCode = 4; return; }
  // 0 user args: only argv[0] (the executable path), leaving exitCode undefined -> exit 0.
  if (argv.length === 1) return;
  const mode = argv[1];
  if (mode === "explicit") {
    process.exitCode = 42;
    if (process.exitCode !== 42) process.exitCode = 5;
    return;
  }
  if (mode === "overwrite") {
    process.exitCode = 17;
    if (process.exitCode !== 17) { process.exitCode = 6; return; }
    process.exitCode = 42;
    return;
  }
  if (mode === "reset") {
    process.exitCode = 42;
    process.exitCode = undefined;
    if (process.exitCode !== undefined) process.exitCode = 7;
    return;
  }
  if (mode === "multi") {
    process.exitCode =
      argv.length === 5 &&
      argv[2] === "alpha" &&
      argv[3] === "beta" &&
      argv[4] === "gamma"
        ? 42
        : 10;
    return;
  }
  if (mode === "empty") {
    process.exitCode =
      argv.length === 5 && argv[2] === "" && argv[3] === "mid" && argv[4] === ""
        ? 42
        : 20;
    return;
  }
  if (mode === "utf8") {
    process.exitCode =
      argv.length === 5 &&
      argv[2] === "héllo" &&
      argv[3] === "日本語" &&
      argv[4] === "🌍"
        ? 42
        : 30;
    return;
  }
  process.exitCode = 99;
}
dispatch();
`,
    "node-process-typed",
    [["node:process", nodeProcessModule]],
    [],
    [],
    [],
    {
      requireTyped: true,
      managedBytes: 4194304,
      allocationCapacity: 65536,
    },
  );
  if (process.env.TINT_BUILD_ONLY === "1") return;
  runBinaryCases(binary, [
    { args: [], expectedStatus: 0 },
    { args: ["explicit"], expectedStatus: 42 },
    { args: ["overwrite"], expectedStatus: 42 },
    { args: ["reset"], expectedStatus: 0 },
    { args: ["multi", "alpha", "beta", "gamma"], expectedStatus: 42 },
    { args: ["empty", "", "mid", ""], expectedStatus: 42 },
    { args: ["utf8", "héllo", "日本語", "🌍"], expectedStatus: 42 },
  ]);
});

const esmTraceExpectation =
  "diamond,tla:before,sync,side-effect,tla:after,entry";

const esmGraphSources = {
  log: `export const trace = [];
`,
  diamond: `import { trace } from "./esm-log.mjs";
export let evalCount = 0;
evalCount += 1;
trace.push("diamond");
export const diamondValue = 10;
`,
  tla: `import { trace } from "./esm-log.mjs";
import { diamondValue } from "./esm-diamond.mjs";
trace.push("tla:before");
const resolved = await Promise.resolve(20);
trace.push("tla:after");
export const tlaValue = resolved + diamondValue - diamondValue;
`,
  sync: `import { trace } from "./esm-log.mjs";
import { diamondValue } from "./esm-diamond.mjs";
trace.push("sync");
export const syncValue = diamondValue + 2;
`,
  sideEffect: `import { trace } from "./esm-log.mjs";
trace.push("side-effect");
`,
  entry: `import { trace } from "./esm-log.mjs";
import { evalCount, diamondValue } from "./esm-diamond.mjs";
import { tlaValue } from "./esm-tla.mjs";
import { syncValue } from "./esm-sync.mjs";
import "./esm-side-effect.mjs";
trace.push("entry");
export const summary = diamondValue + tlaValue + syncValue;
export const diamondEvaluations = evalCount;
export const traceSnapshot = trace.join(",");
`,
};

test("node:process argv, exitCode and spec-compliant dynamic await import() work on the general path without globalThis.process", () => {
  const leafA = parseFixtureModule(
    "fixture:case-a",
    `import process, { argv } from "node:process";
if (typeof globalThis.process !== "undefined") {
  process.exitCode = 1;
} else if (!Array.isArray(argv) || argv[1] !== "case-a" || argv[2] !== "héllo") {
  process.exitCode = 2;
} else {
  process.exitCode = 42;
}
`,
    [["node:process", nodeProcessModule]],
  );
  const leafB = parseFixtureModule(
    "fixture:case-b",
    `import process from "node:process";
if (typeof globalThis.process !== "undefined") {
  process.exitCode = 1;
} else if (process.argv[1] !== "case-b" || process.argv[2] !== "" || process.argv[3] !== "🌍") {
  process.exitCode = 2;
} else {
  process.exitCode = await Promise.resolve(42);
}
`,
    [["node:process", nodeProcessModule]],
  );
  // Unselected dynamic import branch whose static dependencies (both a
  // side-effect-only import and a typed helper with top-level side effects)
  // throw unconditionally. Neither may execute at program startup.
  const boomSideEffect = parseFixtureModule(
    "fixture:boom-side-effect",
    `throw new Error("unselected side-effect dependency ran eagerly");
`,
  );
  const boomTypedHelper = parseFixtureModule(
    "fixture:boom-typed-helper",
    `throw new Error("unselected typed helper dependency ran eagerly");
export function boomValue(): number { return 1; }
`,
  );
  const unselectedBoom = parseFixtureModule(
    "fixture:unselected-boom",
    `import "./boom-side-effect.ts";
import { boomValue } from "./boom-typed-helper.ts";
export const unreachable = boomValue();
`,
    [
      ["./boom-side-effect.ts", "fixture:boom-side-effect"],
      ["./boom-typed-helper.ts", "fixture:boom-typed-helper"],
    ],
  );
  // Selected dynamic import subgraph exercising post-order evaluation, shared
  // diamond deduplication, TLA settlement before importer execution, and
  // cached namespace identity on re-import.
  const esmLog = parseFixtureModule("fixture:esm-log", esmGraphSources.log);
  const esmDiamond = parseFixtureModule(
    "fixture:esm-diamond",
    esmGraphSources.diamond,
    [["./esm-log.mjs", "fixture:esm-log"]],
  );
  const esmTla = parseFixtureModule("fixture:esm-tla", esmGraphSources.tla, [
    ["./esm-log.mjs", "fixture:esm-log"],
    ["./esm-diamond.mjs", "fixture:esm-diamond"],
  ]);
  const esmSync = parseFixtureModule("fixture:esm-sync", esmGraphSources.sync, [
    ["./esm-log.mjs", "fixture:esm-log"],
    ["./esm-diamond.mjs", "fixture:esm-diamond"],
  ]);
  const esmSideEffect = parseFixtureModule(
    "fixture:esm-side-effect",
    esmGraphSources.sideEffect,
    [["./esm-log.mjs", "fixture:esm-log"]],
  );
  const esmEntry = parseFixtureModule(
    "fixture:esm-entry",
    esmGraphSources.entry,
    [
      ["./esm-log.mjs", "fixture:esm-log"],
      ["./esm-diamond.mjs", "fixture:esm-diamond"],
      ["./esm-tla.mjs", "fixture:esm-tla"],
      ["./esm-sync.mjs", "fixture:esm-sync"],
      ["./esm-side-effect.mjs", "fixture:esm-side-effect"],
    ],
  );

  let generalModules: readonly string[] | undefined;
  const binary = prepareHostedFixture(
    `import process, { argv } from "node:process";
import * as proc from "node:process";
if (typeof globalThis.process !== "undefined") {
  process.exitCode = 1;
} else if (!Array.isArray(argv) || !(argv instanceof Array)) {
  process.exitCode = 2;
} else if (process.argv !== argv || proc.argv !== argv || proc.default !== process) {
  process.exitCode = 3;
} else if (process.exitCode !== undefined) {
  process.exitCode = 4;
} else if (argv.length < 1 || typeof argv[0] !== "string" || argv[0].length === 0) {
  process.exitCode = 5;
} else if (argv.length > 1) {
  switch (argv[1]) {
    case "explicit":
      process.exitCode = 42;
      if (process.exitCode !== 42) process.exitCode = 6;
      break;
    case "overwrite":
      process.exitCode = 17;
      if (process.exitCode !== 17) {
        process.exitCode = 7;
      } else {
        process.exitCode = 42;
      }
      break;
    case "reset":
      process.exitCode = 42;
      process.exitCode = undefined;
      if (process.exitCode !== undefined) process.exitCode = 8;
      break;
    case "multi":
      process.exitCode =
        argv.length === 4 && argv[2] === "one" && argv[3] === "two" ? 42 : 10;
      break;
    case "case-a":
      await import("./case-a.ts");
      break;
    case "case-b":
      await import("./case-b.ts");
      break;
    case "unselected":
      await import("./unselected-boom.ts");
      break;
    case "esm-graph": {
      const first = await import("./esm-entry.mjs");
      const second = await import("./esm-entry.mjs");
      const syncFirst = await import("./esm-sync.mjs");
      const syncSecond = await import("./esm-sync.mjs");
      const logMod = await import("./esm-log.mjs");
      if (first !== second || syncFirst !== syncSecond) {
        process.exitCode = 11;
      } else if (first.diamondEvaluations !== 1 || first.summary !== 42) {
        process.exitCode = 12;
      } else if (
        first.traceSnapshot !== ${JSON.stringify(esmTraceExpectation)} ||
        logMod.trace.join(",") !== ${JSON.stringify(esmTraceExpectation)}
      ) {
        process.exitCode = 13;
      } else {
        process.exitCode = 42;
      }
      break;
    }
    case "throw":
      process.exitCode = 42;
      throw new Error("uncaught top-level error");
    case "reject":
      process.exitCode = 42;
      await Promise.reject(new Error("rejected top-level await"));
      break;
    case "unsettled":
      process.exitCode = 42;
      await new Promise(() => {});
      break;
    default:
      process.exitCode = 99;
      break;
  }
}
`,
    "node-process-general",
    [
      ["node:process", nodeProcessModule],
      ["./case-a.ts", "fixture:case-a"],
      ["./case-b.ts", "fixture:case-b"],
      ["./unselected-boom.ts", "fixture:unselected-boom"],
      ["./esm-entry.mjs", "fixture:esm-entry"],
      ["./esm-sync.mjs", "fixture:esm-sync"],
      ["./esm-log.mjs", "fixture:esm-log"],
    ],
    [
      leafA,
      leafB,
      boomSideEffect,
      boomTypedHelper,
      unselectedBoom,
      esmLog,
      esmDiamond,
      esmTla,
      esmSync,
      esmSideEffect,
      esmEntry,
    ],
    [],
    [],
    {
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      onGeneralFallback(modules) {
        generalModules = modules;
      },
    },
  );
  assert.ok(generalModules !== undefined, "expected general fallback");
  assert.ok(
    !generalModules.includes(
      "packages/native-runtime/src/node/process-host.ts",
    ),
    "process-host must remain on the typed side of the boundary",
  );
  assert.ok(
    generalModules.includes("fixture:boom-side-effect") &&
      generalModules.includes("fixture:boom-typed-helper"),
    "observable static dependencies of dynamic imports must remain lazy general module records",
  );
  if (process.env.TINT_BUILD_ONLY === "1") return;
  runBinaryCases(binary, [
    { args: [], expectedStatus: 0 },
    { args: ["explicit"], expectedStatus: 42 },
    { args: ["overwrite"], expectedStatus: 42 },
    { args: ["reset"], expectedStatus: 0 },
    { args: ["multi", "one", "two"], expectedStatus: 42 },
    { args: ["case-a", "héllo"], expectedStatus: 42 },
    { args: ["case-b", "", "🌍"], expectedStatus: 42 },
    { args: ["esm-graph"], expectedStatus: 42 },
    { args: ["unselected"], expectedStatus: 1 },
    { args: ["throw"], expectedStatus: 1 },
    { args: ["reject"], expectedStatus: 1 },
    { args: ["unsettled"], expectedStatus: 1 },
  ]);
});

test("node:process top-level ESM compiles cleanly for Linux x86-64 ELF", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { prepareHostedFixture } from ${JSON.stringify(new URL("./hosted-fixture.ts", import.meta.url).href)};
const binary = prepareHostedFixture(
  \`import process, { argv } from "node:process";
function main(): void {
  if (process.argv !== argv || argv.length < 1) { process.exitCode = 1; return; }
  process.exitCode = argv[1] === "héllo" ? 42 : 2;
}
main();
\`,
  "node-process-x64",
  [["node:process", "packages/native-runtime/src/node/process.ts"]],
  [],
  [],
  [],
  { requireTyped: true, managedBytes: 4194304, allocationCapacity: 65536 },
);
console.log("BINARY:" + binary);`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TINT_NATIVE_TARGET: "linux-x86_64",
        TINT_BUILD_ONLY: "1",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const line = result.stdout
    .split("\n")
    .find((entry) => entry.startsWith("BINARY:"));
  assert.ok(line, result.stdout);
  const binary = line.slice("BINARY:".length).trim();
  try {
    const elf = readFileSync(binary);
    assert.equal(elf.readUInt32BE(0), 0x7f454c46, "expected ELF magic");
    assert.equal(elf.readUInt16LE(18), 62, "expected EM_X86_64");
  } finally {
    rmSync(dirname(binary), { recursive: true, force: true });
  }
});

test("documents Tint AOT argv[0..n], exitCode, and dynamic ESM graph semantics vs Node", () => {
  // In Node: `node -e ... a b` places user args at argv[1..] (same as a
  // standalone native executable where argv[0] is the binary path), while
  // `node script.mjs a b` inserts script.mjs at argv[1] so user args begin at
  // argv[2]. In both, `process.exitCode` defaults to `undefined` (exit 0) and
  // sets the process exit status when assigned an integer.
  const evalResult = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import process, { argv } from "node:process"; console.log(JSON.stringify(argv)); process.exitCode = 42;',
      "arg1",
      "arg2",
    ],
    { encoding: "utf8" },
  );
  assert.equal(evalResult.status, 42, evalResult.stderr);
  const evalArgv = JSON.parse(evalResult.stdout) as string[];
  assert.deepEqual(evalArgv.slice(1), ["arg1", "arg2"]);

  const directory = mkdtempSync(join(tmpdir(), "tint-node-process-ref-"));
  try {
    const script = join(directory, "script.mjs");
    writeFileSync(
      script,
      'import { argv } from "node:process"; console.log(JSON.stringify(argv));\n',
    );
    const scriptResult = spawnSync(process.execPath, [script, "arg1", "arg2"], {
      encoding: "utf8",
    });
    assert.equal(scriptResult.status, 0, scriptResult.stderr);
    const scriptArgv = JSON.parse(scriptResult.stdout) as string[];
    assert.equal(basename(scriptArgv[1] ?? ""), "script.mjs");
    assert.deepEqual(scriptArgv.slice(2), ["arg1", "arg2"]);

    // Cross-check exact ESM post-order + TLA + diamond + re-import trace in Node.
    writeFileSync(join(directory, "esm-log.mjs"), esmGraphSources.log);
    writeFileSync(join(directory, "esm-diamond.mjs"), esmGraphSources.diamond);
    writeFileSync(join(directory, "esm-tla.mjs"), esmGraphSources.tla);
    writeFileSync(join(directory, "esm-sync.mjs"), esmGraphSources.sync);
    writeFileSync(
      join(directory, "esm-side-effect.mjs"),
      esmGraphSources.sideEffect,
    );
    writeFileSync(join(directory, "esm-entry.mjs"), esmGraphSources.entry);
    const driver = join(directory, "driver.mjs");
    writeFileSync(
      driver,
      `import process from "node:process";
const first = await import("./esm-entry.mjs");
const second = await import("./esm-entry.mjs");
const logMod = await import("./esm-log.mjs");
if (first === second && first.diamondEvaluations === 1 && first.summary === 42 &&
    first.traceSnapshot === ${JSON.stringify(esmTraceExpectation)} &&
    logMod.trace.join(",") === ${JSON.stringify(esmTraceExpectation)}) {
  process.exitCode = 42;
} else {
  console.error(first.traceSnapshot, logMod.trace.join(","));
  process.exitCode = 1;
}
`,
    );
    const graphResult = spawnSync(process.execPath, [driver], {
      encoding: "utf8",
    });
    assert.equal(graphResult.status, 42, graphResult.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

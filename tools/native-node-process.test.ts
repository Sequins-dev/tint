// Native `node:process` (argv via explicit ESM import only — no global
// `process` object). Tests typed and general/untyped paths, 0 args, multiple
// args, empty-string args, UTF-8 multi-byte and emoji args, `process.argv ===
// argv`, `typeof globalThis.process === "undefined"`, Node `node -e` vs
// `node script.mjs` semantics, and standard `await import(...)` dispatch in
// general programs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { prepareHostedFixture } from "./hosted-fixture.ts";
import { admitDarwinFixture } from "./native-admission.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import { nativeArtifact, runNativeBatch } from "./native-target-runner.ts";

const nodeProcessModule = "packages/native-runtime/src/node/process.ts";

function runBinaryCases(
  binary: string,
  cases: readonly (readonly string[])[],
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
      cases.map((args) => ({ artifact, args: [...args] })),
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result?.kind === "execution-unavailable")
        throw Error("execution unavailable: " + result.reason);
      assert.ok(
        result?.kind === "exited" && result.status === 42,
        `case ${i} (${JSON.stringify(cases[i])}): ${JSON.stringify(result)}`,
      );
    }
  } finally {
    if (process.env.TINT_KEEP_NATIVE !== "1")
      rmSync(dirname(binary), { recursive: true, force: true });
  }
}

test("node:process argv works on the typed native path across 0, empty, multiple and UTF-8 args", () => {
  const binary = prepareHostedFixture(
    `import process, { argv } from "node:process";
export function run(): number {
  if (process.argv !== argv) return 1;
  if (argv.length < 1) return 2;
  const program = argv[0] ?? "";
  if (program.length === 0) return 3;
  // 0 user args: only argv[0] (the executable path).
  if (argv.length === 1) return 42;
  const mode = argv[1];
  if (mode === "multi") {
    if (argv.length !== 5) return 10;
    if (argv[2] !== "alpha" || argv[3] !== "beta" || argv[4] !== "gamma")
      return 11;
    return 42;
  }
  if (mode === "empty") {
    if (argv.length !== 5) return 20;
    if (argv[2] !== "" || argv[3] !== "mid" || argv[4] !== "") return 21;
    return 42;
  }
  if (mode === "utf8") {
    if (argv.length !== 5) return 30;
    if (argv[2] !== "héllo" || argv[3] !== "日本語" || argv[4] !== "🌍")
      return 31;
    return 42;
  }
  return 99;
}
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
    [],
    ["multi", "alpha", "beta", "gamma"],
    ["empty", "", "mid", ""],
    ["utf8", "héllo", "日本語", "🌍"],
  ]);
});

test("node:process argv works on the general path without globalThis.process and supports await import() dispatch", () => {
  const leafA = parseModule(
    createSourceTextView(`import { argv } from "node:process";
export function run() {
  if (typeof globalThis.process !== "undefined") return 1;
  if (!Array.isArray(argv) || argv[1] !== "case-a" || argv[2] !== "héllo") return 2;
  return 42;
}
`),
  );
  const leafB = parseModule(
    createSourceTextView(`import process from "node:process";
export async function run() {
  if (typeof globalThis.process !== "undefined") return 1;
  if (process.argv[1] !== "case-b" || process.argv[2] !== "" || process.argv[3] !== "🌍") return 2;
  return await Promise.resolve(42);
}
`),
  );
  assert.ok(leafA.ok && leafB.ok);
  let generalModules: readonly string[] | undefined;
  const binary = prepareHostedFixture(
    `import process, { argv } from "node:process";
import * as proc from "node:process";
export async function run() {
  if (typeof globalThis.process !== "undefined") return 1;
  if (!Array.isArray(argv) || !(argv instanceof Array)) return 2;
  if (process.argv !== argv || proc.argv !== argv || proc.default !== process) return 3;
  if (argv.length < 1 || typeof argv[0] !== "string" || argv[0].length === 0) return 4;
  if (argv.length === 1) return 42;
  switch (argv[1]) {
    case "multi":
      return argv.length === 4 && argv[2] === "one" && argv[3] === "two" ? 42 : 10;
    case "case-a":
      return (await import("./case-a.ts")).run();
    case "case-b":
      return await (await import("./case-b.ts")).run();
    default:
      return 99;
  }
}
`,
    "node-process-general",
    [
      ["node:process", nodeProcessModule],
      ["./case-a.ts", "fixture:case-a"],
      ["./case-b.ts", "fixture:case-b"],
    ],
    [
      {
        id: "fixture:case-a",
        module: leafA.value,
        dependencies: new Map([["node:process", nodeProcessModule]]),
      },
      {
        id: "fixture:case-b",
        module: leafB.value,
        dependencies: new Map([["node:process", nodeProcessModule]]),
      },
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
  if (process.env.TINT_BUILD_ONLY === "1") return;
  runBinaryCases(binary, [
    [],
    ["multi", "one", "two"],
    ["case-a", "héllo"],
    ["case-b", "", "🌍"],
  ]);
});

test("node:process compiles cleanly for Linux x86-64 ELF", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { prepareHostedFixture } from ${JSON.stringify(new URL("./hosted-fixture.ts", import.meta.url).href)};
const binary = prepareHostedFixture(
  \`import process, { argv } from "node:process";
export function run(): number {
  if (process.argv !== argv || argv.length < 1) return 1;
  return argv[1] === "héllo" ? 42 : 2;
}
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

test("documents Tint AOT argv[0..n] semantics vs node -e and node script.mjs", () => {
  // In Node: `node -e ... a b` places user args at argv[1..] (same as a
  // standalone native executable where argv[0] is the binary path), while
  // `node script.mjs a b` inserts script.mjs at argv[1] so user args begin at
  // argv[2].
  const evalResult = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { argv } from "node:process"; console.log(JSON.stringify(argv));',
      "arg1",
      "arg2",
    ],
    { encoding: "utf8" },
  );
  assert.equal(evalResult.status, 0, evalResult.stderr);
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
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { projectBuildRequest, projectRoots } from "@tint/compiler/cli";
import { buildMacOSProgram } from "@tint/compiler/build";
import type { NativeHostBinding } from "@tint/compiler/native";
import {
  workspaceSources,
  workspaceSourceIdentity,
  workspaceModules,
} from "./workspace-sources.ts";

// Diagnostics only write images: there is no process-launching path.
const mode = process.argv[2],
  output = process.argv[3];
if ((mode !== "entry" && mode !== "stages") || output === undefined)
  throw Error(
    "usage: node tools/build-shared-primitives-diagnostic.ts <entry|stages> <new-output-directory>",
  );
const originalPath = "tools/build-shared-primitives-fixture.ts";
const original = readFileSync(originalPath, "utf8");
const syntax = ts.createSourceFile(
  originalPath,
  original,
  ts.ScriptTarget.Latest,
  true,
);
let originalText: string | undefined;
for (const statement of syntax.statements) {
  if (
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    statement.expression.expression.getText(syntax) === "verifyHostedFixture"
  ) {
    const argument = statement.expression.arguments[0];
    if (argument !== undefined && ts.isNoSubstitutionTemplateLiteral(argument))
      originalText = argument.text;
  }
}
assert.ok(originalText, "original fixture source must be present");
let text = originalText;
if (mode === "entry") {
  // Keep exact explicit runtime capabilities and startup policy, omit all main work.
  text =
    text.slice(0, text.indexOf("export function run()")) +
    "export function run(): number { return 42; }";
} else {
  text = text.replace(
    "export function run(): number {",
    "function exercise(): number {\n  mark(0);",
  );
  text = text.replace("  const scratch =", "  mark(31);\n  const scratch =");
  text = text.replace(
    "  const short = new Uint32Array(1);",
    "  mark(32);\n  const short = new Uint32Array(1);\n  mark(33);",
  );
  text = text.replace(
    /^(\s*)(if \([^\n]+ return (\d+);)$/gm,
    (_whole, indent: string, line: string, stage: string) =>
      `${indent}mark(${stage});\n${indent}${line}`,
  );
  text =
    `import { write } from 'io';\nfunction mark(code: number): void { const bytes = new Uint8Array(3); bytes[0] = 48 + Math.floor(code / 10); bytes[1] = 48 + code % 10; bytes[2] = 10; write(2, bytes); }\n` +
    text +
    `\nexport function run(): number { mark(90); try { const result = exercise(); mark(91); return result; } catch (error) { mark(99); if (error === "HOST_UNAVAILABLE") return 68; return 69; } }`;
}
const memory = "packages/native-runtime/src/intrinsics/memory.ts",
  shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts",
  io = "packages/native-runtime/src/intrinsics/fs.ts";
const bindings: readonly NativeHostBinding[] = [
  { module: memory, name: "mapMemory", operation: "memory-map" },
  { module: memory, name: "unmapMemory", operation: "memory-unmap" },
  {
    module: shared,
    name: "readSharedUnsigned",
    operation: "shared-read-unsigned",
  },
  {
    module: shared,
    name: "writeSharedUnsigned",
    operation: "shared-write-unsigned",
  },
  { module: shared, name: "readSharedWord64", operation: "shared-read-word64" },
  {
    module: shared,
    name: "writeSharedWord64",
    operation: "shared-write-word64",
  },
  {
    module: shared,
    name: "compareExchangeSharedWord64",
    operation: "shared-compare-exchange-word64",
  },
];
const snapshot = workspaceSources(),
  source = createSourceText(
    new TextEncoder().encode(text),
    new TextEncoder().encode(text).length,
  );
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok, JSON.stringify(parsed));
const modules = [
  ...workspaceModules(
    [...projectRoots(), memory, shared, ...(mode === "stages" ? [io] : [])],
    snapshot,
  ),
  {
    id: "fixture",
    module: parsed.value,
    dependencies: new Map([
      ["memory", memory],
      ["shared", shared],
      ...(mode === "stages" ? [["io", io] as [string, string]] : []),
    ]),
    sourcePosition: (offset: number) => {
      const value = source.value.positionAt(offset);
      return value.ok ? value.value : undefined;
    },
  },
];
const request = projectBuildRequest(modules, () => {});
const built = buildMacOSProgram({
  ...request,
  allowDebugger: true,
  debugSymbols: true,
  entry: "fixture",
  start: "run",
  runtimeEntry: "initializeGenerationalRuntime",
  managedBytes: 4194304,
  allocationCapacity: 65536,
  rootCapacity: 4096,
  stackBytes: 1048576,
  identifier: "tint-shared-primitives-s1a-diagnostic-" + mode,
  runtimes: [
    ...request.runtimes,
    {
      module: memory,
      namespace: "native-memory",
      retainedExports: ["mapMemory", "unmapMemory"],
    },
    {
      module: shared,
      namespace: "shared-primitives-fixture",
      retainedExports: bindings
        .filter((binding) => binding.module === shared)
        .map((binding) => binding.name),
    },
  ],
  hostBindings: [...request.hostBindings, ...bindings],
});
assert.ok(built.ok, JSON.stringify(built));
assert.deepEqual(
  workspaceSourceIdentity(workspaceSources()),
  workspaceSourceIdentity(snapshot),
  "portable sources changed during build",
);
mkdirSync(output);
const artifact = resolve(output, "shared-primitives-s1a-" + mode);
writeFileSync(artifact, built.value, { mode: 0o755, flag: "wx" });
writeFileSync(
  artifact + ".build.json",
  JSON.stringify(
    {
      kind: "shared-primitives-s1a-diagnostic",
      mode,
      artifact,
      sourceSnapshot: workspaceSourceIdentity(snapshot),
      expectedExit: 42,
      expectedExitStatus: 42,
      source: text,
      originalFixture: originalPath,
      originalFixtureSha256: createHash("sha256")
        .update(original)
        .digest("hex"),
      imageSha256: createHash("sha256").update(built.value).digest("hex"),
      startupPolicy: {
        managedBytes: 4194304,
        controlBytes: request.controlBytes,
        allocationCapacity: 65536,
        rootCapacity: 4096,
        stackBytes: 1048576,
        runtimeEntry: "initializeGenerationalRuntime",
      },
      markers:
        mode === "entry"
          ? "No main allocations or leaves; same startup/runtime grants. Exit 70 isolates failure before/during main result handling."
          : "90 wrapper entered; 00 before map; 01 after map; 31/32 before scratch/short allocation; 33 after allocations; 02..30 before matching original check; 91 exercise returned; 99 caught managed exception (68 HOST_UNAVAILABLE, 69 other).",
      builtOnly: true,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(artifact);

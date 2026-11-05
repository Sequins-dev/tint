import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("self-host audit resolves and checks the complete parser dependency graph", () => {
  const run = spawnSync(
    process.execPath,
    [
      "tools/selfhost-coverage.ts",
      "--entry",
      "packages/typescript/src/syntax/parser.ts",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.entry, "packages/typescript/src/syntax/parser.ts");
  assert.ok(report.modules.includes("packages/source/src/text.ts"));
  assert.ok(report.modules.includes("packages/typescript/src/syntax/model.ts"));
  assert.equal(report.stage, "checked");
  assert.equal(report.selfHosted, false);
  assert.equal(report.diagnostic, undefined);
});

import { createCatalog } from "@tint/source/catalog";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkModule, checkClosureModule } from "@tint/typescript/checker";
import { auditLinkedSources } from "./linked-source-audit.ts";
function audit(files: Record<string, string>, entry = "p/main.ts") {
  const catalog = createCatalog(
    Object.entries(files).map(([id, text]) => {
      const bytes = new TextEncoder().encode(text),
        source = createSourceText(bytes, bytes.length);
      assert.ok(source.ok);
      return {
        id,
        value: { packageId: id.split("/")[0]!, source: source.value },
      };
    }),
  );
  assert.ok(catalog.ok);
  return auditLinkedSources(catalog.value, [], entry);
}
test("linked audit checks imported types and re-exports with source locations", () => {
  const files = {
    "p/main.ts":
      'import type {Box} from "./public.ts";export function read(x:Box):number{return x.value;}',
    "p/public.ts": 'export type {Box} from "./types.ts";',
    "p/types.ts": "export interface Box {value:number}",
  };
  assert.equal(audit(files).stage, "checked");
  const rejected = audit({
    ...files,
    "p/types.ts": "export interface Box {value:string}",
  });
  assert.equal(rejected.stage, "check");
  assert.ok("diagnostic" in rejected);
  assert.equal(rejected.diagnostic.file, "p/main.ts");
  assert.equal(rejected.diagnostic.position?.line, 1);
});
test("linked audit reports missing dependencies and reachable parse failures", () => {
  const missing = audit({
    "p/main.ts": 'import type {Box} from "./missing.ts";',
  });
  assert.equal(missing.stage, "resolve");
  const malformed = audit({
    "p/main.ts": 'import type {Box} from "./types.ts";',
    "p/types.ts": "export interface Box {",
  });
  assert.equal(malformed.stage, "parse");
  assert.ok("diagnostic" in malformed);
  assert.equal(malformed.diagnostic.file, "p/types.ts");
});

test("relational keyword syntax cannot silently lower as a numeric operation", () => {
  for (const operator of ["instanceof", "in"]) {
    const bytes = new TextEncoder().encode(
      `function f(a:number,b:number):number{return a ${operator} b;}`,
    );
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseModule(source.value);
    assert.ok(parsed.ok);
    for (const result of [
      checkModule(parsed.value),
      checkClosureModule(parsed.value),
    ]) {
      assert.equal(result.ok, false);
    }
  }
});

test("linked Map patterns keep declaration and reference identities aligned", () => {
  const report = audit({
    "p/main.ts":
      'import {sum} from "./sum.ts";export function run(m:Map<string,number>):number{return sum(m);}',
    "p/sum.ts":
      'export function sum(m:Map<string,number>):number{let total=0;for(const [key,value] of m){if(key!=="")total=total+value;}return total;}',
  });
  assert.equal(report.stage, "checked", JSON.stringify(report));
});

test("compiler lowering dependency graph passes contextual checking after specialization", () => {
  const run = spawnSync(
    process.execPath,
    [
      "tools/selfhost-coverage.ts",
      "--entry",
      "packages/ts-native/src/closure/lowering/index.ts",
      "--specialize",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.stage, "checked", JSON.stringify(report));
  for (const file of [
    "packages/ts-native/src/scalar.ts",
    "packages/typescript/src/checker/index.ts",
    "packages/typescript/src/types/index.ts",
    "packages/typescript/src/binding/index.ts",
  ])
    assert.ok(report.modules.includes(file), file);
  assert.equal(report.selfHosted, false);
});

for (const [label, entry] of [
  ["AArch64 scalar emission", "packages/codegen/src/aarch64/scalar/index.ts"],
] as const) {
  test(`${label} dependency graph passes contextual checking after specialization`, () => {
    const run = spawnSync(
      process.execPath,
      ["tools/selfhost-coverage.ts", "--entry", entry, "--specialize"],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.stage, "checked", JSON.stringify(report));
    assert.equal(report.selfHosted, false);
    assert.ok(report.modules.includes("packages/codegen/src/aarch64/isa.ts"));
    assert.ok(
      report.modules.includes("packages/foundation/src/binary/bytes.ts"),
    );
  });
}

test("linked audit can specialize nested compiler helpers before checking", () => {
  const files = [
    {
      id: "p/main.ts",
      value: {
        packageId: "p",
        source: createSourceText(
          new TextEncoder().encode(
            "export function run(n:number):number{function id<T>(value:T):T{return value;}return id<number>(n);}",
          ),
          1000,
        ),
      },
    },
  ];
  const source = files[0]!.value.source;
  assert.ok(source.ok);
  const catalog = createCatalog([
    { id: "p/main.ts", value: { packageId: "p", source: source.value } },
  ]);
  assert.ok(catalog.ok);
  const report = auditLinkedSources(catalog.value, [], "p/main.ts", {
    specialize: true,
  });
  assert.equal(report.stage, "checked", JSON.stringify(report));
  assert.equal(report.specializations, 1);
  assert.equal(report.selfHosted, false);
});

test("interface resolver runtime dependency graph passes contextual checking", () => {
  const run = spawnSync(
    process.execPath,
    [
      "tools/selfhost-coverage.ts",
      "--entry",
      "packages/typescript/src/checker/interfaces.ts",
      "--specialize",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.stage, "checked", JSON.stringify(report));
  assert.ok(report.checkedFunctions > 0);
  assert.equal(report.selfHosted, false);
});

test("linker runtime dependency graph passes checking after specialization", () => {
  const run = spawnSync(
    process.execPath,
    [
      "tools/selfhost-coverage.ts",
      "--entry",
      "packages/ts-native/src/modules/index.ts",
      "--specialize",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.stage, "checked", JSON.stringify(report));
  assert.ok(report.specializations > 0);
  assert.ok(report.checkedFunctions > 0);
  assert.equal(report.selfHosted, false);
});

test("closure checker runtime dependency graph checks itself", () => {
  const run = spawnSync(
    process.execPath,
    [
      "tools/selfhost-coverage.ts",
      "--entry",
      "packages/typescript/src/checker/closures.ts",
      "--specialize",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.stage, "checked", JSON.stringify(report));
  assert.ok(
    report.modules.includes(
      "packages/foundation/src/text/text-encoding/index.ts",
    ),
  );
  assert.equal(report.runtimeRequested, false);
  assert.ok(report.checkedFunctions > 0);
  assert.equal(report.selfHosted, false);
});

test("complete checker runtime dependency graph checks itself", () => {
  const run = spawnSync(
    process.execPath,
    [
      "tools/selfhost-coverage.ts",
      "--entry",
      "packages/typescript/src/checker/index.ts",
      "--specialize",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.stage, "checked", JSON.stringify(report));
  assert.ok(report.checkedFunctions > 0);
  assert.equal(report.selfHosted, false);
});

test("linked audit distinguishes native emission from source acceptance and execution", () => {
  const bytes = new TextEncoder().encode(
    "export function run(n:number):number{return n+1;}",
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const catalog = createCatalog([
    { id: "p/main.ts", value: { packageId: "p", source: source.value } },
  ]);
  assert.ok(catalog.ok);
  const report = auditLinkedSources(catalog.value, [], "p/main.ts", {
    emit: true,
  });
  assert.equal(report.stage, "emitted", JSON.stringify(report));
  assert.equal(report.selfHosted, false);
});

test("complete native compiler pipeline passes checking after specialization", () => {
  const run = spawnSync(
    process.execPath,
    [
      "tools/selfhost-coverage.ts",
      "--entry",
      "packages/compiler/src/native/index.ts",
      "--specialize",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.stage, "checked", JSON.stringify(report));
  assert.ok(report.checkedFunctions > 0);
  assert.equal(report.selfHosted, false);
});

test("linked native audit prepares collection templates and emits bytes module", () => {
  const run = spawnSync(
    process.execPath,
    [
      "tools/selfhost-coverage.ts",
      "--entry",
      "packages/foundation/src/binary/bytes.ts",
      "--runtime",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.stage, "emitted", JSON.stringify(report));
  assert.equal(report.runtimeRequested, true);
  assert.ok(report.emittedFunctions > 0);
  assert.equal(report.selfHosted, false);
});

test("Mach-O symbol encoding compiles with the native TextEncoder runtime", async () => {
  const { workspaceModules } = await import("./workspace-sources.ts");
  const { projectBuildRequest } = await import("@tint/compiler/cli");
  const { compileArm64Program } = await import("@tint/compiler/native");
  const entry = "packages/image/src/darwin/macho/index.ts";
  const runtimes = projectBuildRequest([], () => {}).runtimes;
  const result = compileArm64Program({
    modules: workspaceModules([entry, ...runtimes.map((r) => r.module)]),
    entry,
    exports: ["buildExecutable"],
    runtimes,
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.value.native.code.length > 0);
});

for (const entry of [
  "packages/js-engine/src/lowering/index.ts",
  "packages/js-engine/src/script-evaluation.ts",
]) {
  test("live Script pipeline checks its own portable source: " + entry, () => {
    const run = spawnSync(
      process.execPath,
      ["tools/selfhost-coverage.ts", "--entry", entry, "--specialize"],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.stage, "checked", JSON.stringify(report));
    assert.equal(report.selfHosted, false);
  });
}

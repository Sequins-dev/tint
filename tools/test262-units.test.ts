import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import {
  compileArm64Program,
  compileNativeServiceUnit,
  compileX64NativeServiceUnit,
  type CompileRequest,
} from "@tint/compiler/native";
import { buildMacOSProgram, type BuildRequest } from "@tint/compiler/build";
import { linuxX86_64Target } from "@tint/platform/target";
import type { SourceModule } from "@tint/typescript/modules/model";
import { runtimeSources } from "@tint/compiler/cli";
import { nativeServiceFixtureRequest } from "./native-service-fixture.ts";
import { readPublishedSurface, verifyUnitSurface } from "./test262-units.ts";
import {
  capturedScriptEvaluation,
  nativeUnitEligible,
  prepareNativeUnitHost,
  nativeUnitSlotsModule,
} from "./test262-native.ts";
import { executeNativeFile } from "./test262-native-process.ts";
import { workspaceModules, workspaceSources } from "./workspace-sources.ts";
import { nativeArtifact, runNativeBatch } from "./native-target-runner.ts";

function module(
  id: string,
  text: string,
  dependencies: [string, string][] = [],
) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return { id, module: parsed.value, dependencies: new Map(dependencies) };
}

/** A host publishing the fixture's "counter" surface, with one factory slot
 * reserved before its directory (and so its digest) exists. */
const serviceMemory = "packages/native-runtime/src/intrinsics/memory.ts";
const serviceRuntime = "packages/native-runtime/src/index.ts";
const serviceAllocator =
  "packages/native-runtime/src/allocators/region/index.ts";

function counterHostRequest(collect: boolean = false): CompileRequest {
  const contracts = "packages/compiler/src/native/index.ts",
    runtimes = runtimeSources();
  if (collect)
    runtimes.push({ module: serviceMemory, namespace: "native-memory" });
  const dependencies: [string, string][] = [["contracts", contracts]];
  if (collect) dependencies.push(["memory", serviceMemory]);
  const modules: SourceModule[] = [
    ...workspaceModules([
      contracts,
      ...runtimes.map((item) => item.module),
      ...(collect ? [serviceRuntime, serviceAllocator] : []),
    ]),
    module(
      "counter-helpers",
      (collect ? 'import { collectGarbage } from "memory";' : "") +
        'import type {ManagedSurfaceExport} from "contracts";export interface Frame{readonly $imports:unknown;}export interface Counter{readonly next:()=>number;}export function seed():number{' +
        (collect ? "collectGarbage();" : "") +
        'return 1;}export function bind():ManagedSurfaceExport{throw "MANAGED_SURFACE_UNBOUND";}export function view(value:unknown):Counter|undefined{throw "UNBOUND_COUNTER_VIEW";}',
      dependencies,
    ),
    module(
      "counter-facade",
      'interface Frame{readonly $imports:unknown;}export function instantiate(frame:Frame):unknown{throw "UNBOUND_SERVICE_FACTORY";}',
    ),
    module(
      "main",
      'import {bind,view} from "helpers";import {instantiate} from "service";export function run():number{const counter=view(instantiate({$imports:bind().table}));return counter===undefined?1:counter.next()+40;}',
      [
        ["helpers", "counter-helpers"],
        ["service", "counter-facade"],
      ],
    ),
  ];
  return {
    modules,
    entry: "main",
    exports: ["run"],
    start: "run",
    closedProgram: true,
    runtimes: [
      ...runtimes,
      {
        module: "counter-helpers",
        namespace: "counter-host",
        retainedExports: ["view"],
      },
      {
        module: "counter-facade",
        namespace: "counter-service",
        retainedExports: ["instantiate"],
      },
    ],
    hostBindings: collect
      ? [
          {
            module: serviceMemory,
            name: "collectGarbage",
            operation: "collect-garbage",
          },
        ]
      : [],
    recordBindings: [
      { module: "counter-helpers", name: "view", operation: "view" },
    ],
    managedSurfaces: [
      {
        name: "counter",
        values: [
          { module: "counter-helpers", name: "seed", typeArguments: [] },
        ],
        types: [
          { module: "counter-helpers", name: "Frame", typeArguments: [] },
          { module: "counter-helpers", name: "Counter", typeArguments: [] },
        ],
        frame: "Frame",
        bind: { module: "counter-helpers", name: "bind" },
      },
    ],
    serviceImports: [
      { module: "counter-facade", name: "instantiate", surface: "counter" },
    ],
  };
}

function compileCounterHost() {
  return compileArm64Program(counterHostRequest());
}

test("surface slots take the published directory's factory contract, which units compiled against it share", () => {
  const host = compileCounterHost();
  assert.ok(host.ok, JSON.stringify(host));
  const published = host.value.managedSurfaces?.find(
    (surface) => surface.name === "counter",
  );
  assert.ok(published);
  assert.equal(published.directory.digest, published.digest);
  const contract = "tint.service.factory.v1/counter/" + published.digest;
  assert.deepEqual(
    host.value.native.managedImports.map((imported) => imported.contract),
    [contract],
  );
  // A unit compiled against the host's own directory names the same factory.
  const request = nativeServiceFixtureRequest();
  const unit = compileNativeServiceUnit({
    ...request,
    read: readPublishedSurface(published.directory),
  });
  assert.ok(unit.ok, JSON.stringify(unit));
  assert.equal(unit.value.factoryContract, contract);
  verifyUnitSurface(unit.value, published);
  assert.throws(
    () => verifyUnitSurface(unit.value, { ...published, digest: "0" }),
    /surface differs/,
  );
});

test("a published directory is read only while it stays canonical", () => {
  const host = compileCounterHost();
  assert.ok(host.ok, JSON.stringify(host));
  const published = host.value.managedSurfaces?.[0];
  assert.ok(published);
  assert.equal(
    readPublishedSurface(published.directory).directory.digest,
    published.digest,
  );
  assert.throws(
    () =>
      readPublishedSurface({
        ...published.directory,
        digest: "0".repeat(published.digest.length),
      }),
    /not readable/,
  );
});

test("x86-64 links a managed service, collects through its frames and rejects a changed fixup", () => {
  const host = compileCounterHost();
  assert.ok(host.ok, JSON.stringify(host));
  const published = host.value.managedSurfaces?.[0];
  assert.ok(published);
  const unit = compileX64NativeServiceUnit({
    ...nativeServiceFixtureRequest(),
    read: readPublishedSurface(published.directory),
    linearAllocation: true,
    generationalBarriers: true,
  });
  assert.ok(unit.ok, JSON.stringify(unit));
  const hostRequest = counterHostRequest(true);
  const bind = { module: "counter-facade", name: "instantiate" };
  const request: BuildRequest = {
    ...hostRequest,
    hostBindings: hostRequest.hostBindings ?? [],
    target: linuxX86_64Target,
    start: "run",
    nativeServices: [{ bind, unit: unit.value }],
    allocatorModule: serviceAllocator,
    runtimeModule: serviceRuntime,
    runtimeEntry: "initializeGenerationalRuntime",
    memoryModule: serviceMemory,
    identifier: "tint.x64.service",
    managedBytes: 4194304,
    controlBytes: 65536,
    allocationCapacity: 65536,
    rootCapacity: 65536,
    stackBytes: 1048576,
    report: () => {},
  };
  const image = buildMacOSProgram(request);
  assert.ok(image.ok, image.ok ? undefined : JSON.stringify(image.error));
  const { native } = unit.value;
  const reference = native.managedFixups[0];
  assert.ok(reference);
  const code = native.code.slice();
  code[reference.fixup.fieldOffset] = 1;
  const bad = buildMacOSProgram({
    ...request,
    nativeServices: [
      { bind, unit: { ...unit.value, native: { ...native, code } } },
    ],
  });
  assert.deepEqual(bad, {
    ok: false,
    error: {
      stage: "service-link",
      message: "native service: invalid managed reference",
    },
  });
  const runner = process.env.TINT_X64_HOSTED_RUNNER;
  if (runner === undefined) return;
  const directory = mkdtempSync(join(tmpdir(), "tint-x64-service-"));
  try {
    const path = join(directory, "counter");
    writeFileSync(path, image.value, { mode: 0o755 });
    const artifact = nativeArtifact(linuxX86_64Target.name, path);
    const result = runNativeBatch([{ artifact }], {
      ...process.env,
      TINT_NATIVE_RUNNER: runner,
    })[0];
    assert.equal(result?.kind, "exited", JSON.stringify(result));
    assert.equal(result.status, 42, JSON.stringify(result));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("surface slots without a published surface are rejected", () => {
  const compiled = compileArm64Program({
    modules: [
      module(
        "service",
        'interface Frame{readonly $imports:unknown;}export function slot(frame:Frame):unknown{throw "UNBOUND";}',
      ),
      module(
        "main",
        'import {slot} from "service";export function run():number{slot({$imports:undefined});return 0;}',
        [["service", "service"]],
      ),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    closedProgram: true,
    runtimes: [{ module: "service", namespace: "service-slots" }],
    serviceImports: [{ module: "service", name: "slot", surface: "missing" }],
  });
  assert.equal(compiled.ok, false);
  if (!compiled.ok) assert.equal(compiled.error.stage, "service-import");
});

test("linked-unit hosts reserve slots independent of the batch and parse case descriptors", () => {
  const evaluation = capturedScriptEvaluation(workspaceSources());
  assert.ok(evaluation);
  const modules = prepareNativeUnitHost(
    3,
    true,
    true,
    false,
    false,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    false,
    false,
    evaluation,
  );
  const slots = modules.find((item) => item.id === nativeUnitSlotsModule);
  assert.ok(slots);
  assert.deepEqual(
    slots.module.statements
      .filter((statement) => statement.kind === "function")
      .map((statement) =>
        statement.kind === "function" ? statement.name : "",
      ),
    ["slot0", "slot1", "slot2"],
  );
  assert.deepEqual(
    modules.map((item) => item.id),
    ["test262-runtime", nativeUnitSlotsModule, "test262-host"],
  );
  assert.throws(() => prepareNativeUnitHost(0), /at least one slot/);
  assert.throws(() => prepareNativeUnitHost(1), /Script evaluation host/);
});

test("only Script cases without module graphs run as linked units", () => {
  const script = module("s", "export function execute():number{return 0;}");
  assert.equal(
    nativeUnitEligible({ scripts: [script], asynchronous: false }),
    true,
  );
  assert.equal(nativeUnitEligible({ scripts: [], asynchronous: false }), false);
  assert.equal(
    nativeUnitEligible({
      scripts: [script],
      asynchronous: false,
      scriptRoot: { absent: [] },
    }),
    false,
  );
  assert.equal(
    nativeUnitEligible({ scripts: [script], asynchronous: false, modules: [] }),
    false,
  );
});

test("native case selectors are indexes or unit descriptors only", () => {
  for (const selector of [
    -1,
    0.5,
    "",
    "1 1",
    "11:2;rm",
    "a1:0",
    "1".repeat(4097),
  ])
    assert.throws(
      () => executeNativeFile("/nonexistent", 1000, selector),
      /invalid native batch selector/,
    );
});

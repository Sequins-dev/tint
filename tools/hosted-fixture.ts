import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareDateTimeNativeService } from "./date-time-native-service.ts";
import { frozenNativeRunIdentity } from "./native-run-journal.ts";
import {
  workspaceModules,
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import { projectRoots, projectBuildRequest } from "@tint/compiler/cli";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { buildMacOSProgram, type BuildRequest } from "@tint/compiler/build";
import type { SourceModule } from "@tint/typescript/modules/model";
import type {
  NativeHostBinding,
  NativeRecordBinding,
  NativeWeakBinding,
  RuntimeSource,
  ManagedSurfaceRequest,
} from "@tint/compiler/native";

/** Build through the full hosted pipeline; always contain native failures in LLDB. */
export function verifyHostedFixture(
  text: string,
  name: string,
  dependencies: readonly [string, string][] = [],
  generatedModules: readonly SourceModule[] = [],
  recordBindings: readonly NativeRecordBinding[] = [],
  additionalRuntimes: readonly RuntimeSource[] = [],
  options: {
    readonly allowJit?: boolean;
    readonly threaded?: boolean;
    readonly hostBindings?: readonly NativeHostBinding[];
    readonly weakBindings?: readonly NativeWeakBinding[];
    readonly managedSurfaces?: readonly ManagedSurfaceRequest[];
    readonly nativeServices?: BuildRequest["nativeServices"];
    readonly nativeServiceIdentity?: {
      readonly nativeLinkingMode: "aot-native-services-v1";
      readonly nativeServiceUnitIndexSha256: string;
    };
    readonly runtimeModule?: string;
    readonly runtimeEntry?: Exclude<BuildRequest["runtimeEntry"], undefined>;
    readonly managedBytes: number;
    readonly allocationCapacity: number;
    readonly stackBytes?: number;
    readonly rootCapacity?: number;
  } = {
    managedBytes: 4194304,
    allocationCapacity: 65536,
  },
): void {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const captured = workspaceSources();
  const sourceSnapshot = workspaceSourceIdentity(captured);
  const serviceMode = process.env.TINT_HOSTED_NATIVE_SERVICES;
  if (
    serviceMode !== undefined &&
    serviceMode !== "aot" &&
    serviceMode !== "monolithic"
  )
    throw Error("TINT_HOSTED_NATIVE_SERVICES must be aot, monolithic or unset");
  let serviceImage: ReturnType<typeof prepareDateTimeNativeService> | undefined;
  if (serviceMode === "aot") {
    const toolchain = frozenNativeRunIdentity(import.meta.url, sourceSnapshot);
    assert.ok(toolchain, "freeze the service fixture before compiling");
    serviceImage = prepareDateTimeNativeService(
      captured,
      toolchain,
      process.env.TINT_NATIVE_SERVICE_CACHE ??
        join(process.cwd(), ".tint-bootstrap/native-service-cache"),
      {
        generationalBarriers:
          (options.runtimeEntry ??
            projectBuildRequest([], () => {}).runtimeEntry) ===
          "initializeGenerationalRuntime",
      },
    );
  }
  const capturedModules = [
    ...workspaceModules(
      [
        ...projectRoots(),
        ...dependencies
          .map((dependency) => dependency[1])
          .filter((id) => !generatedModules.some((module) => module.id === id)),
      ],
      captured,
    ),
    ...generatedModules,
  ];
  capturedModules.push({
    id: "fixture",
    module: parsed.value,
    dependencies: new Map(dependencies),
    sourcePosition: (offset) => {
      const position = source.value.positionAt(offset);
      return position.ok ? position.value : undefined;
    },
  });
  const modules =
    serviceImage === undefined
      ? capturedModules
      : serviceImage.transformModules(capturedModules);
  const request = projectBuildRequest(modules, () => {});
  const nativeServices = [
    ...(options.nativeServices ?? []),
    ...(serviceImage?.services ?? []),
  ];
  const built = buildMacOSProgram({
    ...request,
    threaded: options.threaded ?? false,
    allowDebugger: true,
    allowJit: options.allowJit ?? false,
    runtimes: [
      ...request.runtimes,
      ...additionalRuntimes,
      ...(serviceImage?.runtimes ?? []),
    ],
    recordBindings: [
      ...recordBindings,
      ...(serviceImage?.recordBindings ?? []),
    ],
    weakBindings: options.weakBindings ?? [],
    managedSurfaces: [
      ...(options.managedSurfaces ?? []),
      ...(serviceImage === undefined ? [] : [serviceImage.surface]),
    ],
    nativeServices,
    hostBindings: [...request.hostBindings, ...(options.hostBindings ?? [])],
    runtimeModule: options.runtimeModule ?? request.runtimeModule,
    runtimeEntry:
      options.runtimeEntry ?? request.runtimeEntry ?? "initializeRuntime",
    entry: "fixture",
    start: "run",
    managedBytes: options.managedBytes,
    // Copying GC metadata needs a forwarding word per semispace allocation unit.
    allocationCapacity: options.allocationCapacity,
    rootCapacity: options.rootCapacity ?? 4096,
    stackBytes: options.stackBytes ?? 1048576,
    identifier: "tint-hosted-" + name,
    debugSymbols: process.env.TINT_DEBUG_SYMBOLS === "1",
  });
  if (!built.ok) assert.fail(JSON.stringify(built.error));
  const directory = mkdtempSync(join(tmpdir(), "tint-hosted-" + name + "-")),
    path = join(directory, name);
  writeFileSync(path, built.value, { mode: 0o755 });
  const fixturePath = path + ".source.ts";
  writeFileSync(fixturePath, bytes, { flag: "wx" });
  const generated = generatedModules.map((module) => ({
    id: module.id,
    dependencies: [...module.dependencies],
    module: module.module,
  }));
  writeFileSync(
    path + ".manifest.json",
    JSON.stringify(
      {
        kind: "tint-hosted-native-build",
        version: 1,
        sourceSnapshot,
        imageSha256: createHash("sha256").update(built.value).digest("hex"),
        fixture: fixturePath,
        fixtureSha256: createHash("sha256").update(bytes).digest("hex"),
        generatorArguments: process.argv.slice(1),
        generatedModulesSha256: createHash("sha256")
          .update(JSON.stringify(generated))
          .digest("hex"),
        options: {
          ...options,
          ...(serviceImage === undefined
            ? {}
            : {
                nativeServiceIdentity: serviceImage.identity,
              }),
          ...(nativeServices.length === 0
            ? {}
            : {
                nativeServices: nativeServices.map((service) => ({
                  bind: service.bind,
                  unit: {
                    version: service.unit.version,
                    profile: service.unit.profile,
                    factoryContract: service.unit.factoryContract,
                    surface: service.unit.surface,
                    entryOffset: service.unit.entryOffset,
                    counts: service.unit.counts,
                    codeBytes: service.unit.native.code.length,
                    codeSha256: createHash("sha256")
                      .update(service.unit.native.code)
                      .digest("hex"),
                  },
                })),
              }),
        },
        ...(serviceImage === undefined
          ? {}
          : {
              nativeServiceSourceProjectionSha256: createHash("sha256")
                .update(
                  JSON.stringify(
                    modules.map((module) => ({
                      id: module.id,
                      module: module.module,
                      dependencies: [...module.dependencies],
                    })),
                  ),
                )
                .digest("hex"),
            }),
        debugSymbols: process.env.TINT_DEBUG_SYMBOLS === "1",
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(path);
  if (process.env.TINT_BUILD_ONLY !== "1")
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = spawnSync(
          "lldb",
          [
            "--no-lldbinit",
            "--batch",
            "-o",
            "settings set target.disable-aslr false",
            "-o",
            "process launch --stop-at-entry",
            "-o",
            "script assert lldb.process.GetState() == lldb.eStateStopped",
            "-o",
            "continue",
            "-o",
            "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
            path,
          ],
          { encoding: "utf8", timeout: 60000 },
        );
        assert.equal(result.error, undefined);
        assert.equal(result.signal, null, result.stderr);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /exited with status = 42 /, result.stdout);
      }
      console.log("Verified native " + name + " twice.");
    } finally {
      if (process.env.TINT_KEEP_NATIVE !== "1")
        rmSync(directory, { recursive: true, force: true });
    }
}

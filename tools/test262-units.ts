import { createHash } from "node:crypto";
import {
  compileNativeServiceUnit,
  createManagedCollectionPlanCache,
  createManagedTypeContractCache,
  declareManagedJitRuntime,
  readManagedSurfaceDirectory,
  type ManagedSurfaceDirectoryRead,
  type NativeServiceUnit,
  type SerializedManagedSurfaceDirectory,
} from "@tint/compiler/native";
import { runtimeSources } from "@tint/compiler/cli";
import { createInterfaceResolutionCache } from "@tint/typescript/checker/interfaces";
import { scriptRuntimeSurface } from "@tint/js-engine/lowering";
import type { SourceModule } from "@tint/typescript/modules/model";
import { scriptRuntimeGlobals } from "./script-runtime-request.ts";
import {
  workspaceModules,
  type WorkspaceSourceSnapshot,
} from "./workspace-sources.ts";

/**
 * Read a published surface directory for compiling units in Node.
 *
 * The numeric leaves are placeholders, as in the Node service fixtures: unit
 * code addresses the surface through relocatable slot loads that service
 * linking binds to the image's own identities, so these values never reach
 * emitted code. The reader still verifies the directory's canonical digest.
 */
export function readPublishedSurface(
  directory: SerializedManagedSurfaceDirectory,
): ManagedSurfaceDirectoryRead {
  const entries = directory.types.entries.length;
  let witnesses = 0;
  for (const signature of directory.signatures)
    if (signature.function >= entries) witnesses++;
  const functions: unknown[] = Array.from(
    { length: entries + witnesses },
    () => () => undefined,
  );
  const operations: number[] = [];
  for (const provider of directory.runtimes)
    for (const _operation of provider.operations) {
      const slot = operations.length / 2;
      operations.push(0x400004 + slot * 4, 0x500000 + slot * 128);
    }
  const read = readManagedSurfaceDirectory(
    {
      directory,
      table: undefined,
      functions,
      records: Float64Array.from(
        directory.records,
        (_, index) => 0x100000 + index * 1024,
      ),
      entries: Float64Array.from(operations),
    },
    directory.name,
    {
      domain: () => 17,
      descriptor: () => 0x200000,
      signature: (fn) => 0x300000 + functions.indexOf(fn) * 128,
    },
  );
  if (!read.ok) throw Error("published surface is not readable: " + read.error);
  return read.value;
}

export type ScriptUnitCompilation =
  | { readonly ok: true; readonly unit: NativeServiceUnit }
  | { readonly ok: false; readonly stage: string; readonly message: string };

/**
 * Compile lowered Test262 Scripts into units against an image's published
 * Script surface, through the same entry pipeline as in-image Script
 * evaluation. Each Script keeps its AOT lowering; factory initialization
 * evaluates its module bindings when the host invokes it (once per process).
 * Results are memoized by Script source, so harness Scripts shared by many
 * cases compile once per run.
 */
export function createScriptUnitCompiler(
  directory: SerializedManagedSurfaceDirectory,
  snapshot: WorkspaceSourceSnapshot,
  policy: {
    readonly linearAllocation: boolean;
    readonly generationalBarriers: boolean;
  },
) {
  const read = readPublishedSurface(directory),
    runtimes = runtimeSources(),
    runtime = declareManagedJitRuntime({
      modules: workspaceModules(
        runtimes.map((item) => item.module),
        snapshot,
      ),
      runtimes,
      globals: scriptRuntimeGlobals,
    }),
    specifiers = new Set<string>(),
    instantiations = new Map<string, readonly string[]>(),
    collectionPlans = createManagedCollectionPlanCache(),
    interfaceCache = createInterfaceResolutionCache(),
    compiled = new Map<string, ScriptUnitCompilation>();
  for (const entry of scriptRuntimeSurface()) {
    specifiers.add(entry.specifier);
    instantiations.set(entry.name, entry.typeArguments);
  }
  return (script: SourceModule): ScriptUnitCompilation => {
    const key = scriptKey(script);
    const known = compiled.get(key);
    if (known !== undefined) return known;
    const unit = compileNativeServiceUnit({
      module: script.module,
      entry: "execute",
      specifiers,
      instantiations,
      read,
      runtime,
      typeContracts: createManagedTypeContractCache(),
      collectionPlans,
      interfaceCache,
      linearAllocation: policy.linearAllocation,
      generationalBarriers: policy.generationalBarriers,
    });
    const result: ScriptUnitCompilation = unit.ok
      ? { ok: true, unit: unit.value }
      : { ok: false, stage: unit.error.stage, message: unit.error.message };
    compiled.set(key, result);
    return result;
  };
}

/** Lowered Scripts import only the runtime vocabulary, so the module syntax
 * and its resolved dependencies identify the compiled unit. */
function scriptKey(script: SourceModule): string {
  return createHash("sha256")
    .update(JSON.stringify(script.module))
    .update(JSON.stringify([...script.dependencies]))
    .digest("hex");
}

/** A unit links only into an image publishing the surface it was compiled
 * against. */
export function verifyUnitSurface(
  unit: NativeServiceUnit,
  published: { readonly name: string; readonly digest: string },
): void {
  if (
    unit.surface.name !== published.name ||
    unit.surface.digest !== published.digest
  )
    throw Error(
      "Script unit surface differs from the host image: " +
        unit.surface.name +
        "/" +
        unit.surface.digest,
    );
}

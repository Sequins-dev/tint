import type { Module } from "@tint/typescript/syntax";
import type { TargetDataLayout } from "@tint/ts-native/closure/layout";
import { emitModule, type NativeModule } from "@tint/codegen/aarch64/scalar";
import type { ManagedSurfaceLayoutRuntime } from "./managed-directory.ts";
import type { ManagedTypeContractCache } from "./managed-contracts.ts";
import {
  selectManagedIdentityBindings,
  type ManagedSurfaceDirectoryRead,
} from "./managed-directory-reader.ts";
import { normalizeManagedSurfaceApplications } from "./managed-applications.ts";
import { adaptManagedSurfaceEntry } from "./managed-entry.ts";
import {
  prepareManagedJitProgram,
  verifyManagedJitFrame,
  lowerManagedJitProgram,
} from "./managed-jit-program.ts";
import { bindManagedJitRecords } from "./managed-jit-records.ts";
import { bindManagedJitSignatures } from "./managed-jit-signatures.ts";
import { managedDirectCallDeclarations } from "./managed-closure-uses.ts";
import {
  managedRuntimeKeysForOptions,
  describeManagedRuntimeUses,
  bindManagedRuntimeImports,
} from "./managed-runtime-selection.ts";
export interface ManagedSurfaceEntryRequest {
  /** Owned by one immutable image surface/compiler, never shared across domains. */
  readonly typeContracts?: ManagedTypeContractCache;
  readonly linearAllocation?: boolean;
  readonly generationalBarriers?: boolean;
  /** Service-unit factories initialize private module state on invocation. */
  readonly initialization?: "factory";
  readonly module: Module;
  readonly entry: string;
  readonly specifiers: ReadonlySet<string>;
  readonly instantiations: ReadonlyMap<string, readonly string[]>;
  readonly read: ManagedSurfaceDirectoryRead;
  readonly runtime: ManagedSurfaceLayoutRuntime;
  readonly target?: TargetDataLayout;
}
export interface PreparedManagedSurfaceEntry {
  readonly native: NativeModule;
  readonly entryOffset: number;
  readonly counts: {
    readonly signatures: number;
    readonly memberOnly: number;
    readonly records: number;
    readonly functions: number;
  };
}
export type ManagedSurfaceEntryFailure = {
  readonly ok: false;
  readonly error: {
    readonly stage: "profile" | "prepare" | "lower" | "emit" | "select";
    readonly message: string;
  };
};
export type ManagedSurfaceEntryPreparation =
  | { readonly ok: true; readonly value: PreparedManagedSurfaceEntry }
  | ManagedSurfaceEntryFailure;
/** Compile against an image-issued surface. Resolve every semantic contract
 * before returning unresolved code; mapping, pointer reads and publication are
 * exclusively the owning engine's responsibility. */
export function prepareManagedSurfaceEntry(
  request: ManagedSurfaceEntryRequest,
): ManagedSurfaceEntryPreparation {
  const fail = (
    stage: "profile" | "prepare" | "lower" | "emit" | "select",
    message: string,
  ): ManagedSurfaceEntryPreparation => ({
    ok: false,
    error: { stage, message },
  });
  const read = request.read,
    frame = read.directory.frame,
    surface = read.contracts.surface;
  if (frame === undefined) return fail("profile", "surface has no entry frame");
  const normalized = normalizeManagedSurfaceApplications(
    request.module,
    request.specifiers,
    request.instantiations,
    surface,
  );
  if (!normalized.ok) return fail("profile", normalized.error);
  const specifiers: string[] = [];
  for (const specifier of request.specifiers) specifiers.push(specifier);
  const adapted = adaptManagedSurfaceEntry(
    normalized.value.module,
    request.entry,
    specifiers,
    surface,
    { frame },
    request.initialization ?? "none",
  );
  if (!adapted.ok) return fail("profile", adapted.error);
  const view = adapted.value.view;
  if (view === undefined)
    return fail("profile", "managed entry view is missing");
  const aliases: string[] = [];
  for (const declaration of surface.declarations) {
    if (
      declaration === undefined ||
      (declaration.kind !== "type-alias" && declaration.kind !== "interface")
    )
      return fail("profile", "surface requires type declarations");
    aliases.push(declaration.name);
  }
  const prepared = prepareManagedJitProgram(
    adapted.value.module,
    adapted.value.entry,
    view,
    aliases,
    request.runtime,
    request.typeContracts,
  );
  if (!prepared.ok) return fail("prepare", prepared.error);
  const frameExport = surface.types.find(
      (type) => type !== undefined && type.name === frame,
    ),
    table = surface.table;
  const frameType = frameExport?.type;
  if (
    frameType === undefined ||
    frameType.kind !== "named" ||
    table.kind !== "named"
  )
    return fail("profile", "surface frame or table alias is missing");
  const frameAlias = frameType.name;
  const agreement = verifyManagedJitFrame(prepared.value, frameAlias);
  if (!agreement.ok) return fail("profile", agreement.error);
  const direct = managedDirectCallDeclarations(
    prepared.value.checked,
    prepared.value.entry,
  );
  if (!direct.ok) return fail("profile", direct.error);
  const lowered = lowerManagedJitProgram(
    prepared.value,
    request.target ?? request.runtime.target,
  );
  if (!lowered.ok) return fail("lower", lowered.error);
  const records = bindManagedJitRecords(
    prepared.value,
    lowered.value,
    read.directory,
    [table.name, frameAlias],
  );
  if (!records.ok) return fail("profile", records.error);
  const keys = managedRuntimeKeysForOptions(
    read.directory,
    prepared.value.checked,
    prepared.value.aliasTypes,
    prepared.value.options,
    prepared.value.typeContracts,
  );
  if (!keys.ok) return fail("profile", keys.error);
  const uses = describeManagedRuntimeUses(prepared.value.options, keys.value);
  if (!uses.ok) return fail("profile", uses.error);
  const functions = bindManagedRuntimeImports(
    read.directory,
    lowered.value.module,
    lowered.value.sources,
    uses.value,
  );
  if (!functions.ok) return fail("profile", functions.error);
  const signatures = bindManagedJitSignatures(
    prepared.value,
    lowered.value,
    read.directory,
    direct.value,
  );
  if (!signatures.ok) return fail("profile", signatures.error);
  const brand = signatures.value.brand;
  const emitted = emitModule(lowered.value.module, {
    linearAllocation: request.linearAllocation ?? false,
    generationalBarriers: request.generationalBarriers ?? false,
    closedRoots: [lowered.value.entry],
    signatureRoots:
      request.initialization === "factory" ? [lowered.value.entry] : [],
    managedABI: {
      version: 1,
      ...(brand === undefined ? {} : { functionBrand: brand }),
      signatures: signatures.value.signatures,
      records: records.value,
      functions: functions.value,
    },
  });
  if (!emitted.ok) return fail("emit", emitted.error.message);

  if (emitted.value.imports.length !== 0)
    return fail("profile", "managed entry has unresolved native imports");
  const selection = selectManagedIdentityBindings(
    read,
    emitted.value.managedImports,
  );
  if (!selection.ok) return fail("select", selection.error);
  const entry = emitted.value.functions.find(
    (fn) => fn !== undefined && fn.id === lowered.value.entry,
  );
  if (entry === undefined || entry.import === true)
    return fail("emit", "managed native entry is missing");
  let memberOnly = 0;
  for (const binding of signatures.value.signatures) {
    if (binding === undefined)
      return fail("profile", "missing signature binding");
    if (binding.witness === undefined) memberOnly++;
  }
  return {
    ok: true,
    value: {
      native: emitted.value,
      entryOffset: entry.offset,
      counts: {
        signatures: signatures.value.signatures.length,
        memberOnly,
        records: records.value.length,
        functions: functions.value.length,
      },
    },
  };
}

import {
  prepareManagedSurfaceEntry,
  prepareX64ManagedSurfaceEntry,
  type ManagedSurfaceEntryRequest,
  type PreparedManagedSurfaceEntry,
  type PreparedX64ManagedSurfaceEntry,
  type ManagedSurfaceEntryFailure,
} from "./managed-jit-entry.ts";
interface ServiceFactory {
  readonly version: 1;
  readonly profile: "managed-factory-v1";
  readonly factoryContract: string;
  readonly surface: {
    readonly name: string;
    readonly digest: string;
    readonly frame: string;
  };
}
export interface NativeServiceUnit
  extends PreparedManagedSurfaceEntry, ServiceFactory {
  readonly arch: "aarch64";
}
export interface X64NativeServiceUnit
  extends PreparedX64ManagedSurfaceEntry, ServiceFactory {
  readonly arch: "x86_64";
}
export type NativeServiceCompilation =
  | { readonly ok: true; readonly value: NativeServiceUnit }
  | ManagedSurfaceEntryFailure;
/** Compile one managed factory. Module bindings are initialized inside each
 * invocation; returned closures retain that invocation's traced import frame.
 * The result contains symbolic imports and no context or process addresses. */
export function compileNativeServiceUnit(
  request: ManagedSurfaceEntryRequest,
): NativeServiceCompilation {
  const prepared = prepareManagedSurfaceEntry({
    ...request,
    initialization: "factory",
  });
  if (!prepared.ok) return prepared;
  return {
    ok: true,
    value: {
      ...prepared.value,
      ...serviceFactory(request),
      arch: "aarch64",
    },
  };
}

export function compileX64NativeServiceUnit(
  request: ManagedSurfaceEntryRequest,
):
  | { readonly ok: true; readonly value: X64NativeServiceUnit }
  | ManagedSurfaceEntryFailure {
  const prepared = prepareX64ManagedSurfaceEntry({
    ...request,
    initialization: "factory",
  });
  if (!prepared.ok) return prepared;
  return {
    ok: true,
    value: { ...prepared.value, ...serviceFactory(request), arch: "x86_64" },
  };
}

function serviceFactory(request: ManagedSurfaceEntryRequest): ServiceFactory {
  const directory = request.read.directory;
  return {
    version: 1,
    profile: "managed-factory-v1",
    factoryContract:
      "tint.service.factory.v1/" + directory.name + "/" + directory.digest,
    surface: {
      name: directory.name,
      digest: directory.digest,
      frame: directory.frame ?? "",
    },
  };
}

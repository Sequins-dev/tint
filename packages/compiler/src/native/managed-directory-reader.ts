import {
  nativeSignatureVersion,
  nativeFunctionByteLength,
  nativeFunctionReferenceCount,
  nativeFunctionEnvironmentOffset,
  nativeFunctionGeneralCount,
} from "@tint/abi/function";
import type {
  NativeManagedPointerImport,
  NativeModule,
} from "@tint/codegen/aarch64/scalar";
import type { ManagedSurfaceContractPlan } from "./managed-contracts.ts";
import type { X64Module } from "@tint/codegen/x86_64/scalar";
import {
  resolveManagedPointers,
  resolveX64ManagedPointers,
  type ManagedIdentityReader,
  type ManagedPointerResolution,
  managedIdentityByteLength,
  sameManagedRecordLayout,
  type ManagedIdentityBinding,
  type ManagedIdentityShape,
} from "./managed-imports.ts";
import {
  managedSurfaceDirectoryVersion,
  createManagedSurfaceDirectory,
  digestManagedSurfaceDirectory,
  type ManagedSurfaceExport,
  type SerializedManagedSurfaceDirectory,
} from "./managed-directory-data.ts";
import { createManagedSurfaceRestorations } from "./managed-surface-text.ts";
import type { ManagedSurfacePhysicalFacts } from "./managed-directory.ts";
export interface ManagedSurfaceDirectoryHost {
  readonly domain: () => number;
  readonly descriptor: (fn: unknown) => number;
  readonly signature: (fn: unknown) => number;
}
export interface ManagedSurfaceDirectoryRead {
  readonly domain: number;
  readonly directory: SerializedManagedSurfaceDirectory;
  readonly contracts: ManagedSurfaceContractPlan;
  readonly brand: ManagedIdentityBinding;
  readonly signatures: readonly ManagedIdentityBinding[];
  readonly records: readonly ManagedIdentityBinding[];
  readonly runtimes: readonly ManagedIdentityBinding[];
}
export type ManagedSurfaceDirectoryReading =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: ManagedSurfaceDirectoryRead };
function pointer(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value % 8 === 0;
}
function digestText(value: string): boolean {
  if (value.length !== 64) return false;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (!((unit >= 48 && unit <= 57) || (unit >= 97 && unit <= 102)))
      return false;
  }
  return true;
}
export function managedSurfaceContract(
  name: string,
  digest: string,
  kind: "fn" | "record" | "runtime",
  index: number,
): string {
  return (
    "tint.surface.v1/" + name + "/" + digest + "/" + kind + "/" + String(index)
  );
}
/** Consumes an image-owned typed export, never a JavaScript-supplied directory.
 * A digest establishes consistency, not provenance. Validate the whole plan
 * before calling any leaf; this function never dereferences metadata addresses. */
export function readManagedSurfaceDirectory(
  exported: ManagedSurfaceExport,
  expectedName: string,
  host: ManagedSurfaceDirectoryHost,
): ManagedSurfaceDirectoryReading {
  const reject = (reason: string): ManagedSurfaceDirectoryReading => ({
    ok: false,
    error: "surface reader: " + reason,
  });
  const input = exported.directory;
  if (input.version !== managedSurfaceDirectoryVersion)
    return reject("unsupported directory version");
  if (
    input.name !== expectedName ||
    input.name.length === 0 ||
    input.name.includes("/") ||
    input.name.includes("\0")
  )
    return reject("surface name mismatch");
  const brandWords = [
    nativeFunctionByteLength,
    nativeFunctionReferenceCount,
    nativeFunctionEnvironmentOffset,
    nativeFunctionGeneralCount,
  ];
  if (
    input.abi.signature !== nativeSignatureVersion ||
    input.abi.functionBrand.length !== brandWords.length ||
    brandWords.some((word, index) => input.abi.functionBrand[index] !== word)
  )
    return reject("ABI mismatch");
  if (!digestText(input.digest)) return reject("invalid digest");
  const digest = digestManagedSurfaceDirectory(input);
  if (!digest.ok) return reject(digest.error);
  if (digest.value !== input.digest) return reject("digest mismatch");
  // A canonical export reprints to the same serialized value during
  // re-derivation; restore each distinct value once for this read.
  const restorations = createManagedSurfaceRestorations(),
    restored = restorations.restore(input.types);
  if (!restored.ok) return reject("types: " + restored.error);
  const recordFacts: ManagedSurfacePhysicalFacts["records"][number][] = [],
    signatureFacts: ManagedSurfacePhysicalFacts["signatures"][number][] = [];
  for (const record of input.records) {
    if (record === undefined) return reject("missing record class");
    for (const alias of [record.alias, ...record.aliases]) {
      if (alias === undefined) return reject("missing record alias");
      recordFacts.push({ alias, layout: record.layout });
    }
  }
  for (const signature of input.signatures) {
    if (signature === undefined) return reject("missing signature class");
    for (const alias of [signature.alias, ...signature.aliases]) {
      if (alias === undefined) return reject("missing signature alias");
      signatureFacts.push({
        alias,
        parameters: signature.parameters,
        returnType: signature.returnType,
      });
    }
  }
  const rebuilt = createManagedSurfaceDirectory(
    input.name,
    restored.value,
    {
      records: recordFacts,
      signatures: signatureFacts,
      runtimes: input.runtimes,
    },
    input.frame,
    restorations,
  );
  if (!rebuilt.ok) return reject("classes: " + rebuilt.error);
  const directory = rebuilt.value.directory;
  if (directory.digest !== input.digest)
    return reject("directory is not canonical");
  if (
    exported.functions.length !==
      directory.types.entries.length + rebuilt.value.witnesses.length ||
    exported.functions.length === 0
  )
    return reject("function count differs");
  if (exported.records.length !== directory.records.length)
    return reject("record count differs");
  const functions = exported.functions.slice();
  for (const fn of functions) {
    if (fn === undefined) return reject("missing function value");
  }
  const addresses: number[] = [],
    recordWindows: number[] = [],
    signatureWindows: number[] = [];
  for (let index = 0; index < directory.records.length; index++) {
    const record = directory.records[index],
      address = exported.records[index];
    if (record === undefined) throw "reader record class invariant";
    if (address === undefined || !pointer(address))
      return reject("record address unavailable: record/" + String(index));
    const bytes = managedIdentityByteLength({
      role: "record",
      recordLayout: record.layout,
      parameters: [],
      returnType: undefined,
    });
    if (bytes === undefined) return reject("invalid record layout");
    addresses.push(address);
    recordWindows.push(bytes);
  }
  for (const signature of directory.signatures) {
    if (signature === undefined) throw "reader signature class invariant";
    if (
      !Number.isSafeInteger(signature.function) ||
      signature.function < 0 ||
      signature.function >= functions.length
    )
      return reject("function index out of range");
    const bytes = managedIdentityByteLength({
      role: "signature",
      parameters: signature.parameters,
      returnType: signature.returnType,
    });
    if (bytes === undefined) return reject("invalid signature shape");
    signatureWindows.push(bytes);
  }
  let runtimeCount = 0;
  for (const provider of directory.runtimes) {
    if (provider === undefined) throw "reader runtime provider invariant";
    runtimeCount += provider.operations.length;
  }
  if (exported.entries.length !== runtimeCount * 2)
    return reject("runtime entry count differs");
  const runtimeAddresses: {
    entry: number;
    address: number;
    byteLength: number;
  }[] = [];
  let runtimeSlot = 0;
  for (const provider of directory.runtimes) {
    if (provider === undefined) throw "reader runtime provider invariant";
    for (const operation of provider.operations) {
      if (operation === undefined) throw "reader runtime operation invariant";
      const entry = exported.entries[runtimeSlot * 2],
        address = exported.entries[runtimeSlot * 2 + 1];
      if (
        entry === undefined ||
        !Number.isSafeInteger(entry) ||
        entry <= 0 ||
        entry % 4 !== 0 ||
        address === undefined ||
        !pointer(address)
      )
        return reject("runtime entry unavailable: runtime/" + runtimeSlot);
      const byteLength = managedIdentityByteLength({
        role: "function-entry",
        parameters: operation.parameters,
        returnType: operation.returnType,
      });
      if (byteLength === undefined) return reject("invalid runtime signature");
      runtimeAddresses.push({ entry, address, byteLength });
      runtimeSlot++;
    }
  }
  const brandShape: ManagedIdentityShape = {
    role: "function-brand",
    parameters: [],
    returnType: undefined,
  };
  const brandWindow = managedIdentityByteLength(brandShape);
  if (brandWindow === undefined) throw "function brand shape invariant";
  const domain = host.domain();
  if (!Number.isSafeInteger(domain) || domain <= 0)
    return reject("unissued context domain");
  const brand = host.descriptor(functions[0]);
  if (!pointer(brand)) return reject("function brand unavailable");
  const signatures: ManagedIdentityBinding[] = [],
    records: ManagedIdentityBinding[] = [];
  for (let index = 0; index < directory.signatures.length; index++) {
    const signature = directory.signatures[index],
      byteLength = signatureWindows[index];
    if (signature === undefined || byteLength === undefined)
      throw "reader signature plan invariant";
    const fn = functions[signature.function];
    if (host.descriptor(fn) !== brand) return reject("foreign function brand");
    const address = host.signature(fn);
    if (!pointer(address))
      return reject("signature unavailable: fn/" + String(index));
    const contract = managedSurfaceContract(
      directory.name,
      directory.digest,
      "fn",
      index,
    );
    signatures.push({
      domain,
      role: "signature",
      name: contract,
      contract,
      address,
      byteLength,
      parameters: signature.parameters,
      returnType: signature.returnType,
    });
  }
  for (let index = 0; index < directory.records.length; index++) {
    const record = directory.records[index],
      address = addresses[index],
      byteLength = recordWindows[index];
    if (
      record === undefined ||
      address === undefined ||
      byteLength === undefined
    )
      throw "reader record plan invariant";
    const contract = managedSurfaceContract(
      directory.name,
      directory.digest,
      "record",
      index,
    );
    records.push({
      domain,
      role: "record",
      name: contract,
      contract,
      address,
      byteLength,
      parameters: [],
      returnType: undefined,
      recordLayout: record.layout,
    });
  }
  const runtimes: ManagedIdentityBinding[] = [];
  runtimeSlot = 0;
  for (const provider of directory.runtimes) {
    if (provider === undefined) throw "reader runtime provider invariant";
    for (const operation of provider.operations) {
      if (operation === undefined) throw "reader runtime operation invariant";
      const pointers = runtimeAddresses[runtimeSlot];
      if (pointers === undefined) throw "reader runtime address invariant";
      const contract = managedSurfaceContract(
        directory.name,
        directory.digest,
        "runtime",
        runtimeSlot,
      );
      runtimes.push({
        domain,
        role: "function-entry",
        name: contract,
        contract,
        ...pointers,
        parameters: operation.parameters,
        returnType: operation.returnType,
      });
      runtimeSlot++;
    }
  }
  if (host.domain() !== domain) return reject("context domain changed");
  return {
    ok: true,
    value: {
      domain,
      directory,
      contracts: rebuilt.value.contracts,
      brand: {
        domain,
        ...brandShape,
        name: "tint.function.v1",
        contract: "tint.function.v1",
        address: brand,
        byteLength: brandWindow,
      },
      signatures,
      records,
      runtimes,
    },
  };
}
export type ManagedIdentitySelection =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly value: readonly ManagedIdentityBinding[] };
/** Select by issued semantic contract; the importing symbol is only a local
 * name. The later pointer resolver must receive the current host domain. */
export function selectManagedIdentityBindings(
  read: ManagedSurfaceDirectoryRead,
  imports: readonly NativeManagedPointerImport[],
): ManagedIdentitySelection {
  const reject = (reason: string): ManagedIdentitySelection => ({
    ok: false,
    error: "surface reader: " + reason,
  });
  const pool = new Map<string, ManagedIdentityBinding>();
  const bindings: ManagedIdentityBinding[] = [read.brand];
  for (const binding of read.signatures) {
    if (binding === undefined) throw "surface signature binding invariant";
    bindings.push(binding);
  }
  for (const binding of [...read.records, ...read.runtimes]) {
    if (binding === undefined) throw "surface record binding invariant";
    bindings.push(binding);
  }
  for (const binding of bindings) {
    if (binding === undefined) throw "surface binding invariant";
    if (pool.has(binding.contract)) return reject("duplicate binding contract");
    pool.set(binding.contract, binding);
  }
  const names = new Set<string>(),
    selected: ManagedIdentityBinding[] = [];
  for (const request of imports) {
    if (request === undefined) return reject("missing import");
    if (
      request.name.length === 0 ||
      request.name.includes("\0") ||
      names.has(request.name)
    )
      return reject("invalid or duplicate import name");
    names.add(request.name);
    const binding = pool.get(request.contract);
    if (binding === undefined) return reject("unknown import contract");
    if (
      binding.domain !== read.domain ||
      binding.role !== request.role ||
      binding.returnType !== request.returnType ||
      binding.parameters.length !== request.parameters.length ||
      binding.parameters.some(
        (value, index) => value !== request.parameters[index],
      ) ||
      !sameManagedRecordLayout(binding.recordLayout, request.recordLayout)
    )
      return reject("import shape differs");
    selected.push({ ...binding, name: request.name });
  }
  return { ok: true, value: selected };
}

/** Resolve only after the host re-reads its live domain. Selection and the
 * resolver's complete preflight precede metadata reads and private-byte patches;
 * mapping and executable publication remain the caller's responsibility. */
export function linkManagedSurfaceModule(
  read: ManagedSurfaceDirectoryRead,
  native: NativeModule,
  readWord: ManagedIdentityReader,
  domain: number,
): ManagedPointerResolution {
  if (domain !== read.domain)
    return { ok: false, error: "surface link: context domain changed" };
  let imports: readonly NativeManagedPointerImport[] = [];
  const supplied = native.managedImports;
  if (supplied !== undefined) imports = supplied;
  const selected = selectManagedIdentityBindings(read, imports);
  if (!selected.ok) return selected;
  return resolveManagedPointers(native, selected.value, readWord, domain);
}

export function linkX64ManagedSurfaceModule(
  read: ManagedSurfaceDirectoryRead,
  native: X64Module,
  readWord: ManagedIdentityReader,
  domain: number,
): ManagedPointerResolution {
  if (domain !== read.domain)
    return { ok: false, error: "surface link: context domain changed" };
  const selected = selectManagedIdentityBindings(read, native.managedImports);
  if (!selected.ok) return selected;
  return resolveX64ManagedPointers(native, selected.value, readWord, domain);
}

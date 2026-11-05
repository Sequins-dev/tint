import {
  planManagedSurfaceRuntimes,
  validateManagedRuntimeProviders,
  type ManagedRuntimeProvider,
} from "./managed-runtimes.ts";
import { sameManagedRecordLayout as sameLayout } from "./managed-imports.ts";
import { sha256 } from "@tint/foundation/binary/sha256";
import { writeUnsigned } from "@tint/foundation/binary/bytes";
import {
  nativeSignatureVersion,
  nativeFunctionByteLength,
  nativeFunctionReferenceCount,
  nativeFunctionEnvironmentOffset,
  nativeFunctionGeneralCount,
} from "@tint/abi/function";
import type {
  RecordLayout,
  RecordField,
  ScalarType,
  ReturnType,
} from "@tint/ir/scalar";
import type { ManagedSurfacePhysicalFacts } from "./managed-directory.ts";
import {
  planManagedSurfaceContracts,
  type ManagedSurfaceContractPlan,
} from "./managed-contracts.ts";
import type { ManagedSurfaceTypeDescription } from "./managed-surfaces.ts";
import {
  serializeManagedSurfaceTypes,
  type SerializedManagedSurfaceTypes,
} from "./managed-surface-text.ts";

export const managedSurfaceDirectoryVersion = 3;

export interface ManagedSurfaceDirectoryData {
  readonly version: number;
  readonly name: string;
  readonly frame: string | undefined;
  readonly runtimes: readonly ManagedRuntimeProvider[];
  readonly abi: {
    readonly signature: number;
    readonly functionBrand: readonly number[];
  };
  readonly types: SerializedManagedSurfaceTypes;
  readonly signatures: readonly {
    readonly alias: string;
    readonly aliases: readonly string[];
    readonly function: number;
    readonly parameters: readonly ScalarType[];
    readonly returnType: ReturnType;
  }[];
  readonly records: readonly {
    readonly alias: string;
    readonly aliases: readonly string[];
    readonly layout: RecordLayout;
  }[];
}
export interface SerializedManagedSurfaceDirectory extends ManagedSurfaceDirectoryData {
  readonly digest: string;
}
/** Image-owned result of a compiler-bound application stub. The engine roots
 * this value privately; a user-supplied directory is not trusted provenance. */
export interface ManagedSurfaceExport {
  readonly directory: SerializedManagedSurfaceDirectory;
  readonly table: unknown;
  readonly functions: readonly unknown[];
  readonly records: Float64Array;
  readonly entries: Float64Array;
}
export type ManagedSurfaceDirectoryEncoding =
  | { readonly ok: true; readonly value: Uint8Array }
  | { readonly ok: false; readonly error: string };
export type ManagedSurfaceDirectoryDigest =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };
export interface ManagedSurfaceDirectoryPreparation {
  readonly directory: SerializedManagedSurfaceDirectory;
  /** Private producer graph; its IDs are never serialized or used as authority. */
  readonly contracts: ManagedSurfaceContractPlan;
  /** Helper-free class representatives, appended after table fields. */
  readonly witnesses: readonly string[];
}
export type ManagedSurfaceDirectoryCreation =
  | { readonly ok: true; readonly value: ManagedSurfaceDirectoryPreparation }
  | { readonly ok: false; readonly error: string };

/** Canonical digest input, not an executable or a pointer-bearing wire image.
 * Strings are length-prefixed UTF-16LE, preserving lone surrogates exactly.
 * The digest itself is deliberately excluded. */
export function encodeManagedSurfaceDirectory(
  directory: ManagedSurfaceDirectoryData,
): ManagedSurfaceDirectoryEncoding {
  let bytes: Uint8Array | undefined,
    position = 0;
  function advance(length: number): void {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      position > 0xffffffff - length
    )
      throw "directory encoding exceeds uint32 extent";
    position += length;
  }
  function uint(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw "directory word is outside uint32 range";
    if (bytes !== undefined) {
      const written = writeUnsigned(bytes, position, 4, value, "little");
      if (!written.ok) throw "directory word write failed";
    }
    advance(4);
  }
  function text(value: string): void {
    uint(value.length);
    const target = bytes;
    if (target === undefined) {
      advance(value.length * 2);
      return;
    }
    for (let index = 0; index < value.length; index++) {
      const written = writeUnsigned(
        target,
        position,
        2,
        value.charCodeAt(index),
        "little",
      );
      if (!written.ok) throw "directory code-unit write failed";
      advance(2);
    }
  }
  function strings(values: readonly string[]): void {
    uint(values.length);
    for (const value of values) {
      if (value === undefined) throw "directory string list contains a hole";
      text(value);
    }
  }
  function encode(): void {
    text("tint.surface.directory");
    uint(directory.version);
    text(directory.name);
    uint(directory.frame === undefined ? 0 : 1);
    if (directory.frame !== undefined) text(directory.frame);
    uint(directory.abi.signature);
    uint(directory.abi.functionBrand.length);
    for (const word of directory.abi.functionBrand) {
      if (word === undefined) throw "directory ABI contains a hole";
      uint(word);
    }
    const types = directory.types;
    uint(types.version);
    text(types.declarations);
    text(types.table);
    uint(types.entries.length);
    for (const entry of types.entries) {
      if (entry === undefined) throw "directory helper list contains a hole";
      text(entry.name);
      text(entry.local);
      text(entry.type);
    }
    uint(types.types.length);
    for (const entry of types.types) {
      if (entry === undefined) throw "directory type list contains a hole";
      text(entry.name);
      text(entry.type);
    }
    uint(directory.signatures.length);
    for (const signature of directory.signatures) {
      if (signature === undefined)
        throw "directory signature list contains a hole";
      text(signature.alias);
      strings(signature.aliases);
      uint(signature.function);
      strings(signature.parameters);
      text(signature.returnType);
    }
    uint(directory.records.length);
    for (const record of directory.records) {
      if (record === undefined) throw "directory record list contains a hole";
      text(record.alias);
      strings(record.aliases);
      uint(record.layout.byteLength);
      uint(record.layout.fields.length);
      for (const field of record.layout.fields) {
        if (field === undefined) throw "directory field list contains a hole";
        if (field.stateOffset !== undefined)
          throw "environment state is not a surface layout";
        uint(field.offset);
        text(field.type);
        uint(field.mutable ? 1 : 0);
        uint(field.presenceOffset === undefined ? 0 : field.presenceOffset + 1);
      }
    }
    uint(directory.runtimes.length);
    for (const provider of directory.runtimes) {
      if (provider === undefined) throw "directory runtime provider hole";
      text(provider.kind);
      text(provider.element);
      text(provider.value);
      uint(provider.operations.length);
      for (const operation of provider.operations) {
        if (operation === undefined) throw "directory runtime operation hole";
        text(operation.operation);
        strings(operation.parameters);
        text(operation.returnType);
      }
    }
  }
  try {
    encode();
    const length = position;
    const result = new Uint8Array(length);
    bytes = result;
    position = 0;
    encode();
    if (position !== length) throw "directory changed during encoding";
    return { ok: true, value: result };
  } catch (error) {
    return {
      ok: false,
      error:
        typeof error === "string" ? error : "invalid directory encoding input",
    };
  }
}
export function digestManagedSurfaceDirectory(
  directory: ManagedSurfaceDirectoryData,
): ManagedSurfaceDirectoryDigest {
  const encoded = encodeManagedSurfaceDirectory(directory);
  if (!encoded.ok) return encoded;
  const hash = sha256(encoded.value),
    digits = "0123456789abcdef";
  let result = "";
  for (const byte of hash) {
    if (byte === undefined) throw "directory digest invariant";
    const high = Math.floor(byte / 16),
      low = byte % 16;
    result += digits.slice(high, high + 1) + digits.slice(low, low + 1);
  }
  return { ok: true, value: result };
}
export type ManagedSurfacePhysicalAgreement =
  { readonly ok: true } | { readonly ok: false; readonly error: string };
/** Validate facts extracted from application lowering before pruning/emission.
 * Directory labels remain distinct even when several labels share a layout or
 * ABI. This checks agreement only; neither addresses nor semantic authority are
 * inferred from the machine representation. */
export function verifyManagedSurfacePhysicalAgreement(
  directory: ManagedSurfaceDirectoryData,
  actual: ManagedSurfacePhysicalFacts,
): ManagedSurfacePhysicalAgreement {
  const layouts = new Map<string, RecordLayout>();
  const signatures = new Map<
    string,
    {
      readonly parameters: readonly ScalarType[];
      readonly returnType: ReturnType;
    }
  >();
  for (const record of actual.records) {
    if (record === undefined) throw "AOT layout fact invariant";
    if (layouts.has(record.alias))
      return { ok: false, error: "duplicate AOT layout: " + record.alias };
    layouts.set(record.alias, record.layout);
  }
  for (const signature of actual.signatures) {
    if (signature === undefined) throw "AOT ABI fact invariant";
    if (signatures.has(signature.alias))
      return { ok: false, error: "duplicate AOT ABI: " + signature.alias };
    signatures.set(signature.alias, signature);
  }
  const recordAliases = new Set<string>(),
    functionAliases = new Set<string>();
  for (const record of directory.records) {
    if (record === undefined) throw "directory record invariant";
    for (const alias of [record.alias, ...record.aliases]) {
      if (alias === undefined) throw "directory record alias invariant";
      if (recordAliases.has(alias))
        return { ok: false, error: "duplicate directory layout: " + alias };
      recordAliases.add(alias);
      const layout = layouts.get(alias);
      if (layout === undefined)
        return { ok: false, error: "missing AOT layout: " + alias };
      if (!sameLayout(layout, record.layout))
        return { ok: false, error: "AOT layout skew: " + alias };
    }
  }
  for (const expected of directory.signatures) {
    if (expected === undefined) throw "directory ABI invariant";
    for (const alias of [expected.alias, ...expected.aliases]) {
      if (alias === undefined) throw "directory function alias invariant";
      if (functionAliases.has(alias))
        return { ok: false, error: "duplicate directory ABI: " + alias };
      functionAliases.add(alias);
      const signature = signatures.get(alias);
      if (signature === undefined)
        return { ok: false, error: "missing AOT ABI: " + alias };
      if (
        signature.returnType !== expected.returnType ||
        signature.parameters.length !== expected.parameters.length ||
        signature.parameters.some(
          (parameter, index) => parameter !== expected.parameters[index],
        )
      )
        return { ok: false, error: "AOT ABI skew: " + alias };
    }
  }
  for (const record of actual.records) {
    if (record === undefined) throw "AOT layout fact invariant";
    if (!recordAliases.has(record.alias))
      return { ok: false, error: "unexpected AOT layout: " + record.alias };
  }
  for (const signature of actual.signatures) {
    if (signature === undefined) throw "AOT ABI fact invariant";
    if (!functionAliases.has(signature.alias))
      return { ok: false, error: "unexpected AOT ABI: " + signature.alias };
  }
  const runtimeFacts = actual.runtimes ?? [];
  if (runtimeFacts.length !== directory.runtimes.length)
    return { ok: false, error: "AOT runtime provider count differs" };
  for (let index = 0; index < directory.runtimes.length; index++) {
    const expected = directory.runtimes[index],
      provided = runtimeFacts[index];
    if (expected === undefined || provided === undefined)
      throw "AOT runtime provider invariant";
    if (
      expected.kind !== provided.kind ||
      expected.element !== provided.element ||
      expected.value !== provided.value ||
      expected.operations.length !== provided.operations.length
    )
      return {
        ok: false,
        error: "AOT runtime provider differs: " + expected.kind,
      };
    for (let position = 0; position < expected.operations.length; position++) {
      const a = expected.operations[position],
        b = provided.operations[position];
      if (a === undefined || b === undefined)
        throw "AOT runtime operation invariant";
      if (
        a.operation !== b.operation ||
        a.returnType !== b.returnType ||
        a.parameters.length !== b.parameters.length ||
        a.parameters.some((type, index) => type !== b.parameters[index])
      )
        return {
          ok: false,
          error: "AOT runtime ABI skew: " + expected.kind + "." + a.operation,
        };
    }
  }
  return { ok: true };
}
function copyLayout(layout: RecordLayout): RecordLayout {
  const fields: RecordField[] = [];
  for (const field of layout.fields) {
    if (field === undefined) throw "surface layout field invariant";
    fields.push({
      offset: field.offset,
      type: field.type,
      mutable: field.mutable,
      ...(field.presenceOffset === undefined
        ? {}
        : { presenceOffset: field.presenceOffset }),
      ...(field.stateOffset === undefined
        ? {}
        : { stateOffset: field.stateOffset }),
    });
  }
  return { byteLength: layout.byteLength, fields };
}
/** Combine independently derived physical facts with exact semantic classes.
 * Equal layouts never merge classes. Return data snapshots, not source/image IDs. */
export function createManagedSurfaceDirectory(
  name: string,
  surface: ManagedSurfaceTypeDescription,
  facts: ManagedSurfacePhysicalFacts,
  frame?: string,
): ManagedSurfaceDirectoryCreation {
  const failure = (error: string): ManagedSurfaceDirectoryCreation => ({
    ok: false,
    error: "surface directory: " + error,
  });
  if (name.length === 0 || name.includes("\0")) return failure("invalid name");
  const planned = planManagedSurfaceContracts(surface);
  if (!planned.ok) return planned;
  const contracts = planned.value,
    serialized = serializeManagedSurfaceTypes(contracts.surface);
  if (!serialized.ok) return serialized;
  if (frame !== undefined) {
    const exported = contracts.surface.types.find(
      (entry) => entry !== undefined && entry.name === frame,
    );
    const alias = exported?.type;
    const id =
      alias?.kind === "named"
        ? contracts.checked.typeNames.get(alias.name)
        : undefined;
    if (id === undefined || contracts.checked.types[id]?.kind !== "object")
      return failure("frame must name an exported record");
  }
  const layouts = new Map<string, RecordLayout>(),
    abis = new Map<
      string,
      {
        readonly parameters: readonly ScalarType[];
        readonly returnType: ReturnType;
      }
    >();
  for (const record of facts.records) {
    if (record === undefined) throw "surface record fact invariant";
    if (layouts.has(record.alias))
      return failure("duplicate record fact: " + record.alias);
    layouts.set(record.alias, record.layout);
  }
  for (const signature of facts.signatures) {
    if (signature === undefined) throw "surface signature fact invariant";
    if (abis.has(signature.alias))
      return failure("duplicate signature fact: " + signature.alias);
    abis.set(signature.alias, signature);
  }
  const records: {
      alias: string;
      aliases: readonly string[];
      layout: RecordLayout;
    }[] = [],
    signatures: {
      alias: string;
      aliases: readonly string[];
      function: number;
      parameters: readonly ScalarType[];
      returnType: ReturnType;
    }[] = [],
    witnesses: string[] = [];
  let recordCount = 0,
    signatureCount = 0;
  for (const group of contracts.records) {
    if (group === undefined) throw "surface record class invariant";
    const layout = layouts.get(group.alias);
    if (layout === undefined)
      return failure("missing record fact: " + group.alias);
    for (const alias of group.aliases) {
      if (alias === undefined) throw "surface record alias invariant";
      const member = layouts.get(alias);
      if (member === undefined || !sameLayout(layout, member))
        return failure("class physical skew: " + alias);
    }
    recordCount += 1 + group.aliases.length;
    records.push({
      alias: group.alias,
      aliases: group.aliases.slice(),
      layout: copyLayout(layout),
    });
  }
  for (const group of contracts.signatures) {
    if (group === undefined) throw "surface signature class invariant";
    const abi = abis.get(group.alias);
    if (abi === undefined)
      return failure("missing signature fact: " + group.alias);
    for (const alias of group.aliases) {
      if (alias === undefined) throw "surface signature alias invariant";
      const member = abis.get(alias);
      if (
        member === undefined ||
        member.returnType !== abi.returnType ||
        member.parameters.length !== abi.parameters.length ||
        !member.parameters.every(
          (parameter, index) => parameter === abi.parameters[index],
        )
      )
        return failure("class physical skew: " + alias);
    }
    signatureCount += 1 + group.aliases.length;
    let functionIndex = -1;
    for (let index = 0; index < contracts.surface.entries.length; index++) {
      const entry = contracts.surface.entries[index];
      if (entry === undefined) throw "surface helper invariant";
      const type = entry.type;
      if (
        type.kind === "named" &&
        (type.name === group.alias || group.aliases.includes(type.name))
      ) {
        functionIndex = index;
        break;
      }
    }
    if (functionIndex < 0) {
      functionIndex = contracts.surface.entries.length + witnesses.length;
      witnesses.push(group.alias);
    }
    signatures.push({
      alias: group.alias,
      aliases: group.aliases.slice(),
      function: functionIndex,
      parameters: abi.parameters.slice(),
      returnType: abi.returnType,
    });
  }
  if (recordCount !== layouts.size || signatureCount !== abis.size)
    return failure("facts contain aliases outside the surface");
  const census = planManagedSurfaceRuntimes(contracts);
  if (!census.ok) return failure(census.error);
  const runtimes = validateManagedRuntimeProviders(
    census.value,
    facts.runtimes ?? [],
  );
  if (!runtimes.ok) return failure(runtimes.error);
  const data: ManagedSurfaceDirectoryData = {
    version: managedSurfaceDirectoryVersion,
    name,
    frame,
    abi: {
      signature: nativeSignatureVersion,
      functionBrand: [
        nativeFunctionByteLength,
        nativeFunctionReferenceCount,
        nativeFunctionEnvironmentOffset,
        nativeFunctionGeneralCount,
      ],
    },
    types: serialized.value,
    runtimes: runtimes.value,
    signatures,
    records,
  };
  const digest = digestManagedSurfaceDirectory(data);
  if (!digest.ok) return digest;
  return {
    ok: true,
    value: {
      directory: { ...data, digest: digest.value },
      contracts,
      witnesses,
    },
  };
}

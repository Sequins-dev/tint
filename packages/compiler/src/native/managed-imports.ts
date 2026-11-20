import {
  nativeFunctionByteLength,
  nativeFunctionEnvironmentOffset,
  nativeFunctionReferenceCount,
  nativeFunctionGeneralCount,
  nativeSignatureVersion,
  nativeSignatureHeaderByteLength,
  nativeSignatureParameterByteLength,
  nativeSignatureVoidCode,
} from "@tint/abi/function";
import {
  nativeSignatureTypeCode,
  type NativeManagedPointerImport,
  type NativeModule,
} from "@tint/codegen/aarch64/scalar";
import type { X64Module } from "@tint/codegen/x86_64/scalar";
import { verify, type ScalarType, type RecordLayout } from "@tint/ir/scalar";

/** Trusted loader-owned capability, never derived from JavaScript input or
 * matching descriptor bytes. The owner guarantees a permanent, readable window
 * in the importing runtime's context domain. Validation does not grant ownership. */
export interface ManagedIdentityShape {
  readonly role: "function-brand" | "signature" | "record" | "function-entry";
  readonly recordLayout?: RecordLayout | undefined;
  readonly parameters: readonly ScalarType[];
  readonly returnType: ScalarType | "void" | undefined;
}
export interface ManagedIdentityBinding extends ManagedIdentityShape {
  readonly domain: number;
  readonly name: string;
  readonly contract: string;
  /** Signature/descriptor window, never executable instructions. */
  readonly address: number;
  readonly byteLength: number;
  /** Required exactly for function-entry: permanent executable code owned by the
   * trusted issuer. It is distinct from the signature window above. */
  readonly entry?: number | undefined;
}
/** Reads an exact unsigned word from a capability window; -1 means unavailable.
 * This trusted operation must not allocate in, invoke, or mutate the managed
 * runtime while its publication plan is being validated. */
export type ManagedIdentityReader = (
  address: number,
  byteLength: number,
  offset: number,
) => number;
export type ManagedPointerResolution =
  | { readonly ok: true; readonly value: { readonly code: Uint8Array } }
  | { readonly ok: false; readonly error: string };

function text(value: string): boolean {
  return value.length > 0 && !value.includes("\0");
}
function exact(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
function sameSignature(
  request: NativeManagedPointerImport,
  binding: ManagedIdentityBinding,
): boolean {
  if (
    request.returnType !== binding.returnType ||
    request.parameters.length !== binding.parameters.length
  )
    return false;
  for (let i = 0; i < request.parameters.length; i++) {
    const parameter = request.parameters[i];
    if (parameter === undefined || parameter !== binding.parameters[i])
      return false;
  }
  return true;
}
/** Storage equality is necessary but never substitutes for the loader-issued
 * versioned semantic contract. Field order, mutability and initialization tags
 * remain part of the checked view even when GC metadata would be identical. */
export function sameManagedRecordLayout(
  left: RecordLayout | undefined,
  right: RecordLayout | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const leftLayout = left,
    rightLayout = right;
  if (
    leftLayout.byteLength !== rightLayout.byteLength ||
    leftLayout.fields.length !== rightLayout.fields.length
  )
    return false;
  for (let i = 0; i < leftLayout.fields.length; i++) {
    const a = leftLayout.fields[i],
      b = rightLayout.fields[i];
    if (
      a === undefined ||
      b === undefined ||
      a.offset !== b.offset ||
      a.type !== b.type ||
      a.mutable !== b.mutable ||
      a.presenceOffset !== b.presenceOffset ||
      a.stateOffset !== b.stateOffset
    )
      return false;
  }
  return true;
}
function validRecordLayout(layout: RecordLayout | undefined): boolean {
  if (layout === undefined) return false;
  const concrete = layout;
  for (const field of concrete.fields) {
    if (field === undefined || typeof field.mutable !== "boolean") return false;
  }
  return verify({ records: [concrete], functions: [] }).ok;
}
export function managedIdentityDescriptorWords(
  binding: ManagedIdentityShape,
): readonly number[] | undefined {
  if (binding.role === "record") {
    const layout = binding.recordLayout;
    if (
      layout === undefined ||
      !validRecordLayout(layout) ||
      binding.parameters.length !== 0 ||
      binding.returnType !== undefined
    )
      return undefined;
    const concrete = layout;
    const references: number[] = [],
      general: number[] = [];
    for (const field of concrete.fields) {
      if (field === undefined) return undefined;
      if (
        [
          "primitive",
          "reference",
          "optional-reference",
          "optional-string",
          "string",
          "Uint8Array",
          "Uint16Array",
          "Uint32Array",
          "Float64Array",
        ].includes(field.type)
      )
        references.push(field.offset);
      if (field.type === "general") general.push(field.offset);
    }
    const words = [concrete.byteLength, references.length];
    for (const offset of references) {
      if (offset === undefined) return undefined;
      words.push(offset);
    }
    words.push(general.length);
    for (const offset of general) {
      if (offset === undefined) return undefined;
      words.push(offset);
    }
    return words;
  }
  if (binding.recordLayout !== undefined) return undefined;
  if (binding.role === "function-brand") {
    if (binding.parameters.length !== 0 || binding.returnType !== undefined)
      return undefined;
    // Function allocation: 48 bytes, only environment at offset 24 is traced.
    return [
      nativeFunctionByteLength,
      nativeFunctionReferenceCount,
      nativeFunctionEnvironmentOffset,
      nativeFunctionGeneralCount,
    ];
  }
  if (binding.role !== "signature" && binding.role !== "function-entry")
    return undefined;
  if (binding.returnType === undefined) return undefined;
  const result = nativeSignatureTypeCode(binding.returnType);
  if (result === undefined) return undefined;
  const words = [
    nativeSignatureVersion,
    nativeSignatureHeaderByteLength +
      binding.parameters.length * nativeSignatureParameterByteLength,
    binding.parameters.length,
    result,
  ];
  for (const parameter of binding.parameters) {
    if (parameter === undefined) return undefined;
    const code = nativeSignatureTypeCode(parameter);
    if (code === undefined || code === nativeSignatureVoidCode)
      return undefined;
    words.push(code);
  }
  return words;
}

/** Pure size planning, before addresses or domain authority have been issued.
 * Use the same descriptor vocabulary as physical pointer verification. */
export function managedIdentityByteLength(
  shape: ManagedIdentityShape,
): number | undefined {
  const words = managedIdentityDescriptorWords(shape);
  return words === undefined ? undefined : words.length * 8;
}

/** Resolve symbolic permanent metadata and authorized entry pointers into a fresh unpublished
 * image. This neither registers executable memory nor authorizes managed calls.
 * The caller must retain identity owners, register metadata, publish code and
 * establish rooted invocation separately. Entry owners guarantee permanent,
 * executable non-aliasing storage; an unpublished byte array has no load address
 * from which this resolver could prove code ownership. No partially patched
 * image escapes. */
export function resolveManagedPointers(
  native: NativeModule,
  bindings: readonly ManagedIdentityBinding[],
  readWord: ManagedIdentityReader,
  expectedDomain: number,
): ManagedPointerResolution {
  const reject = (message: string): ManagedPointerResolution => ({
    ok: false,
    error: message,
  });
  if (!exact(expectedDomain) || expectedDomain === 0)
    return reject("Expected an issued managed context domain");
  if (
    native.linkage !== "unresolved-managed" ||
    native.managedImports.length === 0
  )
    return reject("Expected an unresolved managed module");
  // Callback thunks are AOT-only: their registry range and callback key
  // are installed by image startup, never for published live code.
  if (native.callbackThunks !== undefined)
    return reject("Live code cannot contain callback thunks");
  const occupied: { offset: number; byteLength: number }[] = [];
  for (const item of native.functions) {
    if (item === undefined) return reject("Missing native functions entry");
    occupied.push({ offset: item.offset, byteLength: item.byteLength });
  }
  for (const item of native.helpers) {
    if (item === undefined) return reject("Missing native helpers entry");
    occupied.push({ offset: item.offset, byteLength: item.byteLength });
  }
  for (const item of native.cellHelpers) {
    if (item === undefined) return reject("Missing native cellHelpers entry");
    occupied.push({ offset: item.offset, byteLength: item.byteLength });
  }
  for (const item of native.strings) {
    if (item === undefined) return reject("Missing native strings entry");
    occupied.push({ offset: item.offset, byteLength: item.byteLength });
  }
  for (const item of native.signatures) {
    if (item === undefined) return reject("Missing native signatures entry");
    occupied.push({ offset: item.offset, byteLength: item.byteLength });
  }
  for (const record of native.records) {
    if (record === undefined) return reject("Missing native record descriptor");
    occupied.push({
      offset: record.offset,
      byteLength:
        24 +
        8 * (record.referenceOffsets.length + record.generalOffsets.length),
    });
  }
  const localBrand = native.functionDescriptor;
  if (localBrand !== undefined)
    occupied.push({
      offset: localBrand.offset,
      byteLength:
        24 +
        8 *
          (localBrand.referenceOffsets.length +
            localBrand.generalOffsets.length),
    });
  for (const table of native.stackMaps) {
    if (table === undefined) return reject("Missing native stack map table");
    occupied.push({ offset: table.tableOffset, byteLength: table.byteLength });
  }
  return resolveManagedSlots(
    native.code,
    native.managedImports,
    native.functionDescriptorImport,
    native.functionDescriptor !== undefined,
    occupied,
    bindings,
    readWord,
    expectedDomain,
  );
}

export function resolveX64ManagedPointers(
  native: X64Module,
  bindings: readonly ManagedIdentityBinding[],
  readWord: ManagedIdentityReader,
  expectedDomain: number,
): ManagedPointerResolution {
  const reject = (message: string): ManagedPointerResolution => ({
    ok: false,
    error: message,
  });
  if (!exact(expectedDomain) || expectedDomain === 0)
    return reject("Expected an issued managed context domain");
  const slot = native.liveSlotOffset;
  if (
    slot === undefined ||
    !exact(slot) ||
    slot % 8 !== 0 ||
    native.managedFixups.length !== 0 ||
    native.addressFixups.length !== 0 ||
    native.callbackKeyOffset !== undefined ||
    native.hostedThreadFixups.length !== 0
  )
    return reject("Expected an unresolved managed module");
  const imports = native.managedImports;
  const end = slot + imports.length * 8;
  if (end > native.code.length)
    return reject("Invalid or overlapping managed pointer slot");
  for (let index = 0; index < imports.length; index++)
    if (imports[index]?.offset !== slot + index * 8)
      return reject("Invalid or overlapping managed pointer slot");
  const occupied = [
    { offset: 0, byteLength: slot },
    { offset: end, byteLength: native.code.length - end },
  ];
  for (const item of native.unwind) {
    if (item === undefined) return reject("Missing native unwind entry");
    occupied.push({ offset: item.offset, byteLength: item.byteLength });
  }
  const brand = imports.find(
    (item) => item !== undefined && item.role === "function-brand",
  );
  return resolveManagedSlots(
    native.code,
    imports,
    brand,
    native.functionDescriptor !== undefined,
    occupied,
    bindings,
    readWord,
    expectedDomain,
  );
}

function resolveManagedSlots(
  unlinked: Uint8Array,
  imports: readonly NativeManagedPointerImport[],
  brand: NativeManagedPointerImport | undefined,
  localBrand: boolean,
  occupied: readonly { readonly offset: number; readonly byteLength: number }[],
  bindings: readonly ManagedIdentityBinding[],
  readWord: ManagedIdentityReader,
  expectedDomain: number,
): ManagedPointerResolution {
  const reject = (message: string): ManagedPointerResolution => ({
    ok: false,
    error: message,
  });
  const needsBrand = imports.some(
    (request) =>
      request !== undefined &&
      (request.role === "function-brand" || request.role === "signature"),
  );
  if (brand === undefined) {
    if (needsBrand)
      return reject("Missing or inconsistent imported function brand");
  } else if (
    localBrand ||
    brand.role !== "function-brand" ||
    brand.witness !== undefined ||
    brand.returnType !== undefined ||
    brand.parameters.length !== 0
  )
    return reject("Missing or inconsistent imported function brand");
  let brandCount = 0;
  const names = new Set<string>(),
    offsets = new Set<number>();
  // Complete structural validation precedes any reads of external identities.
  for (const request of imports) {
    if (request === undefined) return reject("Missing managed import");
    if (request.role === "function-brand") {
      brandCount++;
      if (brand === undefined) return reject("Missing imported function brand");
      if (
        request.name !== brand.name ||
        request.contract !== brand.contract ||
        request.offset !== brand.offset ||
        request.witness !== undefined ||
        request.parameters.length !== 0 ||
        request.returnType !== undefined ||
        request.recordLayout !== undefined
      )
        return reject("Inconsistent imported function-brand role");
    } else if (request.role === "record") {
      if (
        request.witness === undefined ||
        !exact(request.witness) ||
        request.parameters.length !== 0 ||
        request.returnType !== undefined ||
        !validRecordLayout(request.recordLayout)
      )
        return reject("Invalid imported record role");
    } else if (
      request.recordLayout !== undefined ||
      (request.role !== "signature" && request.role !== "function-entry") ||
      request.witness === undefined ||
      !exact(request.witness) ||
      request.returnType === undefined
    ) {
      return reject("Invalid imported signature role");
    }
    if (
      !text(request.name) ||
      !text(request.contract) ||
      names.has(request.name)
    )
      return reject("Invalid or duplicate managed import name");
    names.add(request.name);
    if (
      !exact(request.offset) ||
      request.offset % 8 !== 0 ||
      request.byteLength !== 8 ||
      request.offset > unlinked.length - 8 ||
      offsets.has(request.offset)
    )
      return reject("Invalid or overlapping managed pointer slot");
    offsets.add(request.offset);
    for (let i = 0; i < 8; i++)
      if (unlinked[request.offset + i] !== 0)
        return reject("Managed pointer slot is already initialized");
    for (const fn of occupied) {
      if (fn === undefined) return reject("Missing native function");
      if (
        request.offset < fn.offset + fn.byteLength &&
        fn.offset < request.offset + 8
      )
        return reject("Managed pointer slot overlaps native code or metadata");
    }
  }
  if (brandCount !== (brand === undefined ? 0 : 1))
    return reject("Inconsistent imported function brand count");
  if (bindings.length !== imports.length)
    return reject("Managed identity binding count differs");
  const authorized = new Map<string, ManagedIdentityBinding>();
  for (const binding of bindings) {
    if (binding === undefined)
      return reject("Missing managed identity binding");
    if (binding.domain !== expectedDomain)
      return reject("Managed identity belongs to a different context domain");
    if (
      !text(binding.name) ||
      !text(binding.contract) ||
      authorized.has(binding.name)
    )
      return reject("Invalid or duplicate managed identity binding");
    if (
      !exact(binding.address) ||
      binding.address === 0 ||
      binding.address % 8 !== 0 ||
      !exact(binding.byteLength) ||
      binding.byteLength > Number.MAX_SAFE_INTEGER - binding.address
    )
      return reject("Invalid permanent managed identity window");
    const entry = binding.entry;
    if (binding.role === "function-entry") {
      if (
        entry === undefined ||
        !exact(entry) ||
        entry === 0 ||
        entry % 4 !== 0
      )
        return reject("Invalid permanent function entry");
    } else if (entry !== undefined)
      return reject("Unexpected code entry on metadata identity");
    authorized.set(binding.name, binding);
  }
  const plans: {
    readonly binding: ManagedIdentityBinding;
    readonly words: readonly number[];
  }[] = [];
  try {
    // Validate the complete authority set before dereferencing any external
    // identity. An earlier valid import does not authorize reads when a later
    // contract, physical signature or descriptor extent is inconsistent.
    for (const request of imports) {
      if (request === undefined) return reject("Missing managed import");
      const binding = authorized.get(request.name);
      if (
        binding === undefined ||
        binding.role !== request.role ||
        binding.contract !== request.contract ||
        !sameSignature(request, binding) ||
        !sameManagedRecordLayout(request.recordLayout, binding.recordLayout)
      )
        return reject("Managed identity contract differs");
      const words = managedIdentityDescriptorWords(binding);
      if (words === undefined || binding.byteLength !== words.length * 8)
        return reject("Invalid managed identity descriptor size");
      plans.push({ binding, words });
    }
    for (const plan of plans) {
      if (plan === undefined) throw "managed identity plan invariant";
      const binding = plan.binding,
        words = plan.words;
      for (let i = 0; i < words.length; i++) {
        const expected = words[i];
        if (
          expected === undefined ||
          readWord(binding.address, binding.byteLength, i * 8) !== expected
        )
          return reject("Managed identity descriptor differs");
      }
    }
  } catch {
    return reject("Managed identity descriptor is unreadable");
  }
  const code = unlinked.slice();
  for (const request of imports) {
    if (request === undefined) throw "managed pointer import invariant";
    const binding = authorized.get(request.name);
    if (binding === undefined) throw "managed pointer binding invariant";
    const pointer =
      binding.role === "function-entry" ? binding.entry : binding.address;
    if (pointer === undefined) throw "managed entry plan invariant";
    let word: number = pointer;
    for (let i = 0; i < 8; i++) {
      code[request.offset + i] = word % 256;
      word = Math.floor(word / 256);
    }
  }
  return { ok: true, value: { code } };
}

import type { NativeModule } from "@tint/codegen/aarch64/scalar";
import {
  encode,
  relativeAddress,
  writeInstruction,
} from "@tint/codegen/aarch64/isa";
import {
  managedIdentityDescriptorWords,
  sameManagedRecordLayout,
  type ManagedIdentityShape,
} from "./managed-imports.ts";

/** Compiler-issued semantic binding into this host module, never a runtime
 * pointer capability. Ownership is checked against its native metadata census. */
export interface NativeServiceBinding extends ManagedIdentityShape {
  readonly name: string;
  readonly contract: string;
  /** Omitted for host-owned metadata; otherwise indexes the supplied units. */
  readonly unit?: number;
  readonly metadataOffset: number;
  readonly entryOffset?: number;
}
export interface NativeServiceLink {
  readonly native: NativeModule;
  readonly bindings: readonly NativeServiceBinding[];
}
export type NativeServiceLinking =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: {
        readonly native: NativeModule;
        readonly offsets: readonly number[];
      };
    };
function uint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
function word(bytes: Uint8Array, offset: number, width: number = 8): number {
  let value = 0;
  for (let i = width - 1; i >= 0; i--) {
    const byte = bytes[offset + i];
    if (byte === undefined) return -1;
    value = value * 256 + byte;
  }
  return value;
}
function owns(host: NativeModule, binding: NativeServiceBinding): boolean {
  if (!uint(binding.metadataOffset) || binding.metadataOffset % 8 !== 0)
    return false;
  if (binding.role === "record" || binding.role === "function-brand") {
    if (binding.entryOffset !== undefined) return false;
    if (binding.role === "record")
      return host.records.some(
        (r) => r !== undefined && r.offset === binding.metadataOffset,
      );
    return host.functionDescriptor?.offset === binding.metadataOffset;
  }
  const signature = host.signatures.find(
    (s) => s !== undefined && s.offset === binding.metadataOffset,
  );
  if (
    signature === undefined ||
    signature.returnType !== binding.returnType ||
    signature.parameters.length !== binding.parameters.length ||
    signature.parameters.some((p, i) => p !== binding.parameters[i])
  )
    return false;
  if (binding.role === "signature") return binding.entryOffset === undefined;
  return host.functions.some(
    (f) =>
      f !== undefined &&
      f.import !== true &&
      f.byteLength > 0 &&
      f.offset === binding.entryOffset &&
      signature.functions.includes(f.id),
  );
}
/** Preflight the entire set, then compose unpublished position-independent code.
 * Permanent data stays in the final image's existing permanent extent; root
 * frames and instance references retain the ordinary managed ABI. No context
 * identity, live heap object, executable mapping or system linker is involved. */
export function linkNativeServiceModules(
  host: NativeModule,
  units: readonly NativeServiceLink[],
  hostBindings: readonly NativeServiceBinding[] = [],
): NativeServiceLinking {
  const reject = (error: string): NativeServiceLinking => ({
    ok: false,
    error: "native service: " + error,
  });
  const all: NativeServiceLink[] = [];
  all.push({ native: host, bindings: hostBindings });
  for (const unit of units) all.push(unit);
  const offsets: number[] = [0],
    targets: Map<string, NativeServiceBinding>[] = [];
  let length = host.code.length;
  for (const unit of units) {
    if (unit === undefined) return reject("missing unit");
    const base = Math.ceil(length / 16) * 16;
    offsets.push(base);
    length = base + unit.native.code.length;
    if (!uint(length)) return reject("composed image exceeds address domain");
  }
  function owner(binding: NativeServiceBinding): NativeServiceLink | undefined {
    if (binding.unit === undefined) return all[0];
    return uint(binding.unit) ? all[binding.unit + 1] : undefined;
  }
  function ownerBase(binding: NativeServiceBinding): number | undefined {
    return offsets[binding.unit === undefined ? 0 : binding.unit + 1];
  }
  for (let index = 0; index < all.length; index++) {
    const unit = all[index];
    if (unit === undefined) return reject("missing unit");
    const native = unit.native;
    if (index !== 0 && native.imports.length !== 0)
      return reject("unit has unresolved platform imports");
    if (
      (native.linearAllocation === true && host.linearAllocation !== true) ||
      (native.generationalBarriers === true) !==
        (host.generationalBarriers === true)
    )
      return reject("unit allocation policy differs");
    const bindings = new Map<string, NativeServiceBinding>();
    for (const binding of unit.bindings) {
      const source = binding === undefined ? undefined : owner(binding);
      if (
        binding === undefined ||
        binding.name.length === 0 ||
        binding.name.includes("\0") ||
        bindings.has(binding.name) ||
        source === undefined ||
        !owns(source.native, binding)
      )
        return reject("binding is not owned by this host");
      bindings.set(binding.name, binding);
    }
    if (bindings.size !== native.managedImports.length)
      return reject("binding count differs");
    const slots = new Set<number>(),
      names = new Set<string>();
    for (const imported of native.managedImports) {
      if (imported === undefined) return reject("missing import");
      const binding = bindings.get(imported.name);
      if (
        binding === undefined ||
        names.has(imported.name) ||
        binding.contract !== imported.contract ||
        binding.role !== imported.role ||
        binding.returnType !== imported.returnType ||
        binding.parameters.length !== imported.parameters.length ||
        binding.parameters.some((p, i) => p !== imported.parameters[i]) ||
        !sameManagedRecordLayout(binding.recordLayout, imported.recordLayout)
      )
        return reject("import contract differs");
      names.add(imported.name);
      if (
        !uint(imported.offset) ||
        imported.offset % 8 !== 0 ||
        imported.byteLength !== 8 ||
        imported.offset > native.code.length - 8 ||
        slots.has(imported.offset) ||
        word(native.code, imported.offset) !== 0
      )
        return reject("invalid managed import slot");
      slots.add(imported.offset);
      if (managedIdentityDescriptorWords(binding) === undefined)
        return reject("invalid binding descriptor");
    }
    if (
      native.managedImports.length !== 0 &&
      (native.linkage !== "unresolved-managed" ||
        native.managedReferences === undefined)
    )
      return reject("unit lacks managed relocation metadata");
    const windows = new Set<number>();
    for (const reference of native.managedReferences ?? []) {
      if (
        reference === undefined ||
        !uint(reference.offset) ||
        reference.offset % 4 !== 0 ||
        reference.offset > native.code.length - 20 ||
        !uint(reference.rd) ||
        reference.rd >= 31 ||
        reference.rd === 17 ||
        !uint(reference.import)
      )
        return reject("invalid managed reference");
      const imported = native.managedImports[reference.import];
      if (imported === undefined)
        return reject("unknown managed reference import");
      const sequence = relativeAddress(
        reference.rd,
        17,
        imported.offset - reference.offset,
      );
      const load = encode({
        op: "ldr",
        width: 64,
        rt: reference.rd,
        rn: reference.rd,
        offset: 0,
      });
      if (!sequence.ok || !load.ok)
        return reject("invalid pointer instruction");
      for (let i = 0; i < 5; i++) {
        const offset = reference.offset + i * 4;
        if (windows.has(offset))
          return reject("overlapping managed references");
        windows.add(offset);
        const instruction = i === 4 ? undefined : sequence.value[i];
        const expected = instruction === undefined ? load : encode(instruction);
        if (!expected.ok || word(native.code, offset, 4) !== expected.value)
          return reject("managed reference bytes differ");
      }
      if (
        !native.functions.some(
          (f) =>
            f !== undefined &&
            f.import !== true &&
            reference.offset >= f.offset &&
            reference.offset + 20 <= f.offset + f.byteLength,
        )
      )
        return reject("managed reference is outside native code");
    }
    targets.push(bindings);
  }
  // All authority and range checks precede the first metadata byte read.
  for (const bindings of targets)
    for (const binding of bindings.values()) {
      const source = owner(binding);
      if (source === undefined) throw "service identity owner invariant";
      const words = managedIdentityDescriptorWords(binding);
      if (words === undefined) return reject("invalid descriptor");
      for (let i = 0; i < words.length; i++)
        if (
          word(source.native.code, binding.metadataOffset + i * 8) !== words[i]
        )
          return reject("host descriptor bytes differ");
    }
  const code = new Uint8Array(length);
  code.set(host.code);
  const functions = host.functions.slice(),
    records = host.records.slice(),
    roots = host.roots.slice(),
    strings = host.strings.slice(),
    signatures = host.signatures.slice(),
    helpers = host.helpers.slice(),
    cellHelpers = host.cellHelpers.slice(),
    sourceRanges = host.sourceRanges.slice();
  for (let index = 0; index < all.length; index++) {
    const unit = all[index],
      base = offsets[index],
      bindings = targets[index];
    if (unit === undefined || base === undefined || bindings === undefined)
      throw "service placement invariant";
    const native = unit.native,
      functionBase = functions.length,
      recordBase = records.length;
    code.set(native.code, base);
    for (const reference of native.managedReferences ?? []) {
      if (reference === undefined) throw "service reference invariant";
      const imported = native.managedImports[reference.import],
        binding =
          imported === undefined ? undefined : bindings.get(imported.name);
      if (binding === undefined) throw "service binding invariant";
      const target =
        binding.role === "function-entry"
          ? binding.entryOffset
          : binding.metadataOffset;
      if (target === undefined) throw "service target invariant";
      const patched = relativeAddress(
        reference.rd,
        17,
        (ownerBase(binding) ?? -length) + target - base - reference.offset,
      );
      if (!patched.ok) return reject("relative address exceeds target range");
      for (let i = 0; i < 4; i++) {
        const instruction = patched.value[i];
        if (
          instruction === undefined ||
          !writeInstruction(code, base + reference.offset + i * 4, instruction)
            .ok
        )
          return reject("cannot relocate managed address");
      }
      if (
        !writeInstruction(code, base + reference.offset + 16, { op: "nop" }).ok
      )
        return reject("cannot replace pointer load");
    }
    if (index === 0) continue;
    for (const fn of native.functions) {
      if (fn === undefined) throw "service function invariant";
      const frame = fn.debugFrame;
      functions.push({
        ...fn,
        id: functionBase + fn.id,
        offset: fn.import === true ? fn.offset : base + fn.offset,
        ...(frame === undefined
          ? {}
          : {
              debugFrame: {
                ...frame,
                ranges: frame.ranges.map((r) => ({
                  ...r,
                  offset: base + r.offset,
                })),
              },
            }),
      });
    }
    for (const record of native.records) {
      if (record === undefined) throw "service record invariant";
      records.push({
        ...record,
        record: recordBase + record.record,
        offset: base + record.offset,
      });
    }
    for (const root of native.roots) {
      if (root === undefined) throw "service root invariant";
      roots.push({
        ...root,
        function: functionBase + root.function,
        descriptorOffset: base + root.descriptorOffset,
      });
    }
    for (const string of native.strings) {
      if (string === undefined) throw "service string invariant";
      strings.push({ ...string, offset: base + string.offset });
    }
    for (const signature of native.signatures) {
      if (signature === undefined) throw "service signature invariant";
      signatures.push({
        ...signature,
        functions: signature.functions.map((id) => functionBase + id),
        offset: base + signature.offset,
      });
    }
    for (const helper of native.helpers) {
      if (helper === undefined) throw "service helper invariant";
      helpers.push({ ...helper, offset: base + helper.offset });
    }
    for (const helper of native.cellHelpers) {
      if (helper === undefined) throw "service cell invariant";
      cellHelpers.push({ ...helper, offset: base + helper.offset });
    }
    for (const range of native.sourceRanges) {
      if (range === undefined) throw "service source invariant";
      sourceRanges.push({
        ...range,
        function: functionBase + range.function,
        offset: base + range.offset,
      });
    }
  }
  return {
    ok: true,
    value: {
      native: {
        ...host,
        linkage: "local",
        managedImports: [],
        managedReferences: [],
        functionDescriptorImport: undefined,
        code,
        functions,
        records,
        roots,
        strings,
        signatures,
        helpers,
        cellHelpers,
        sourceRanges,
      },
      offsets: offsets.slice(1),
    },
  };
}

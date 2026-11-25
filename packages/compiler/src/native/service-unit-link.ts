import {
  contiguousCodeOutput,
  type CodePlan,
  type ImageAddressPatcher,
  type ImageAddressReference,
} from "@tint/abi/relocation";
import type {
  NativeModule,
  NativeManagedPointerImport,
} from "@tint/codegen/aarch64/scalar";
import { encodeLayout, patchRelative } from "@tint/codegen/x86_64/isa";
import {
  x64ModulePatcher,
  type X64Module,
  type X64ManagedReference,
} from "@tint/codegen/x86_64/scalar";
import type { ScalarType } from "@tint/ir/scalar";
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
interface NativeServiceBindingIndex {
  readonly byName: Map<string, NativeServiceBinding>;
}
export interface NativeServiceLink {
  readonly native: NativeModule;
  readonly bindings: readonly NativeServiceBinding[];
}
type NativeServicePlanning =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly value: {
        readonly native: NativeModule;
        readonly offsets: readonly number[];
        readonly codePlan: CodePlan;
      };
    };
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
interface ServiceIdentityOwner {
  readonly records: readonly { readonly offset: number }[];
  readonly functionDescriptor?: { readonly offset: number } | undefined;
  readonly signatures: readonly {
    readonly offset: number;
    readonly returnType: ScalarType | "void";
    readonly parameters: readonly ScalarType[];
    readonly functions: readonly number[];
  }[];
  readonly functions: readonly {
    readonly id: number;
    readonly offset: number;
    readonly byteLength: number;
    readonly import?: true;
  }[];
}
function owns(
  host: ServiceIdentityOwner,
  binding: NativeServiceBinding,
): boolean {
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

function matchesImport(
  binding: NativeServiceBinding,
  imported: NativeManagedPointerImport,
): boolean {
  return (
    binding.contract === imported.contract &&
    binding.role === imported.role &&
    binding.returnType === imported.returnType &&
    binding.parameters.length === imported.parameters.length &&
    !binding.parameters.some((p, i) => p !== imported.parameters[i]) &&
    sameManagedRecordLayout(binding.recordLayout, imported.recordLayout)
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
  const planned = planNativeServiceModules(host, units, hostBindings);
  if (!planned.ok) return planned;
  const plan = planned.value.codePlan;
  const code = new Uint8Array(plan.byteLength);
  const error = plan.write(contiguousCodeOutput(code, 0), 0);
  if (error !== undefined) return { ok: false, error };
  return {
    ok: true,
    value: {
      native: { ...planned.value.native, code },
      offsets: planned.value.offsets,
    },
  };
}

/** Resolve declarations and placement, then write each module into its final
 * hosted range. The returned native module carries the composed metadata. */
export function planNativeServiceModules(
  host: NativeModule,
  units: readonly NativeServiceLink[],
  hostBindings: readonly NativeServiceBinding[],
): NativeServicePlanning {
  const reject = (error: string): NativeServicePlanning => ({
    ok: false,
    error: "native service: " + error,
  });
  const all: NativeServiceLink[] = [];
  all.push({ native: host, bindings: hostBindings });
  for (const unit of units) {
    if (unit === undefined) return reject("missing unit");
    all.push(unit);
  }
  const offsets: number[] = [0],
    targets: NativeServiceBindingIndex[] = [];
  let length = host.code.length;
  for (const unit of units) {
    if (unit === undefined) return reject("missing unit");
    const base = Math.ceil(length / 16) * 16;
    offsets.push(base);
    length = base + unit.native.code.length;
    if (!uint(length)) return reject("composed image exceeds address domain");
  }
  function owner(binding: NativeServiceBinding): NativeServiceLink | undefined {
    const index = binding.unit;
    if (index === undefined) return all[0];
    return uint(index) ? all[index + 1] : undefined;
  }
  function ownerBase(binding: NativeServiceBinding): number | undefined {
    const index = binding.unit;
    return offsets[index === undefined ? 0 : index + 1];
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
        !matchesImport(binding, imported)
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
        !uint(reference.import) ||
        reference.compact === true
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
    targets.push({ byName: bindings });
  }
  // All authority and range checks precede the first metadata byte read.
  for (const unit of all) {
    if (unit === undefined) throw "service target unit invariant";
    for (const binding of unit.bindings) {
      if (binding === undefined) throw "service target binding invariant";
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
  }
  const patches: { offset: number; bytes: Uint8Array }[] = [];
  const functions = host.functions.slice(),
    records = host.records.slice(),
    stackMaps = host.stackMaps.slice(),
    strings = host.strings.slice(),
    signatures = host.signatures.slice(),
    helpers = host.helpers.slice(),
    cellHelpers = host.cellHelpers.slice(),
    sourceRanges = host.sourceRanges.slice();
  for (let index = 0; index < all.length; index++) {
    const unit = all[index],
      base = offsets[index],
      targetIndex = targets[index];
    const bindings = targetIndex?.byName;
    if (unit === undefined || base === undefined || bindings === undefined)
      throw "service placement invariant";
    const native = unit.native,
      functionBase = functions.length,
      recordBase = records.length;
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
      const bytes = new Uint8Array(20);
      for (let i = 0; i < 4; i++) {
        const instruction = patched.value[i];
        if (
          instruction === undefined ||
          !writeInstruction(bytes, i * 4, instruction).ok
        )
          return reject("cannot relocate managed address");
      }
      if (!writeInstruction(bytes, 16, { op: "nop" }).ok)
        return reject("cannot replace pointer load");
      patches.push({ offset: base + reference.offset, bytes });
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
    // Each unit keeps its own safepoint table over its own code range.
    for (const table of native.stackMaps) {
      if (table === undefined) throw "service stack map invariant";
      stackMaps.push({
        ...table,
        codeOffset: base + table.codeOffset,
        tableOffset: base + table.tableOffset,
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
        functions,
        records,
        stackMaps,
        strings,
        signatures,
        helpers,
        cellHelpers,
        sourceRanges,
      },
      offsets: offsets.slice(1),
      codePlan: {
        byteLength: length,
        write: (output, base) => {
          for (let index = 0; index < all.length; index++) {
            const unit = all[index];
            const offset = offsets[index];
            if (unit === undefined || offset === undefined)
              throw "service code placement invariant";
            output.write(unit.native.code, base + offset);
          }
          for (const patch of patches) {
            if (patch === undefined) throw "service patch invariant";
            output.write(patch.bytes, base + patch.offset);
          }
          return undefined;
        },
      },
    },
  };
}

export interface X64ServiceLink {
  readonly native: X64Module;
  readonly bindings: readonly NativeServiceBinding[];
}

type X64ServicePlanning =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly native: X64Module;
      readonly codePlan: CodePlan;
    };

/** Validate the complete LEA window before replacing its relative field. */
function serviceAddress(
  native: X64Module,
  reference: X64ManagedReference,
): number | undefined {
  const fixup = reference.fixup;
  const far = fixup.byteLength === 8;
  const field = fixup.fieldOffset;
  const start = field - (far ? 9 : 3),
    rexAt = far ? field + 12 : start;
  if (!uint(start) || !uint(field)) return undefined;
  const rex = native.code[rexAt],
    modrm = native.code[rexAt + 2];
  if (rex === undefined || modrm === undefined) return undefined;
  const index = ((modrm >> 3) & 7) + ((rex & 4) << 1);
  if (index >= 14 && far) return undefined;
  const expected = encodeLayout(
    [
      {
        op: "lea",
        dst: { kind: "gpr", width: 64, index },
        src: {
          kind: "mem",
          width: 64,
          address: { kind: "rip", disp: fixup.ref },
        },
      },
    ],
    (name) => name === fixup.ref.label,
    far,
  );
  const relative = expected.externalFixups[0];
  if (
    relative === undefined ||
    relative.fieldOffset + start !== field ||
    relative.nextOffset + start !== fixup.nextOffset ||
    !native.functions.some(
      (fn) =>
        fn !== undefined &&
        fn.import !== true &&
        start >= fn.offset &&
        start + expected.bytes.length <= fn.offset + fn.byteLength,
    )
  )
    return undefined;
  for (let index = 0; index < expected.bytes.length; index++)
    if (native.code[start + index] !== expected.bytes[index]) return undefined;
  return start;
}

/** Resolve x86 service references through relative instruction windows and
 * place code directly in the final image. Writable constants and stack-map
 * coordinates follow the placement of each unit. */
export function planX64ServiceModules(
  host: X64Module,
  units: readonly X64ServiceLink[],
  hostBindings: readonly NativeServiceBinding[],
): X64ServicePlanning {
  const reject = (error: string): X64ServicePlanning => ({
    ok: false,
    error: "native service: " + error,
  });
  const all: X64ServiceLink[] = [{ native: host, bindings: hostBindings }];
  const offsets = [0],
    dataOffsets = [0];
  let codeLength = host.code.length,
    dataLength = host.data.length;
  for (const unit of units) {
    if (unit === undefined) return reject("missing unit");
    if (
      unit.native.imports.length !== 0 ||
      unit.native.hostedThreadFixups.length !== 0
    )
      return reject("unit has unresolved platform imports");
    if (
      (unit.native.linearAllocation && !host.linearAllocation) ||
      unit.native.generationalBarriers !== host.generationalBarriers
    )
      return reject("unit allocation policy differs");
    const codeBase = Math.ceil(codeLength / 16) * 16;
    const dataBase = Math.ceil(dataLength / 8) * 8;
    offsets.push(codeBase);
    dataOffsets.push(dataBase);
    codeLength = codeBase + unit.native.code.length;
    dataLength = dataBase + unit.native.data.length;
    if (!uint(codeLength) || !uint(dataLength))
      return reject("composed image exceeds address domain");
    all.push(unit);
  }

  const patches: { readonly offset: number; readonly bytes: Uint8Array }[] = [];
  const functions = host.functions.slice(),
    unwind = host.unwind.slice(),
    probes = host.probes.slice(),
    stackMaps = host.stackMaps.slice();
  const addressFixups: ImageAddressReference[] = [];
  const patchers: {
    readonly patch: ImageAddressPatcher;
    readonly index: number;
  }[] = [];
  const data = new Uint8Array(dataLength);
  for (let index = 0; index < all.length; index++) {
    const unit = all[index],
      offset = offsets[index],
      dataOffset = dataOffsets[index];
    if (unit === undefined || offset === undefined || dataOffset === undefined)
      throw "service placement invariant";
    const native = unit.native;
    const bindings = new Map<string, NativeServiceBinding>();
    for (const binding of unit.bindings) {
      if (
        binding === undefined ||
        binding.name === "" ||
        binding.name.includes("\0") ||
        bindings.has(binding.name)
      )
        return reject("invalid or duplicate binding");
      const owner = all[binding.unit === undefined ? 0 : binding.unit + 1];
      const words = managedIdentityDescriptorWords(binding);
      if (
        owner === undefined ||
        !owns(owner.native, binding) ||
        words === undefined
      )
        return reject("binding is not owned by this host");
      for (let wordIndex = 0; wordIndex < words.length; wordIndex++)
        if (
          word(owner.native.code, binding.metadataOffset + wordIndex * 8) !==
          words[wordIndex]
        )
          return reject("host descriptor bytes differ");
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
        !matchesImport(binding, imported)
      )
        return reject("import contract differs");
      const slot = imported.offset;
      if (
        !uint(slot) ||
        slot % 8 !== 0 ||
        slots.has(slot) ||
        imported.byteLength !== 8 ||
        word(native.code, slot) !== 0
      )
        return reject("invalid managed import slot");
      names.add(imported.name);
      slots.add(slot);
    }
    const windows = new Set<number>();
    for (const reference of native.managedFixups) {
      if (reference === undefined) return reject("missing reference");
      const imported = native.managedImports[reference.import];
      const binding =
        imported === undefined ? undefined : bindings.get(imported.name);
      const fixup = reference.fixup;
      const start = serviceAddress(native, reference);
      if (
        binding === undefined ||
        start === undefined ||
        fixup.ref.label !== "managed:" + String(reference.import) ||
        fixup.ref.addend !== undefined ||
        windows.has(start)
      )
        return reject("invalid managed reference");
      windows.add(start);
      const target =
        binding.role === "function-entry"
          ? binding.entryOffset
          : binding.metadataOffset;
      const owner = offsets[binding.unit === undefined ? 0 : binding.unit + 1];
      if (target === undefined || owner === undefined)
        return reject("missing target");
      const site = offset + fixup.fieldOffset;
      const bytes = new Uint8Array(fixup.byteLength);
      const status = patchRelative(bytes, fixup, 0, owner + target, site);
      if (status === "range") return reject("rel32 displacement out of range");
      if (status !== "complete") return reject("invalid managed address");
      patches.push({ offset: site, bytes });
    }
    data.set(native.data, dataOffset);
    const modulePatcher = x64ModulePatcher(native);
    for (let at = 0; at < native.addressFixups.length; at++) {
      const reference = native.addressFixups[at];
      if (reference === undefined) throw "service image reference invariant";
      const target = reference.target;
      addressFixups.push({
        ...reference,
        offset: offset + reference.offset,
        target:
          target.kind === "data"
            ? { kind: "data", offset: dataOffset + target.offset }
            : target,
      });
      patchers.push({ patch: modulePatcher, index: at });
    }
    if (index === 0) continue;
    const functionBase = functions.length;
    for (const fn of native.functions) {
      if (fn === undefined) throw "service function invariant";
      const frame = fn.frame;
      functions.push({
        ...fn,
        id: functionBase + fn.id,
        offset: fn.import === true ? 0 : offset + fn.offset,
        ...(frame === undefined
          ? {}
          : { frame: { ...frame, offset: offset + frame.offset } }),
      });
    }
    for (const range of native.unwind)
      if (range !== undefined)
        unwind.push({ ...range, offset: offset + range.offset });
    for (const probe of native.probes)
      if (probe !== undefined)
        probes.push({ ...probe, offset: offset + probe.offset });
    for (const map of native.stackMaps)
      if (map !== undefined)
        stackMaps.push({
          ...map,
          codeOffset: offset + map.codeOffset,
          tableOffset:
            map.tableOffset < 0 ? map.tableOffset : offset + map.tableOffset,
        });
  }
  const patchAddress: ImageAddressPatcher = (
    bytes,
    index,
    site,
    target,
    address,
  ) => {
    const patcher = patchers[index];
    return patcher === undefined
      ? "invalid"
      : patcher.patch(bytes, patcher.index, site, target, address);
  };
  return {
    ok: true,
    native: {
      ...host,
      data,
      functions,
      unwind,
      probes,
      stackMaps,
      addressFixups,
      patchAddress,
      managedImports: [],
      managedFixups: [],
    },
    codePlan: {
      byteLength: codeLength,
      write(output, base) {
        for (let index = 0; index < all.length; index++) {
          const unit = all[index],
            offset = offsets[index];
          if (unit === undefined || offset === undefined)
            throw "service placement invariant";
          output.write(unit.native.code, base + offset);
        }
        for (const patch of patches)
          if (patch !== undefined)
            output.write(patch.bytes, base + patch.offset);
        return undefined;
      },
    },
  };
}

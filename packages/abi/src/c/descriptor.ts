import { cLayout } from "./layout.ts";
import type {
  CFunctionDeclaration,
  CLibraryDeclaration,
} from "./declarations.ts";
import type { CScalar, CTarget, CType } from "./types.ts";
/** A runtime struct layout descriptor: the same layout computation the
 * compiler uses for direct calls, as data for dynamic consumers. */
export interface CLayoutDescriptor {
  readonly name: string;
  readonly size: number;
  readonly alignment: number;
  readonly fields: readonly CFieldDescriptor[];
}
export interface CFieldDescriptor {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
  /** A C type spelling: a scalar name, `pointer`, a record name or
   * `element[length]`. */
  readonly type: string;
}
export type CLayoutDescriptorResult =
  | { readonly ok: true; readonly value: CLayoutDescriptor }
  | { readonly ok: false; readonly error: string };
export function cTypeName(type: CType): string {
  switch (type.kind) {
    case "void":
      return "void";
    case "scalar":
      return type.scalar;
    case "pointer":
      return "pointer";
    case "record":
      return type.name;
    case "array":
      return cTypeName(type.element) + "[" + String(type.length) + "]";
  }
}
export function cLayoutDescriptor(
  type: CType,
  target: CTarget,
): CLayoutDescriptorResult {
  if (type.kind !== "record")
    return { ok: false, error: "layout descriptors describe records" };
  const layout = cLayout(type, target);
  if (!layout.ok) return layout;
  const fields: CFieldDescriptor[] = [];
  for (let index = 0; index < type.fields.length; index++) {
    const field = type.fields[index],
      offset = layout.value.offsets[index];
    if (field === undefined || offset === undefined)
      throw "descriptor field invariant";
    const member = cLayout(field.type, target);
    if (!member.ok) return member;
    fields.push({
      name: field.name,
      offset,
      size: member.value.size,
      type: cTypeName(field.type),
    });
  }
  return {
    ok: true,
    value: {
      name: type.name,
      size: layout.value.size,
      alignment: layout.value.alignment,
      fields,
    },
  };
}
/** Canonical scalar spelling for Node's public signature vocabulary. */
export type NodeFfiType = CScalar | "void" | "pointer";
export function canonicalNodeFfiType(
  name: string,
  charSigned: boolean,
): NodeFfiType | undefined {
  switch (name) {
    case "void":
      return "void";
    case "char":
      return charSigned ? "i8" : "u8";
    case "int8":
    case "i8":
      return "i8";
    case "uint8":
    case "u8":
    case "bool":
      return "u8";
    case "int16":
    case "i16":
      return "i16";
    case "uint16":
    case "u16":
      return "u16";
    case "int32":
    case "i32":
      return "i32";
    case "uint32":
    case "u32":
      return "u32";
    case "int64":
    case "i64":
      return "i64";
    case "uint64":
    case "u64":
      return "u64";
    case "float32":
    case "f32":
    case "float":
      return "f32";
    case "float64":
    case "f64":
    case "double":
      return "f64";
    case "pointer":
    case "ptr":
    case "string":
    case "str":
    case "buffer":
    case "arraybuffer":
    case "function":
      return "pointer";
    default:
      return undefined;
  }
}
/** The scalar memory codec also handles the native-endian register image. */
export function nodeFfiScalarKind(type: NodeFfiType): number {
  switch (type) {
    case "i8":
      return 0;
    case "u8":
      return 1;
    case "i16":
      return 2;
    case "u16":
      return 3;
    case "i32":
      return 4;
    case "u32":
      return 5;
    case "i64":
      return 6;
    case "pointer":
    case "u64":
      return 7;
    case "f32":
      return 8;
    case "f64":
      return 9;
    default:
      throw "FFI_SCALAR_KIND_INVARIANT";
  }
}

export function nodeFfiCType(type: NodeFfiType): CType {
  if (type === "void") return { kind: "void" };
  if (type === "pointer") return { kind: "pointer", pointee: { kind: "void" } };
  return { kind: "scalar", scalar: type };
}
export function nodeFfiSignatureKey(
  result: NodeFfiType,
  parameters: readonly NodeFfiType[],
): string {
  return result + "(" + parameters.join(",") + ")";
}

/** One `node:ffi` `dlopen` definition: `{ arguments, return }`. */
export interface NodeFfiDefinition {
  readonly name: string;
  readonly symbol: string;
  readonly arguments: readonly string[];
  readonly result: string;
}
export type NodeFfiDefinitionResult =
  | { readonly ok: true; readonly value: NodeFfiDefinition }
  | { readonly ok: false; readonly error: string };
function nodeFfiType(type: CType, form: string): string | undefined {
  if (form === "string") return "string";
  if (form === "bytes" || form === "terminated-bytes") return "buffer";
  if (form === "void") return "void";
  if (type.kind === "pointer") return "pointer";
  if (type.kind !== "scalar") return undefined;
  switch (type.scalar) {
    case "bool":
      return "bool";
    case "char":
      return "char";
    case "i8":
      return "int8";
    case "u8":
      return "uint8";
    case "i16":
      return "int16";
    case "u16":
      return "uint16";
    case "i32":
      return "int32";
    case "u32":
      return "uint32";
    case "i64":
    case "isize":
      return "int64";
    case "u64":
    case "usize":
      return "uint64";
    case "f32":
      return "float32";
    case "f64":
      return "float64";
  }
}
/** The `node:ffi` definition of a declared function. `node:ffi` has no
 * structs by value, variadics or errno capture, so those fail explicitly
 * (the dynamic `tint:ffi` path handles them; docs/native-ffi.md). */
export function nodeFfiDefinition(
  declaration: CFunctionDeclaration,
): NodeFfiDefinitionResult {
  const signature = declaration.signature;
  if (signature.fixedParameters !== signature.parameters.length)
    return {
      ok: false,
      error: declaration.name + ": node:ffi has no variadic calls",
    };
  if (signature.errno !== "none")
    return {
      ok: false,
      error: declaration.name + ": node:ffi has no errno capture",
    };
  const types: string[] = [];
  for (let index = 0; index < signature.parameters.length; index++) {
    const parameter = signature.parameters[index],
      form = declaration.parameterForms[index];
    if (parameter === undefined || form === undefined)
      throw "node:ffi parameter invariant";
    const spelled = nodeFfiType(parameter, form);
    if (spelled === undefined)
      return {
        ok: false,
        error:
          declaration.name +
          ": node:ffi cannot pass " +
          cTypeName(parameter) +
          " by value",
      };
    types.push(spelled);
  }
  const result = nodeFfiType(signature.result, declaration.resultForm);
  if (result === undefined)
    return {
      ok: false,
      error:
        declaration.name +
        ": node:ffi cannot return " +
        cTypeName(signature.result) +
        " by value",
    };
  return {
    ok: true,
    value: {
      name: declaration.name,
      symbol: declaration.symbol,
      arguments: types,
      result,
    },
  };
}
/** Runtime descriptors of a whole library: node:ffi definitions for every
 * function node:ffi can express (others listed with their reason) and a
 * layout descriptor per record. */
export interface CLibraryDescriptor {
  readonly definitions: readonly NodeFfiDefinition[];
  readonly unsupported: readonly string[];
  readonly layouts: readonly CLayoutDescriptor[];
}
export type CLibraryDescriptorResult =
  | { readonly ok: true; readonly value: CLibraryDescriptor }
  | { readonly ok: false; readonly error: string };
export function cLibraryDescriptor(
  library: CLibraryDeclaration,
  target: CTarget,
): CLibraryDescriptorResult {
  const definitions: NodeFfiDefinition[] = [],
    unsupported: string[] = [],
    layouts: CLayoutDescriptor[] = [];
  for (const declaration of library.functions) {
    if (declaration === undefined) throw "descriptor function invariant";
    const definition = nodeFfiDefinition(declaration);
    if (definition.ok) definitions.push(definition.value);
    else unsupported.push(definition.error);
  }
  for (const record of library.records) {
    if (record === undefined) throw "descriptor record invariant";
    const layout = cLayoutDescriptor(record.type, target);
    if (!layout.ok) return layout;
    layouts.push(layout.value);
  }
  return { ok: true, value: { definitions, unsupported, layouts } };
}

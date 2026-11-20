import {
  classifyCCall,
  darwinArm64CTarget,
  linuxArm64CTarget,
  type CCallLayout,
} from "@tint/abi/c";
import { classifySysVCCall, linuxX86_64CTarget } from "@tint/abi/c/sysv";
import type { CScalar, CSignature, CType } from "@tint/abi/c";
import { TARGET_AAPCS64 } from "tint:c/dl";
import {
  createCodedRuntimeError,
  getProperty,
  hasProperty,
  viewObjectValue,
  type OrdinaryObject,
  type ProgramRealmCore,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";

export type FfiObject = OrdinaryObject<ScriptPropertyKey, unknown>;
export type FfiType = CScalar | "void" | "pointer";
export interface FfiSignature {
  readonly abi: CSignature;
  readonly result: FfiType;
  readonly parameters: readonly FfiType[];
}

export function ffiError(
  core: ProgramRealmCore,
  kind: "error" | "type" | "range",
  code: string,
  message: string,
): never {
  throw createCodedRuntimeError(
    core.realm,
    core.hooks,
    kind,
    message,
    code,
    undefined,
    false,
  );
}

export function ffiString(
  core: ProgramRealmCore,
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string")
    return ffiError(
      core,
      "type",
      "ERR_INVALID_ARG_TYPE",
      label + " must be a string",
    );
  if (value.indexOf("\0") >= 0)
    return ffiError(
      core,
      "type",
      "ERR_INVALID_ARG_VALUE",
      label + " must not contain null bytes",
    );
  return value;
}

export function ffiObject(
  core: ProgramRealmCore,
  value: unknown,
  label: string,
): FfiObject {
  const object = viewObjectValue(value, core.object);
  if (object === undefined || object.internalArrayData)
    return ffiError(
      core,
      "type",
      "ERR_INVALID_ARG_TYPE",
      label + " must be an object",
    );
  return object;
}

function ffiType(
  core: ProgramRealmCore,
  name: string,
  charSigned: boolean,
): FfiType {
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
      return ffiError(
        core,
        "type",
        "ERR_INVALID_ARG_VALUE",
        "Unsupported FFI type: " + name,
      );
  }
}

function cType(type: FfiType): CType {
  if (type === "void") return { kind: "void" };
  if (type === "pointer") return { kind: "pointer", pointee: { kind: "void" } };
  return { kind: "scalar", scalar: type };
}

export function parseFfiSignature(
  core: ProgramRealmCore,
  signature: FfiObject,
  name: string,
  charSigned: boolean,
): FfiSignature {
  const hooks = core.hooks;
  const hasReturn = hasProperty<ScriptPropertyKey, unknown>(
    signature,
    "return",
  );
  const hasArguments = hasProperty<ScriptPropertyKey, unknown>(
    signature,
    "arguments",
  );
  let result: FfiType = "void";
  if (hasReturn)
    result = ffiType(
      core,
      ffiString(
        core,
        getProperty<ScriptPropertyKey, unknown>(
          signature,
          "return",
          signature,
          hooks,
        ),
        "Return value type of function " + name,
      ),
      charSigned,
    );
  const parameters: FfiType[] = [],
    abiParameters: CType[] = [];
  if (hasArguments) {
    const value = getProperty<ScriptPropertyKey, unknown>(
      signature,
      "arguments",
      signature,
      hooks,
    );
    const list = viewObjectValue(value, core.object);
    if (list === undefined || !list.internalArrayData)
      return ffiError(
        core,
        "type",
        "ERR_INVALID_ARG_TYPE",
        "Arguments list of function " + name + " must be an array",
      );
    const count = getProperty<ScriptPropertyKey, unknown>(
      list,
      "length",
      list,
      hooks,
    );
    if (typeof count !== "number") throw "FFI_SIGNATURE_ARRAY_LENGTH";
    for (let index = 0; index < count; index++) {
      const label = "Argument " + index + " of function " + name;
      const argument = getProperty<ScriptPropertyKey, unknown>(
        list,
        String(index),
        list,
        hooks,
      );
      const type = ffiType(core, ffiString(core, argument, label), charSigned);
      if (type === "void")
        return ffiError(
          core,
          "type",
          "ERR_INVALID_ARG_VALUE",
          label +
            " must not be 'void'; use an empty array for no-argument functions",
        );
      parameters.push(type);
      abiParameters.push(cType(type));
    }
  }
  const abi: CSignature = {
    parameters: abiParameters,
    result: cType(result),
    fixedParameters: abiParameters.length,
    callClass: "leaf",
    errno: "none",
  };
  return { abi, result, parameters };
}

export function sameFfiSignature(a: FfiSignature, b: FfiSignature): boolean {
  if (a.result !== b.result || a.parameters.length !== b.parameters.length)
    return false;
  for (let index = 0; index < a.parameters.length; index++)
    if (a.parameters[index] !== b.parameters[index]) return false;
  return true;
}

/** The scalar memory codec also handles the native-endian register image. */
export function scalarKind(type: FfiType): number {
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

export function classifyScalarCall(
  core: ProgramRealmCore,
  signature: FfiSignature,
): CCallLayout {
  const layout =
    TARGET_AAPCS64 === 2
      ? classifySysVCCall(signature.abi, linuxX86_64CTarget)
      : classifyCCall(
          signature.abi,
          TARGET_AAPCS64 === 0 ? darwinArm64CTarget : linuxArm64CTarget,
        );
  if (!layout.ok)
    return ffiError(core, "error", "ERR_FFI_CALL_FAILED", layout.error);
  return layout.value;
}

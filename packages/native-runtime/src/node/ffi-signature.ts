import {
  canonicalNodeFfiType,
  nodeFfiCType,
  classifyCCall,
  darwinArm64CTarget,
  linuxArm64CTarget,
  type CCallLayout,
} from "@tint/abi/c";
import { classifySysVCCall, linuxX86_64CTarget } from "@tint/abi/c/sysv";
import type { CSignature, CType, NodeFfiType } from "@tint/abi/c";
import { TARGET_AAPCS64 } from "tint:c/dl";
import {
  createCodedRuntimeError,
  getProperty,
  hasProperty,
  viewObjectValue,
  type OrdinaryObject,
  type ProgramRealmCore,
  type ScriptPropertyKey,
  objectFlagArrayData,
} from "@tint/js-runtime/objects";

export type FfiObject = OrdinaryObject<ScriptPropertyKey, unknown>;
export type FfiType = NodeFfiType;
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
  if (
    object === undefined ||
    (object.internalFlags & objectFlagArrayData) !== 0
  )
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
  const type = canonicalNodeFfiType(name, charSigned);
  if (type === undefined)
    return ffiError(
      core,
      "type",
      "ERR_INVALID_ARG_VALUE",
      "Unsupported FFI type: " + name,
    );
  return type;
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
    if (list === undefined || (list.internalFlags & objectFlagArrayData) === 0)
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
      abiParameters.push(nodeFfiCType(type));
    }
  }
  const abi: CSignature = {
    parameters: abiParameters,
    result: nodeFfiCType(result),
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

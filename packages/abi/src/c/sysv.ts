import { cLayout, type CLayout } from "./layout.ts";
import {
  cPromoteVariadic,
  cScalarBytes,
  cScalarFloat,
  cScalarSigned,
  type CSignature,
  type CTarget,
  type CType,
} from "./types.ts";
import type { CCallLayout, CPassingClass, CValueLocation } from "./classify.ts";

export const linuxX86_64CTarget: CTarget = {
  name: "linux-x86_64",
  charSigned: true,
  variadicArguments: "registers",
  stackPacking: "slots",
  narrowExtension: "caller",
  alignedPairs: "any",
  compositeAlignment: "declared",
};

/** A SysV aggregate eightbyte carried in one integer or SSE register. */
export interface CRegisterPart {
  readonly offset: number;
  readonly bytes: number;
  readonly bank: "integer" | "sse";
  readonly register: number;
}
/** SysV uses the common location fields plus per-eightbyte register assignments. */
export interface SysVValueLocation extends CValueLocation {
  readonly parts?: readonly CRegisterPart[] | undefined;
}
export interface SysVCallLayout extends CCallLayout {
  readonly arguments: readonly SysVValueLocation[];
  readonly result: SysVValueLocation;
  readonly stackAlignment: number;
  readonly vectorRegisters: number;
}
export type SysVCallLayoutResult =
  | { readonly ok: true; readonly value: SysVCallLayout }
  | { readonly ok: false; readonly error: string };

interface ValueShape {
  readonly passing: CPassingClass;
  readonly layout: CLayout;
  readonly memberBytes: number;
  readonly extend: "none" | "sign" | "zero";
}
type ShapeResult =
  | { readonly ok: true; readonly value: ValueShape }
  | { readonly ok: false; readonly error: string };

function sysVShape(type: CType, target: CTarget, result: boolean): ShapeResult {
  if (type.kind === "void") {
    if (!result) return { ok: false, error: "void is not an argument type" };
    return {
      ok: true,
      value: {
        passing: "void",
        layout: { size: 0, alignment: 1, offsets: [] },
        memberBytes: 0,
        extend: "none",
      },
    };
  }
  if (type.kind === "array")
    return {
      ok: false,
      error: "C arrays are not passed by value; pass a pointer",
    };
  const layout = cLayout(type, target);
  if (!layout.ok) return layout;
  if (type.kind === "scalar" && cScalarFloat(type.scalar))
    return {
      ok: true,
      value: {
        passing: "float",
        layout: layout.value,
        memberBytes: layout.value.size,
        extend: "none",
      },
    };
  const passing: CPassingClass =
    type.kind === "record" ? "composite" : "integer";
  const extend: "none" | "sign" | "zero" =
    type.kind === "scalar" && cScalarBytes(type.scalar) < 4
      ? cScalarSigned(type.scalar, target)
        ? "sign"
        : "zero"
      : "none";
  return {
    ok: true,
    value: { passing, layout: layout.value, memberBytes: 0, extend },
  };
}

function location(value: ValueShape, variadic: boolean): CValueLocation {
  return {
    class: value.passing,
    size: value.layout.size,
    alignment: value.layout.alignment,
    extend: value.extend,
    gp: -1,
    fp: -1,
    registers: 0,
    memberBytes: value.memberBytes,
    stackOffset: -1,
    stackBytes: 0,
    variadic,
  };
}

function roundUp(bytes: number, alignment: number): number {
  return Math.ceil(bytes / alignment) * alignment;
}

/** Merge the scalar leaves of a SysV record into its eightbytes. At this
 * point the layout has been validated, and no vector or x87 scalar types are
 * admitted by the binding type system. INTEGER takes precedence over SSE. */
function mergeEightbytes(
  type: CType,
  target: CTarget,
  offset: number,
  classes: string[],
): boolean {
  const layout = cLayout(type, target);
  if (!layout.ok || offset % layout.value.alignment !== 0) return false;
  if (type.kind === "record") {
    for (let index = 0; index < type.fields.length; index++) {
      const field = type.fields[index];
      const memberOffset = layout.value.offsets[index];
      if (field === undefined || memberOffset === undefined)
        throw "SysV field layout invariant";
      if (!mergeEightbytes(field.type, target, offset + memberOffset, classes))
        return false;
    }
    return true;
  }
  if (type.kind === "array") {
    const stride = layout.value.size / type.length;
    for (let index = 0; index < type.length; index++)
      if (
        !mergeEightbytes(type.element, target, offset + index * stride, classes)
      )
        return false;
    return true;
  }
  const word = Math.floor(offset / 8);
  if (type.kind !== "scalar" || !cScalarFloat(type.scalar))
    classes[word] = "integer";
  else if (classes[word] !== "integer") classes[word] = "sse";
  return true;
}

function sysVParts(
  type: CType,
  size: number,
  target: CTarget,
): readonly string[] | undefined {
  if (size > 16) return undefined;
  const classes: string[] = ["none", "none"];
  return mergeEightbytes(type, target, 0, classes) ? classes : undefined;
}

function sysVRegisters(
  base: CValueLocation,
  classes: readonly string[],
  gp: number,
  fp: number,
): SysVValueLocation {
  const parts: CRegisterPart[] = [];
  let firstGP = -1,
    firstFP = -1;
  for (let word = 0; word < classes.length; word++) {
    const kind = classes[word];
    const offset = word * 8;
    const bytes = Math.min(base.size - offset, 8);
    if (kind === "integer") {
      if (firstGP < 0) firstGP = gp;
      parts.push({ offset, bytes, bank: "integer", register: gp++ });
    } else if (kind === "sse") {
      if (firstFP < 0) firstFP = fp;
      parts.push({ offset, bytes, bank: "sse", register: fp++ });
    }
  }
  return {
    ...base,
    gp: firstGP,
    fp: firstFP,
    registers: parts.length,
    parts: base.class === "composite" ? parts : undefined,
  };
}

/** Classify the supported LP64 binding types for System V AMD64. */
export function classifySysVCCall(
  signature: CSignature,
  target: CTarget,
): SysVCallLayoutResult {
  if (
    !Number.isSafeInteger(signature.fixedParameters) ||
    signature.fixedParameters < 0 ||
    signature.fixedParameters > signature.parameters.length
  )
    return { ok: false, error: "invalid fixed parameter count" };
  if (signature.callClass === "may-callback")
    return {
      ok: false,
      error: "C callbacks are not supported on linux-x86_64",
    };
  const returned = sysVShape(signature.result, target, true);
  if (!returned.ok) return { ok: false, error: "result: " + returned.error };
  const ret = returned.value;
  const resultBase = location(ret, false);
  const resultClasses =
    ret.passing === "void"
      ? []
      : sysVParts(signature.result, ret.layout.size, target);
  const result: SysVValueLocation =
    resultClasses === undefined
      ? { ...resultBase, class: "indirect", gp: 0, registers: 1 }
      : sysVRegisters(resultBase, resultClasses, 0, 0);
  let gp = result.class === "indirect" ? 1 : 0,
    fp = 0,
    stack = 0,
    alignment = 16;
  const args: SysVValueLocation[] = [],
    layouts: CLayout[] = [];
  for (let index = 0; index < signature.parameters.length; index++) {
    const parameter = signature.parameters[index];
    if (parameter === undefined) throw "C parameter invariant";
    const variadic = index >= signature.fixedParameters;
    const type = variadic ? cPromoteVariadic(parameter) : parameter;
    const shaped = sysVShape(type, target, false);
    if (!shaped.ok)
      return {
        ok: false,
        error: "parameter " + String(index) + ": " + shaped.error,
      };
    const value = shaped.value,
      layout = value.layout;
    layouts.push(layout);
    const base = location(value, variadic);
    const classes = sysVParts(type, layout.size, target);
    if (classes !== undefined) {
      let integerWords = 0,
        vectorWords = 0;
      for (const kind of classes) {
        if (kind === "integer") integerWords++;
        if (kind === "sse") vectorWords++;
      }
      if (gp + integerWords <= 6 && fp + vectorWords <= 8) {
        args.push(sysVRegisters(base, classes, gp, fp));
        gp += integerWords;
        fp += vectorWords;
        continue;
      }
    }
    // A failed aggregate assignment leaves both banks available to later
    // arguments. MEMORY arguments are copied by value to the outgoing area.
    alignment = Math.max(alignment, layout.alignment);
    stack = roundUp(stack, Math.max(8, layout.alignment));
    const bytes = roundUp(layout.size, 8);
    args.push({ ...base, stackOffset: stack, stackBytes: bytes });
    stack += bytes;
  }
  return {
    ok: true,
    value: {
      arguments: args,
      result,
      stackBytes: roundUp(stack, 16),
      stackAlignment: alignment,
      vectorRegisters: fp,
      argumentLayouts: layouts,
    },
  };
}

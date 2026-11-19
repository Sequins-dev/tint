import {
  cLayout,
  cHomogeneousFloatWidth,
  cNaturalAlignment,
  type CLayout,
} from "./layout.ts";
import {
  cPromoteVariadic,
  cScalarBytes,
  cScalarFloat,
  cScalarSigned,
  type CSignature,
  type CTarget,
  type CType,
} from "./types.ts";
/** How one argument or result travels (AAPCS64 and its Apple variant).
 * - `integer`: an integer, bool or pointer scalar in one X register or stack
 *   slot; `extend` gives the caller's extension of sub-32-bit values.
 * - `float`: an f32/f64 scalar in one V register or stack slot.
 * - `composite`: a record of at most 16 bytes in `registers` consecutive X
 *   registers (or on the stack), as its memory image.
 * - `hfa`: a homogeneous float aggregate in `registers` consecutive V
 *   registers of `memberBytes` each (or on the stack as its memory image).
 * - `indirect`: a larger record passed as a pointer to a caller-owned copy
 *   (arguments), or written through the X8 result address (results). */
export type CPassingClass =
  "void" | "integer" | "float" | "composite" | "hfa" | "indirect";
/** A SysV aggregate eightbyte carried in one integer or SSE register. */
export interface CRegisterPart {
  readonly offset: number;
  readonly bytes: number;
  readonly bank: "integer" | "sse";
  readonly register: number;
}
export interface CValueLocation {
  readonly parts?: readonly CRegisterPart[] | undefined;
  readonly class: CPassingClass;
  /** The value's C size in bytes (the record size for composites). */
  readonly size: number;
  readonly alignment: number;
  readonly extend: "none" | "sign" | "zero";
  /** First X register (`integer`, `composite`, `indirect` pointer) or -1. */
  readonly gp: number;
  /** First V register (`float`, `hfa`) or -1. */
  readonly fp: number;
  /** Register count (composites: X registers; HFAs: members). */
  readonly registers: number;
  /** HFA member width (4 or 8); scalar float width; else 0. */
  readonly memberBytes: number;
  /** Byte offset in the outgoing stack area, or -1 when in registers. */
  readonly stackOffset: number;
  /** Bytes the value (or its indirect pointer) occupies on the stack. */
  readonly stackBytes: number;
  readonly variadic: boolean;
}
export interface CCallLayout {
  readonly arguments: readonly CValueLocation[];
  readonly result: CValueLocation;
  /** Outgoing stack argument bytes, rounded up to 16. */
  readonly stackBytes: number;
  /** SysV: maximum alignment of the stack area and the vector count in AL. */
  readonly stackAlignment?: number | undefined;
  readonly vectorRegisters?: number | undefined;
  /** Per-argument layouts of composite arguments (for copies). */
  readonly argumentLayouts: readonly CLayout[];
}
export type CCallLayoutResult =
  | { readonly ok: true; readonly value: CCallLayout }
  | { readonly ok: false; readonly error: string };
function roundUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
function location(
  passing: CPassingClass,
  size: number,
  alignment: number,
): CValueLocation {
  return {
    class: passing,
    size,
    alignment,
    extend: "none",
    gp: -1,
    fp: -1,
    registers: 0,
    memberBytes: 0,
    stackOffset: -1,
    stackBytes: 0,
    variadic: false,
  };
}
interface ValueShape {
  readonly passing: CPassingClass;
  readonly layout: CLayout;
  readonly memberBytes: number;
  readonly extend: "none" | "sign" | "zero";
}
type ShapeResult =
  | { readonly ok: true; readonly value: ValueShape }
  | { readonly ok: false; readonly error: string };
function shape(type: CType, target: CTarget, result: boolean): ShapeResult {
  if (type.kind === "void")
    return result
      ? {
          ok: true,
          value: {
            passing: "void",
            layout: { size: 0, alignment: 1, offsets: [] },
            memberBytes: 0,
            extend: "none",
          },
        }
      : { ok: false, error: "void is not an argument type" };
  if (type.kind === "array")
    return {
      ok: false,
      error: "C arrays are not passed by value; pass a pointer",
    };
  const layout = cLayout(type, target);
  if (!layout.ok) return layout;
  if (type.kind === "pointer")
    return {
      ok: true,
      value: {
        passing: "integer",
        layout: layout.value,
        memberBytes: 0,
        extend: "none",
      },
    };
  if (type.kind === "scalar") {
    const scalar = type.scalar,
      bytes = cScalarBytes(scalar);
    if (cScalarFloat(scalar))
      return {
        ok: true,
        value: {
          passing: "float",
          layout: layout.value,
          memberBytes: bytes,
          extend: "none",
        },
      };
    return {
      ok: true,
      value: {
        passing: "integer",
        layout: layout.value,
        memberBytes: 0,
        extend:
          bytes >= 4 ? "none" : cScalarSigned(scalar, target) ? "sign" : "zero",
      },
    };
  }
  const width =
    target.name === "linux-x86_64" ? 0 : cHomogeneousFloatWidth(type, target);
  if (width !== 0)
    return {
      ok: true,
      value: {
        passing: "hfa",
        layout: layout.value,
        memberBytes: width,
        extend: "none",
      },
    };
  return {
    ok: true,
    value: {
      passing: layout.value.size > 16 ? "indirect" : "composite",
      layout: layout.value,
      memberBytes: 0,
      extend: "none",
    },
  };
}
/** Classify a call per AAPCS64 stages A-C (with `target`'s variant rules):
 * X and V registers are allocated independently; HFAs take consecutive V
 * registers or go wholly to the stack; composites up to 16 bytes take X
 * registers or go wholly to the stack; larger composites pass a pointer to
 * a caller copy, and large results return through X8. Apple packs stack
 * arguments at natural alignment, passes variadic arguments on the stack in
 * 8-byte-aligned slots, and requires callers to extend narrow integers. */
export function classifyCCall(
  signature: CSignature,
  target: CTarget,
): CCallLayoutResult {
  if (
    !Number.isSafeInteger(signature.fixedParameters) ||
    signature.fixedParameters < 0 ||
    signature.fixedParameters > signature.parameters.length
  )
    return { ok: false, error: "invalid fixed parameter count" };
  if (target.name === "linux-x86_64") return classifySysV(signature, target);
  let ngrn = 0,
    nsrn = 0,
    nsaa = 0;
  const locations: CValueLocation[] = [],
    layouts: CLayout[] = [];
  function onStack(
    passing: CPassingClass,
    layout: CLayout,
    bytes: number,
    alignment: number,
    variadic: boolean,
    extend: "none" | "sign" | "zero",
    memberBytes: number,
  ): CValueLocation {
    const align =
      variadic || target.stackPacking === "slots"
        ? Math.max(8, alignment)
        : alignment;
    nsaa = roundUp(nsaa, align);
    const slot =
      variadic || target.stackPacking === "slots" ? roundUp(bytes, 8) : bytes;
    const placed: CValueLocation = {
      ...location(passing, layout.size, layout.alignment),
      extend,
      memberBytes,
      stackOffset: nsaa,
      stackBytes: slot,
      variadic,
    };
    nsaa += slot;
    return placed;
  }
  for (let index = 0; index < signature.parameters.length; index++) {
    const parameter = signature.parameters[index];
    if (parameter === undefined) throw "C parameter invariant";
    const variadic = index >= signature.fixedParameters;
    const type = variadic ? cPromoteVariadic(parameter) : parameter;
    const shaped = shape(type, target, false);
    if (!shaped.ok)
      return {
        ok: false,
        error: "parameter " + String(index) + ": " + shaped.error,
      };
    const value = shaped.value,
      layout = value.layout;
    layouts.push(layout);
    const stackOnly = variadic && target.variadicArguments === "stack";
    // Where composites start: AAPCS64 ignores a record's own alignment
    // attribute (its natural alignment), Apple honours it.
    const compositeAlignment =
      (value.passing === "hfa" || value.passing === "composite") &&
      target.compositeAlignment === "members"
        ? cNaturalAlignment(type, target)
        : layout.alignment;
    const base = location(value.passing, layout.size, layout.alignment);
    if (value.passing === "float") {
      if (!stackOnly && nsrn < 8) {
        locations.push({
          ...base,
          fp: nsrn++,
          registers: 1,
          memberBytes: value.memberBytes,
          variadic,
        });
        continue;
      }
      locations.push(
        onStack(
          "float",
          layout,
          layout.size,
          layout.alignment,
          variadic,
          "none",
          value.memberBytes,
        ),
      );
      continue;
    }
    if (value.passing === "hfa") {
      const members = layout.size / value.memberBytes;
      if (!stackOnly && nsrn + members <= 8) {
        locations.push({
          ...base,
          fp: nsrn,
          registers: members,
          memberBytes: value.memberBytes,
          variadic,
        });
        nsrn += members;
        continue;
      }
      // C.3: an HFA that does not fit closes the V registers.
      if (!stackOnly) nsrn = 8;
      locations.push(
        onStack(
          "hfa",
          layout,
          roundUp(layout.size, 8),
          compositeAlignment,
          variadic,
          "none",
          value.memberBytes,
        ),
      );
      continue;
    }
    if (value.passing === "integer" || value.passing === "indirect") {
      if (!stackOnly && ngrn < 8) {
        locations.push({
          ...base,
          extend: value.extend,
          gp: ngrn++,
          registers: 1,
          variadic,
        });
        continue;
      }
      // An indirect argument's pointer is an 8-byte stack value.
      const bytes = value.passing === "indirect" ? 8 : layout.size;
      locations.push(
        onStack(
          value.passing,
          layout,
          bytes,
          value.passing === "indirect" ? 8 : layout.alignment,
          variadic,
          value.extend,
          0,
        ),
      );
      continue;
    }
    // Composite of at most 16 bytes (B.5: size rounds up to 8).
    const words = roundUp(layout.size, 8) / 8;
    let first = ngrn;
    // C.8: a 16-byte-aligned composite starts at an even X register.
    if (
      target.alignedPairs === "even" &&
      compositeAlignment === 16 &&
      first % 2 === 1
    )
      first++;
    if (!stackOnly && first + words <= 8) {
      locations.push({ ...base, gp: first, registers: words, variadic });
      ngrn = first + words;
      continue;
    }
    if (!stackOnly) ngrn = 8;
    locations.push(
      onStack(
        "composite",
        layout,
        words * 8,
        Math.max(8, compositeAlignment),
        variadic,
        "none",
        0,
      ),
    );
  }
  const shapedResult = shape(signature.result, target, true);
  if (!shapedResult.ok)
    return { ok: false, error: "result: " + shapedResult.error };
  const resultShape = shapedResult.value,
    resultLayout = resultShape.layout,
    resultBase = location(
      resultShape.passing,
      resultLayout.size,
      resultLayout.alignment,
    );
  let result: CValueLocation;
  switch (resultShape.passing) {
    case "void":
      result = resultBase;
      break;
    case "integer":
      result = {
        ...resultBase,
        extend: resultShape.extend,
        gp: 0,
        registers: 1,
      };
      break;
    case "float":
      result = {
        ...resultBase,
        fp: 0,
        registers: 1,
        memberBytes: resultShape.memberBytes,
      };
      break;
    case "hfa":
      result = {
        ...resultBase,
        fp: 0,
        registers: resultLayout.size / resultShape.memberBytes,
        memberBytes: resultShape.memberBytes,
      };
      break;
    case "composite":
      result = {
        ...resultBase,
        gp: 0,
        registers: roundUp(resultLayout.size, 8) / 8,
      };
      break;
    case "indirect":
      result = { ...resultBase, gp: 8, registers: 1 };
      break;
  }
  return {
    ok: true,
    value: {
      arguments: locations,
      result,
      stackBytes: roundUp(nsaa, 16),
      argumentLayouts: layouts,
    },
  };
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
): CValueLocation {
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

function classifySysV(
  signature: CSignature,
  target: CTarget,
): CCallLayoutResult {
  if (signature.callClass === "may-callback")
    return {
      ok: false,
      error: "C callbacks are not supported on linux-x86_64",
    };
  const returned = shape(signature.result, target, true);
  if (!returned.ok) return { ok: false, error: "result: " + returned.error };
  const ret = returned.value;
  const resultBase = {
    ...location(ret.passing, ret.layout.size, ret.layout.alignment),
    memberBytes: ret.memberBytes,
    extend: ret.extend,
  };
  const resultClasses =
    ret.passing === "void"
      ? []
      : sysVParts(signature.result, ret.layout.size, target);
  const result: CValueLocation =
    resultClasses === undefined
      ? { ...resultBase, class: "indirect", gp: 0, registers: 1 }
      : sysVRegisters(resultBase, resultClasses, 0, 0);
  let gp = result.class === "indirect" ? 1 : 0,
    fp = 0,
    stack = 0,
    alignment = 16;
  const args: CValueLocation[] = [],
    layouts: CLayout[] = [];
  for (let index = 0; index < signature.parameters.length; index++) {
    const parameter = signature.parameters[index];
    if (parameter === undefined) throw "C parameter invariant";
    const variadic = index >= signature.fixedParameters;
    const type = variadic ? cPromoteVariadic(parameter) : parameter;
    const shaped = shape(type, target, false);
    if (!shaped.ok)
      return {
        ok: false,
        error: "parameter " + String(index) + ": " + shaped.error,
      };
    const value = shaped.value,
      layout = value.layout;
    layouts.push(layout);
    const passing: CPassingClass = value.passing === "indirect" ? "composite" : value.passing;
    const base: CValueLocation = {
      ...location(passing, layout.size, layout.alignment),
      memberBytes: value.memberBytes,
      extend: value.extend,
      variadic,
    };
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

import {
  cScalarBytes,
  cScalarFloat,
  type CType,
  type CTarget,
} from "./types.ts";
/** Size, alignment and (for records) member offsets of a C type. */
export interface CLayout {
  readonly size: number;
  readonly alignment: number;
  /** Record members' byte offsets in declaration order; empty otherwise. */
  readonly offsets: readonly number[];
}
export type CLayoutResult =
  | { readonly ok: true; readonly value: CLayout }
  | { readonly ok: false; readonly error: string };
function roundUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
function powerOfTwo(value: number): boolean {
  if (!Number.isSafeInteger(value) || value < 1) return false;
  let remaining = value;
  while (remaining % 2 === 0) remaining = remaining / 2;
  return remaining === 1;
}
/** The C layout of `type` on `target` (arm64 targets share the data model:
 * LP64, natural alignment equal to scalar size). Records lay members out in
 * declaration order at their alignment (1 when packed); the record aligns
 * to its largest member alignment, raised to an explicit alignment, and its
 * size rounds up to that alignment. Unions place every member at offset 0.
 * Unsupported shapes (void members, empty records, flexible or zero-length
 * arrays, non-power-of-two alignment) fail explicitly. */
export function cLayout(type: CType, target: CTarget): CLayoutResult {
  switch (type.kind) {
    case "void":
      return { ok: false, error: "void has no layout" };
    case "scalar": {
      const bytes = cScalarBytes(type.scalar);
      return {
        ok: true,
        value: { size: bytes, alignment: bytes, offsets: [] },
      };
    }
    case "pointer":
      return { ok: true, value: { size: 8, alignment: 8, offsets: [] } };
    case "array": {
      if (!Number.isSafeInteger(type.length) || type.length < 1)
        return {
          ok: false,
          error: "fixed array lengths must be positive integers",
        };
      const element = cLayout(type.element, target);
      if (!element.ok) return element;
      return {
        ok: true,
        value: {
          size: element.value.size * type.length,
          alignment: element.value.alignment,
          offsets: [],
        },
      };
    }
    case "record": {
      if (type.fields.length === 0)
        return { ok: false, error: "record " + type.name + " has no members" };
      if (type.alignment !== 0 && !powerOfTwo(type.alignment))
        return {
          ok: false,
          error: "record " + type.name + " alignment must be a power of two",
        };
      const offsets: number[] = [];
      let size = 0,
        alignment = 1;
      for (const field of type.fields) {
        if (field === undefined) throw "record field invariant";
        const member = cLayout(field.type, target);
        if (!member.ok)
          return {
            ok: false,
            error: type.name + "." + field.name + ": " + member.error,
          };
        const memberAlignment = type.packed ? 1 : member.value.alignment;
        if (memberAlignment > alignment) alignment = memberAlignment;
        if (type.union) {
          offsets.push(0);
          if (member.value.size > size) size = member.value.size;
        } else {
          const offset = roundUp(size, memberAlignment);
          offsets.push(offset);
          size = offset + member.value.size;
        }
      }
      if (type.alignment > alignment) alignment = type.alignment;
      return {
        ok: true,
        value: { size: roundUp(size, alignment), alignment, offsets },
      };
    }
  }
}
/** The homogeneous floating-point aggregate member width (4 or 8) of a
 * record or array of 1-4 equal float members after flattening, else 0.
 * AAPCS64 HFAs ignore padding-free nesting but require exact coverage. */
export function cHomogeneousFloatWidth(type: CType, target: CTarget): number {
  if (type.kind !== "record" && type.kind !== "array") return 0;
  const layout = cLayout(type, target);
  if (!layout.ok) return 0;
  const members: number[] = [];
  if (!flattenFloats(type, target, 0, members)) return 0;
  const count = members.length / 2;
  if (count < 1 || count > 4) return 0;
  const width = members[1] ?? 0;
  for (let index = 0; index < count; index++)
    if (
      members[index * 2 + 1] !== width ||
      members[index * 2] !== index * width
    )
      return 0;
  return count * width === layout.value.size ? width : 0;
}
/** Appends (offset, width) of each float leaf; false on a non-float leaf.
 * Union members must overlay the same float shape. */
function flattenFloats(
  type: CType,
  target: CTarget,
  base: number,
  out: number[],
): boolean {
  if (out.length > 8) return false;
  switch (type.kind) {
    case "scalar":
      if (!cScalarFloat(type.scalar)) return false;
      out.push(base, cScalarBytes(type.scalar));
      return true;
    case "array": {
      const element = cLayout(type.element, target);
      if (!element.ok) return false;
      for (let index = 0; index < type.length; index++)
        if (
          !flattenFloats(
            type.element,
            target,
            base + index * element.value.size,
            out,
          )
        )
          return false;
      return true;
    }
    case "record": {
      const layout = cLayout(type, target);
      if (!layout.ok) return false;
      if (type.union) {
        let shape: number[] | undefined;
        for (const field of type.fields) {
          if (field === undefined) throw "union field invariant";
          const members: number[] = [];
          if (!flattenFloats(field.type, target, base, members)) return false;
          if (shape === undefined) shape = members;
          else if (!sameNumbers(shape, members)) return false;
        }
        if (shape === undefined) return false;
        for (const word of shape) {
          if (word === undefined) throw "union shape invariant";
          out.push(word);
        }
        return true;
      }
      for (let index = 0; index < type.fields.length; index++) {
        const field = type.fields[index],
          offset = layout.value.offsets[index];
        if (field === undefined || offset === undefined)
          throw "record field invariant";
        if (!flattenFloats(field.type, target, base + offset, out))
          return false;
      }
      return true;
    }
    default:
      return false;
  }
}
function sameNumbers(
  left: readonly number[],
  right: readonly number[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++)
    if (left[index] !== right[index]) return false;
  return true;
}

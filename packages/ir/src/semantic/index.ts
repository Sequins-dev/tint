export interface TypeKnowledge {
  readonly declared: number | undefined;
  readonly variants: readonly number[] | undefined;
  readonly origin: "annotation" | "analysis" | "guard";
  readonly guard: number | undefined;
}
export interface ShortCircuit {
  readonly kind: "short-circuit";
  readonly left: number;
  readonly rightRegion: number;
  readonly test: "truthy" | "nullish";
  readonly evaluateRightWhen: boolean;
}
export interface PropertyReference {
  readonly kind: "property-reference";
  readonly base: number;
  readonly key: number;
}
export interface SemanticCall {
  readonly kind: "call";
  readonly callee: number;
  readonly receiver: number | undefined;
  readonly arguments: readonly number[];
}
export function shortCircuit(
  operator: "&&" | "||" | "??",
  left: number,
  rightRegion: number,
): ShortCircuit {
  return {
    kind: "short-circuit",
    left,
    rightRegion,
    test: operator === "??" ? "nullish" : "truthy",
    evaluateRightWhen: operator !== "||",
  };
}
export function propertyReference(
  base: number,
  key: number,
): PropertyReference {
  return { kind: "property-reference", base, key };
}
export function callReference(
  reference: PropertyReference,
  callee: number,
  args: readonly number[],
): SemanticCall {
  return { kind: "call", callee, receiver: reference.base, arguments: args };
}
/** IDs refer to the caller's semantic type table, not storage encodings.
 * Annotations are hints. Analysis must be complete; guards must dominate this
 * use and remain valid across effects. Empty/bottom sets never authorize code. */
export function representationFor(
  knowledge: TypeKnowledge,
  activeGuards: readonly number[],
): "dynamic" | "fixed" | "tagged-union" {
  const variants = knowledge.variants;
  if (
    knowledge.origin === "annotation" ||
    variants === undefined ||
    variants.length === 0
  )
    return "dynamic";
  if (
    knowledge.origin === "guard" &&
    (knowledge.guard === undefined || !activeGuards.includes(knowledge.guard))
  )
    return "dynamic";
  for (const variant of variants)
    if (variant === undefined || !Number.isSafeInteger(variant) || variant < 0)
      return "dynamic";
  return variants.length === 1 ? "fixed" : "tagged-union";
}
export function callValue(
  callee: number,
  args: readonly number[],
): SemanticCall {
  return { kind: "call", callee, receiver: undefined, arguments: args };
}
/** Reference construction consumes evaluated base and key handles. Conversion
 * of an arbitrary JS key belongs to an explicit ToPropertyKey operation. */
export type SemanticOperation =
  | ShortCircuit
  | PropertyReference
  | SemanticCall
  | { readonly kind: "read-reference"; readonly reference: number }
  | {
      readonly kind: "write-reference";
      readonly reference: number;
      readonly value: number;
    }
  | {
      readonly kind: "coerce";
      readonly operation:
        "ToPrimitive" | "ToNumeric" | "ToString" | "ToPropertyKey";
      readonly value: number;
    };

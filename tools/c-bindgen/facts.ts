// What clang reports about one spec's declarations on one target
// (docs/native-ffi.md, "Binding generator"). Extraction writes these facts
// on a host of the target; emission merges every target's facts into one
// declaration module, so a module serving Darwin and Linux is regenerated
// from checked-in facts on either host.
import {
  cLayout,
  type CField,
  type CScalar,
  type CTarget,
  type CType,
} from "@tint/abi/c";

/** A C type as the headers spell it, reduced to what bindings can say.
 * `aliases` lists the typedef names a scalar was reached through,
 * outermost first. A record reference names a record; only records in
 * `TargetFacts.records` are emitted (others are opaque pointees). */
export type TypeFact =
  | { readonly kind: "void" }
  | {
      readonly kind: "scalar";
      readonly scalar: CScalar;
      readonly aliases: readonly string[];
    }
  | {
      readonly kind: "pointer";
      readonly pointee: TypeFact;
      readonly constPointee: boolean;
    }
  | { readonly kind: "record"; readonly name: string }
  | {
      readonly kind: "array";
      readonly element: TypeFact;
      readonly length: number;
    }
  | { readonly kind: "function" }
  | { readonly kind: "unsupported"; readonly reason: string };

export interface FieldFact {
  readonly name: string;
  readonly type: TypeFact;
  readonly offset: number;
}
/** A struct or union whose layout clang confirmed: `c` spells its type in
 * C (for the layout oracle); `size`, `align` and the offsets are clang's. */
export interface RecordFact {
  readonly name: string;
  readonly c: string;
  readonly union: boolean;
  readonly packed: boolean;
  /** The record's own `aligned` attribute (clang's alignment), else 0. */
  readonly alignment: number;
  readonly size: number;
  readonly align: number;
  readonly fields: readonly FieldFact[];
}
export interface ParameterFact {
  readonly name: string;
  readonly type: TypeFact;
}
export interface FunctionFact {
  readonly name: string;
  readonly parameters: readonly ParameterFact[];
  readonly result: TypeFact;
  readonly variadic: boolean;
}
/** An integer constant's exact value (decimal; may be negative or beyond
 * 2^53, which emission reports). */
export interface ConstantFact {
  readonly name: string;
  readonly value: string;
}
export interface NamedTypeFact {
  readonly name: string;
  readonly type: TypeFact;
}
/** A selected declaration extraction could not represent, and why. */
export interface SkippedFact {
  readonly name: string;
  readonly reason: string;
}
export interface TargetFacts {
  readonly spec: string;
  readonly target: string;
  readonly clang: string;
  readonly aliases: readonly NamedTypeFact[];
  /** Type spellings the spec names (variadic argument types). */
  readonly types: readonly NamedTypeFact[];
  readonly records: readonly RecordFact[];
  readonly functions: readonly FunctionFact[];
  readonly constants: readonly ConstantFact[];
  readonly skipped: readonly SkippedFact[];
}

/** The C type a fact describes, for layout. Pointers are opaque (their
 * pointee never affects a layout); undefined for function and unsupported
 * types and records without facts. */
export function cTypeOfFact(
  fact: TypeFact,
  records: ReadonlyMap<string, RecordFact>,
): CType | undefined {
  switch (fact.kind) {
    case "void":
      return { kind: "void" };
    case "scalar":
      return { kind: "scalar", scalar: fact.scalar };
    case "pointer":
      return { kind: "pointer", pointee: { kind: "void" } };
    case "array": {
      const element = cTypeOfFact(fact.element, records);
      return element === undefined
        ? undefined
        : { kind: "array", element, length: fact.length };
    }
    case "record": {
      const record = records.get(fact.name);
      if (record === undefined) return undefined;
      const fields: CField[] = [];
      for (const field of record.fields) {
        const type = cTypeOfFact(field.type, records);
        if (type === undefined) return undefined;
        fields.push({ name: field.name, type });
      }
      return {
        kind: "record",
        name: record.name,
        union: record.union,
        packed: record.packed,
        alignment: record.alignment,
        fields,
      };
    }
    default:
      return undefined;
  }
}

/** Why the layout `cLayout` computes for `record` differs from clang's, or
 * undefined when they agree. */
export function layoutDisagreement(
  record: RecordFact,
  records: ReadonlyMap<string, RecordFact>,
  target: CTarget,
): string | undefined {
  const type = cTypeOfFact({ kind: "record", name: record.name }, records);
  if (type === undefined) return "a member has no C layout";
  const layout = cLayout(type, target);
  if (!layout.ok) return layout.error;
  const ours = describeLayout(
    layout.value.size,
    layout.value.alignment,
    layout.value.offsets,
  );
  const clangs = describeLayout(
    record.size,
    record.align,
    record.fields.map((field) => field.offset),
  );
  return ours === clangs
    ? undefined
    : `clang lays it out as ${clangs}, the declaration syntax as ${ours}`;
}
function describeLayout(
  size: number,
  alignment: number,
  offsets: readonly number[],
): string {
  return `size ${size} align ${alignment} offsets [${offsets.join(", ")}]`;
}

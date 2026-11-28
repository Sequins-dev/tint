import { planRecordLayout, type RecordFieldStorage } from "./record-layout.ts";
import {
  planClassRecords,
  type ClassAccessorStorage,
  type ClassRecordStorage,
  type PlannedClassRecords,
} from "./class-records.ts";
import { syntaxHash } from "@tint/typescript/syntax";
import {
  createKeyIndex,
  createStringIndex,
} from "@tint/foundation/collections/key-index";
import {
  classAccessorSlot,
  classPrivateAccessorSlot,
  classPrivateBrandSlot,
  classPrivateSlot,
  type CheckedClosures,
  type ClassContract,
  type PrivateMemberAccess,
} from "@tint/typescript/checker";
import type { Expression } from "@tint/typescript/syntax";
import {
  isNativeTypedArray,
  type ScalarType,
  type RecordLayout,
  type RecordDebugInfo,
} from "@tint/ir/scalar";
import type {
  RecordAccess,
  FiniteRecordAccess,
  RecordAccessChoice,
  RecordOperations,
  RecordConstruction,
  RecordConstructionShape,
  ConstructionField,
  ConstructorCall,
  ClassInstanceTest,
  PrivateAccessPlan,
  PrivateBrandCheckPlan,
  CollectionElement,
} from "../../scalar.ts";
import {
  createTypeSystem,
  type TypeSystem,
  type Result,
} from "@tint/typescript/types";
import {
  createLayoutPlanner,
  type TargetDataLayout,
} from "@tint/foundation/layout";
import { scalarType } from "./planning.ts";
import { hasDynamicObject } from "./dynamic-objects.ts";

export function stringType(checked: CheckedClosures, id: number): boolean {
  const t = checked.types[id];
  if (t?.kind === "string") return true;
  if (t?.kind === "literal") return typeof t.value === "string";
  return t?.kind === "union" && t.members.every((m) => stringType(checked, m));
}
function referenceType(
  checked: CheckedClosures,
  id: number,
  encoding: "object" | "string" = "object",
): ScalarType | undefined {
  const seen = new Set<number>();
  let absent = false,
    present = false;
  function collect(id: number): boolean {
    if (seen.has(id)) return true;
    seen.add(id);
    const t = checked.types[id];
    if (t?.kind === "union") return t.members.every(collect);
    if (
      t?.kind === "object" &&
      (t.call !== undefined || t.construct !== undefined)
    )
      return false;
    if (t?.kind === "undefined") {
      absent = true;
      return true;
    }
    if (
      t?.kind === encoding ||
      (encoding === "string" &&
        t?.kind === "literal" &&
        typeof t.value === "string")
    ) {
      present = true;
      return true;
    }
    return false;
  }
  return collect(id) && present
    ? absent
      ? encoding === "string"
        ? "optional-string"
        : "optional-reference"
      : encoding === "string"
        ? "string"
        : "reference"
    : undefined;
}
/** A BigInt is a reference to js-runtime's BigIntValue record; with
 * undefined members it is an optional reference. BigInts never share a
 * reference encoding with other records. */
export function bigIntType(
  checked: CheckedClosures,
  id: number,
): "reference" | "optional-reference" | undefined {
  const t = checked.types[id];
  if (t?.kind === "bigint") return "reference";
  if (t?.kind !== "union") return undefined;
  let present = false;
  for (const member of t.members) {
    if (member === undefined) throw "bigint union member invariant";
    const kind = checked.types[member]?.kind;
    if (kind === "bigint") present = true;
    else if (kind !== "undefined") return undefined;
  }
  return present ? "optional-reference" : undefined;
}
function primitiveEncoding(
  checked: CheckedClosures,
  id: number,
): "number" | "string" | undefined {
  if (stringType(checked, id)) return "string";
  return scalarType(checked, id) === "number" ? "number" : undefined;
}
function collectionElement(
  checked: CheckedClosures,
  id: number,
): CollectionElement | undefined {
  return (
    primitiveEncoding(checked, id) ??
    (isNativeTypedArray(checked.types[id]?.kind ?? "") ||
    checked.types[id]?.kind === "function" ||
    checked.types[id]?.kind === "array" ||
    checked.types[id]?.kind === "set" ||
    checked.types[id]?.kind === "map" ||
    generalType(checked, id) ||
    scalarType(checked, id) === "boolean" ||
    scalarType(checked, id) === "optional-boolean" ||
    scalarType(checked, id) === "optional-number" ||
    referenceType(checked, id, "string") === "optional-string" ||
    (checked.types[id]?.kind === "union" &&
      entryType(checked, id) === "primitive") ||
    referenceType(checked, id) === "reference" ||
    referenceType(checked, id) === "optional-reference" ||
    bigIntType(checked, id) !== undefined
      ? id
      : undefined)
  );
}
/** Inline tag/payload storage avoids boxing heterogeneous primitive unions.
 * Keep homogeneous nullable scalar/string encodings specialized. Unknown also
 * absorbs other union members, including helper-generated undefined. */
function generalType(checked: CheckedClosures, id: number): boolean {
  const type = checked.types[id];
  if (
    type?.kind === "unknown" ||
    type?.kind === "realm-callable" ||
    type?.kind === "dynamic-result" ||
    type?.kind === "void-value"
  )
    return true;
  if (
    type?.kind === "object" &&
    (type.realmConstructor === true ||
      type.realmTypedArray !== undefined ||
      type.realmLibrary !== undefined)
  )
    return true;
  if (
    type !== undefined &&
    type.kind !== "object" &&
    type.kind !== "literal" &&
    (isNativeTypedArray(type.kind) || type.kind === "SharedArrayBuffer")
  )
    return "arrayFlow" in type && type.arrayFlow === true;
  if (type?.kind !== "union") return false;
  const visited = new Set<number>(),
    primitiveKinds = new Set<string>();
  let unknown = false,
    primitive = false,
    reference = false,
    supported = true;
  function visit(member: number): void {
    if (visited.has(member)) return;
    visited.add(member);
    const current = checked.types[member];
    if (current?.kind === "union") {
      for (const nested of current.members) {
        if (nested === undefined) throw "union member invariant";
        visit(nested);
      }
    } else if (
      current?.kind === "unknown" ||
      current?.kind === "realm-callable" ||
      current?.kind === "dynamic-result" ||
      current?.kind === "void-value"
    )
      unknown = true;
    else if (current?.kind === "never") return;
    else if (current?.kind === "undefined") primitiveKinds.add("undefined");
    else if (
      current?.kind === "number" ||
      current?.kind === "boolean" ||
      current?.kind === "string" ||
      current?.kind === "null" ||
      current?.kind === "literal"
    ) {
      primitive = true;
      primitiveKinds.add(
        current.kind === "literal" ? typeof current.value : current.kind,
      );
    } else if (
      current?.kind === "object" &&
      current.call === undefined &&
      current.construct === undefined
    )
      reference = true;
    else if (
      current?.kind === "Error" ||
      current?.kind === "TypeError" ||
      current?.kind === "RangeError" ||
      current?.kind === "function" ||
      current?.kind === "array" ||
      current?.kind === "map" ||
      current?.kind === "set" ||
      isNativeTypedArray(current?.kind) ||
      current?.kind === "ArrayBuffer" ||
      current?.kind === "SharedArrayBuffer" ||
      current?.kind === "DataView"
    ) {
      if (
        current !== undefined &&
        (isNativeTypedArray(current.kind) ||
          current.kind === "SharedArrayBuffer") &&
        "arrayFlow" in current &&
        current.arrayFlow === true
      )
        unknown = true;
      else reference = true;
    } else supported = false;
  }
  visit(id);
  const heterogeneous =
    primitiveKinds.size > 1 &&
    !(
      primitiveKinds.size === 2 &&
      primitiveKinds.has("undefined") &&
      !primitiveKinds.has("null")
    );
  return (
    unknown ||
    (supported && ((primitive && reference) || (!reference && heterogeneous)))
  );
}
export function arrayElement(
  checked: CheckedClosures,
  id: number,
): CollectionElement | undefined {
  const t = checked.types[id];
  if (t?.kind !== "array") return undefined;
  // A never-element array can contain only holes under the checked contract.
  if (checked.types[t.element]?.kind === "never") return "number";
  if (generalType(checked, t.element)) return t.element;
  const scalar = scalarType(checked, t.element);
  if (scalar === "boolean" || scalar === "optional-boolean") return t.element;
  if (scalar === "optional-number") return "number";
  if (referenceType(checked, t.element, "string") === "optional-string")
    return "string";
  const element = checked.types[t.element];
  if (
    element?.kind === "union" &&
    element.members.some((m) => checked.types[m]?.kind === "undefined")
  ) {
    const present = element.members.filter(
      (m) => checked.types[m]?.kind !== "undefined",
    );
    const first = present[0];
    if (present.length === 1 && first !== undefined)
      return collectionElement(checked, first);
    const known = checked.types.findIndex((candidate): boolean => {
      const type = candidate;
      return (
        type !== undefined &&
        type.kind === "union" &&
        type.members.length === present.length &&
        present.every((m) => type.members.includes(m))
      );
    });
    if (known >= 0) return collectionElement(checked, known);
  }
  return collectionElement(checked, t.element);
}
/** Lowering asks for the same types' encodings once per expression (and
 * an array literal once per list runtime), and arrayElement can scan the
 * whole type table. A lowering pass owns one memo for its checked program:
 * the table is append-only while lowering (an appended type may only replace
 * its own slot with a structurally identical canonical type), so an answer
 * stays valid. Typed arrays keep a repeat query to one indexed read; 0 marks
 * an id not yet computed. */
export interface RepresentationMemo {
  readonly arrayElement: (id: number) => CollectionElement | undefined;
  readonly entryType: (id: number) => ScalarType | undefined;
}
export function createRepresentationMemo(
  checked: CheckedClosures,
): RepresentationMemo {
  let arrays = new Float64Array(Math.max(16, checked.types.length)),
    entries = new Uint8Array(arrays.length);
  function reserve(id: number): boolean {
    if (!Number.isInteger(id) || id < 0 || id >= checked.types.length)
      return false;
    if (id < arrays.length) return true;
    const capacity = Math.max(id + 1, arrays.length * 2),
      grownArrays = new Float64Array(capacity),
      grownEntries = new Uint8Array(capacity);
    grownArrays.set(arrays);
    grownEntries.set(entries);
    arrays = grownArrays;
    entries = grownEntries;
    return true;
  }
  return {
    arrayElement(id) {
      if (!reserve(id)) return arrayElement(checked, id);
      const cached = arrays[id] ?? 0;
      if (cached !== 0) return decodeElement(cached);
      const result = arrayElement(checked, id);
      arrays[id] = encodeElement(result);
      return result;
    },
    entryType(id) {
      if (!reserve(id)) return entryType(checked, id);
      const cached = entries[id] ?? 0;
      if (cached !== 0) return decodeScalarType(cached);
      const result = entryType(checked, id);
      entries[id] = encodeScalarType(result);
      return result;
    },
  };
}
/** Collection elements: 1 "number", 2 "string", 3 undefined, id + 4. */
function encodeElement(element: CollectionElement | undefined): number {
  return element === "number"
    ? 1
    : element === "string"
      ? 2
      : element === undefined
        ? 3
        : element + 4;
}
function decodeElement(encoded: number): CollectionElement | undefined {
  return encoded === 1
    ? "number"
    : encoded === 2
      ? "string"
      : encoded === 3
        ? undefined
        : encoded - 4;
}
/** 0 marks an uncomputed id, so results are encoded from 1. */
function encodeScalarType(type: ScalarType | undefined): number {
  if (type === undefined) return 1;
  switch (type) {
    case "general":
      return 2;
    case "optional-boolean":
      return 3;
    case "primitive":
      return 4;
    case "string":
      return 5;
    case "reference":
      return 6;
    case "optional-reference":
      return 7;
    case "optional-string":
      return 8;
    case "number":
      return 9;
    case "boolean":
      return 10;
    case "Uint8Array":
      return 11;
    case "Uint16Array":
      return 12;
    case "Uint32Array":
      return 13;
    case "Float64Array":
      return 14;
    case "optional-number":
      return 15;
    case "Int8Array":
      return 16;
    case "Uint8ClampedArray":
      return 17;
    case "Int16Array":
      return 18;
    case "Int32Array":
      return 19;
    case "Float32Array":
      return 20;
    case "Float16Array":
      return 21;
    case "BigInt64Array":
      return 22;
    case "BigUint64Array":
      return 23;
    case "word64":
      return 24;
  }
}
function decodeScalarType(encoded: number): ScalarType | undefined {
  switch (encoded) {
    case 2:
      return "general";
    case 3:
      return "optional-boolean";
    case 4:
      return "primitive";
    case 5:
      return "string";
    case 6:
      return "reference";
    case 7:
      return "optional-reference";
    case 8:
      return "optional-string";
    case 9:
      return "number";
    case 10:
      return "boolean";
    case 11:
      return "Uint8Array";
    case 12:
      return "Uint16Array";
    case 13:
      return "Uint32Array";
    case 14:
      return "Float64Array";
    case 15:
      return "optional-number";
    case 16:
      return "Int8Array";
    case 17:
      return "Uint8ClampedArray";
    case 18:
      return "Int16Array";
    case 19:
      return "Int32Array";
    case 20:
      return "Float32Array";
    case 21:
      return "Float16Array";
    case 22:
      return "BigInt64Array";
    case 23:
      return "BigUint64Array";
    case 24:
      return "word64";
    default:
      return undefined;
  }
}
export function setElement(
  checked: CheckedClosures,
  id: number,
): CollectionElement | undefined {
  const t = checked.types[id];
  // Pure `bigint` elements specialize `linked-set` with `T = bigint`, which
  // lowers `===` to `equalBigInt` (SameValueZero value equality). Unions
  // mixing `bigint` with other types still require general value equality.
  if (
    t?.kind !== "set" ||
    (mentionsBigInt(checked, t.element) &&
      checked.types[t.element]?.kind !== "bigint")
  )
    return undefined;
  return collectionElement(checked, t.element);
}
/** Whether the program operates on BigInts: every BigInt value reaches an
 * operation through an expression, and parameters bind them. (`bigint` is a
 * primitive in every checked type table, so the table itself says nothing.) */
/** Whether undefined is a value of the type (hole reads need no check). */
export function admitsUndefined(checked: CheckedClosures, id: number): boolean {
  const t = checked.types[id];
  if (t === undefined) return true;
  if (
    t.kind === "undefined" ||
    t.kind === "void" ||
    t.kind === "unknown" ||
    t.kind === "dynamic-result" ||
    t.kind === "void-value"
  )
    return true;
  return (
    t.kind === "union" && t.members.some((m) => admitsUndefined(checked, m))
  );
}
export function usesBigInt(checked: CheckedClosures): boolean {
  let found = false;
  checked.expressions.forEach((type, _expression) => {
    if (!found && mentionsBigInt(checked, type)) found = true;
  });
  if (found) return true;
  for (const type of checked.bindingTypes)
    if (type !== undefined && mentionsBigInt(checked, type)) return true;
  return false;
}
function mentionsBigInt(checked: CheckedClosures, id: number): boolean {
  const t = checked.types[id];
  if (
    t?.kind === "bigint" ||
    t?.kind === "BigInt64Array" ||
    t?.kind === "BigUint64Array"
  )
    return true;
  return (
    t?.kind === "union" && t.members.some((m) => mentionsBigInt(checked, m))
  );
}
interface MapEncoding {
  readonly key: CollectionElement;
  readonly value: CollectionElement;
}
export function mapEncoding(
  checked: CheckedClosures,
  id: number,
): MapEncoding | undefined {
  const t = checked.types[id];
  // Pure `bigint` keys specialize `linked-map` with `K = bigint` (value
  // equality via `equalBigInt`); see setElement.
  if (
    t?.kind !== "map" ||
    (mentionsBigInt(checked, t.key) && checked.types[t.key]?.kind !== "bigint")
  )
    return undefined;
  const key = collectionElement(checked, t.key),
    value = collectionElement(checked, t.value);
  return key === undefined || value === undefined ? undefined : { key, value };
}
/** The encoding class of a list element: list helpers only move elements,
 * so elements of one class (one value encoding) can share an instantiation.
 * Collections are list/Set/Map headers, i.e. managed references; other
 * elements use their field encoding. Undefined means no shared class (an
 * encoding that depends on the program's collection contracts). */
export function listElementClass(
  checked: CheckedClosures,
  id: number,
): ScalarType | undefined {
  const type = checked.types[id];
  if (type === undefined) return undefined;
  if (type.kind === "array" || type.kind === "set" || type.kind === "map")
    return "reference";
  return entryType(checked, id);
}
/** A boolean-encoded list element narrower than boolean (a literal `true`
 * or `false`, possibly with undefined). Its list helpers must still accept
 * every boolean: an unsound assertion can store the other value, and a
 * helper specialized to the literal would reject it. Such elements share the
 * boolean instantiation of their encoding class. */
export function narrowBooleanListElement(
  checked: CheckedClosures,
  id: number,
): boolean {
  const type = checked.types[id];
  if (type === undefined) return false;
  const encoding = listElementClass(checked, id);
  if (encoding !== "boolean" && encoding !== "optional-boolean") return false;
  if (type.kind === "literal") return true;
  if (type.kind !== "union") return false;
  for (const member of type.members) {
    if (member === undefined) throw "boolean list member invariant";
    if (checked.types[member]?.kind === "literal") return true;
  }
  return false;
}
/** The encoding class of a Map instantiation, or undefined when it must
 * stay specialized for its exact types. Map helpers only move values, so any
 * value class may share; keys are compared and hashed, so only keys whose
 * comparison is one machine rule may share: managed references (identity,
 * or a caller's equivalence closures) and the string and number primitives. */
export function mapEncodingClass(
  checked: CheckedClosures,
  key: CollectionElement,
  value: CollectionElement,
): string | undefined {
  const keyClass =
    typeof key === "number"
      ? checked.types[key]?.kind === "bigint"
        ? "bigint"
        : listElementClass(checked, key)
      : key;
  const valueClass =
    typeof value === "number" ? listElementClass(checked, value) : value;
  if (
    valueClass === undefined ||
    (keyClass !== "reference" &&
      keyClass !== "string" &&
      keyClass !== "number" &&
      keyClass !== "bigint")
  )
    return undefined;
  return keyClass + "|" + valueClass;
}
/** The element of a list helper's `T | undefined` value parameter, or the
 * type itself when it is not such a union. */
export function presentListElement(
  checked: CheckedClosures,
  id: number,
): number {
  const type = checked.types[id];
  if (type?.kind !== "union") return id;
  let present = -1;
  for (const member of type.members) {
    if (member === undefined) throw "list element member invariant";
    if (checked.types[member]?.kind === "undefined") continue;
    if (present >= 0) return id;
    present = member;
  }
  return present < 0 ? id : present;
}
export function entryType(
  checked: CheckedClosures,
  id: number,
  listElements: readonly CollectionElement[] = [],
  setElements: readonly CollectionElement[] = [],
  mapTypes: readonly MapEncoding[] = [],
): ScalarType | undefined {
  if (checked.types[id]?.kind === "Error") return "reference";
  if (checked.types[id]?.kind === "RangeError") return "reference";
  if (checked.types[id]?.kind === "TypeError") return "reference";
  const entry = checked.types[id];
  if (
    entry?.kind === "ArrayBuffer" ||
    entry?.kind === "DataView" ||
    (entry?.kind === "SharedArrayBuffer" && entry.arrayFlow !== true)
  )
    return "reference";
  if (
    entry?.kind === "union" &&
    entry.members.length > 0 &&
    entry.members.every((m) => {
      const mt = m === undefined ? undefined : checked.types[m];
      return (
        mt?.kind === "ArrayBuffer" ||
        (mt?.kind === "SharedArrayBuffer" && mt.arrayFlow !== true)
      );
    })
  )
    return "reference";
  const bigint = bigIntType(checked, id);
  if (bigint !== undefined) return bigint;
  if (checked.types[id]?.kind === "null") return "primitive";
  if (generalType(checked, id) || hasDynamicObject(checked, id))
    return "general";
  if (stringType(checked, id)) return "string";
  if (referenceType(checked, id, "string") === "optional-string")
    return "optional-string";
  const scalar = scalarType(checked, id);
  if (scalar !== undefined) return scalar;
  const t = checked.types[id];
  if (
    t?.kind === "union" &&
    t.members.some((m) => checked.types[m]?.kind === "undefined")
  ) {
    const present = t.members.filter(
      (m) => checked.types[m]?.kind !== "undefined",
    );
    const first = present[0];
    const firstType = first === undefined ? undefined : checked.types[first];
    if (
      present.length === 1 &&
      firstType !== undefined &&
      (isNativeTypedArray(firstType.kind) ||
        firstType.kind === "DataView" ||
        firstType.kind === "ArrayBuffer" ||
        (firstType.kind === "SharedArrayBuffer" &&
          firstType.arrayFlow !== true))
    )
      return "optional-reference";
    if (
      present.length > 0 &&
      present.every((m) => {
        const mt = m === undefined ? undefined : checked.types[m];
        return (
          mt?.kind === "ArrayBuffer" ||
          (mt?.kind === "SharedArrayBuffer" && mt.arrayFlow !== true)
        );
      })
    )
      return "optional-reference";
  }
  if (t?.kind === "union") {
    const seen = new Set<number>();
    function primitive(member: number): boolean {
      if (seen.has(member)) return true;
      seen.add(member);
      const type = checked.types[member];
      if (type?.kind === "union") return type.members.every(primitive);
      return (
        type?.kind === "number" ||
        type?.kind === "boolean" ||
        type?.kind === "string" ||
        type?.kind === "undefined" ||
        type?.kind === "null" ||
        type?.kind === "literal"
      );
    }
    if (t.members.length > 0 && t.members.every(primitive)) return "primitive";
  }
  if (t?.kind === "function") return "reference";
  // A class's constructor is a managed function value, like other functions
  // (its static side lives in the constructor-state environment).
  if (
    t?.kind === "object" &&
    checked.classes.some((contract) => contract?.constructor === id)
  )
    return "reference";
  if (
    t?.kind === "object" &&
    t.call === undefined &&
    t.construct === undefined &&
    t.properties.every(
      (p) =>
        !p.optional ||
        ["number", "optional-number", "boolean", "optional-boolean"].includes(
          scalarType(checked, p.type) ?? "",
        ) ||
        referenceType(checked, p.type) !== undefined ||
        referenceType(checked, p.type, "string") !== undefined ||
        isNativeTypedArray(checked.types[p.type]?.kind ?? "") ||
        (checked.types[p.type]?.kind === "union" &&
          ["primitive", "general", "optional-reference"].includes(
            entryType(checked, p.type, listElements, setElements, mapTypes) ??
              "",
          )) ||
        (["array", "set", "map", "function"].includes(
          checked.types[p.type]?.kind ?? "",
        ) &&
          entryType(checked, p.type, listElements, setElements, mapTypes) ===
            "reference"),
    )
  )
    return "reference";
  if (t?.kind === "set" && setElements.length > 0) {
    const element = setElement(checked, id);
    if (element !== undefined) {
      for (const allowed of setElements)
        if (allowed === element) return "reference";
    }
  }
  if (t?.kind === "array" && listElements.length > 0) {
    const element = arrayElement(checked, id);
    if (element !== undefined) {
      for (const allowed of listElements)
        if (allowed === element) return "reference";
    }
  }
  if (t?.kind === "map" && mapTypes.length > 0) {
    const encoding = mapEncoding(checked, id);
    if (encoding !== undefined) {
      for (const allowed of mapTypes) {
        if (allowed === undefined) throw "map encoding invariant";
        if (allowed.key === encoding.key && allowed.value === encoding.value)
          return "reference";
      }
    }
  }
  const optionalObject = referenceType(checked, id);
  if (optionalObject === "optional-reference") return optionalObject;
  if (t?.kind === "union") {
    let absent = false,
      present = false;
    for (const member of t.members) {
      if (member === undefined) throw "union member invariant";
      const kind = checked.types[member]?.kind;
      if (kind === "undefined") {
        absent = true;
        continue;
      }
      if (
        kind === "function" &&
        t.members.some((candidate): boolean => {
          const category =
            candidate === undefined
              ? undefined
              : checked.types[candidate]?.kind;
          return category !== "function" && category !== "undefined";
        })
      )
        return undefined;
      const encoding = entryType(
        checked,
        member,
        listElements,
        setElements,
        mapTypes,
      );
      if (encoding !== "reference" && encoding !== "optional-reference")
        return undefined;
      present = true;
      if (encoding === "optional-reference") absent = true;
    }
    if (present) return absent ? "optional-reference" : "reference";
  }
  return undefined;
}
export interface RecordContracts extends RecordOperations {
  /** Discard expression plans consumed by the just-lowered function. */
  readonly clearFunctionOperations: () => void;
  readonly classes: readonly ClassRecordStorage[];
  readonly errorRecords: () => readonly number[];
  readonly errorProperty: (
    node: Expression,
    name: string,
    type: ScalarType,
  ) => void;
  readonly planProperty: (
    node: Expression,
    receiver: number,
    name: string,
    type: ScalarType,
  ) => void;
  readonly forType: (type: number) => number | undefined;
  /** The hidden field of a viewed record layout that holds the record's
   * JavaScript view (the value bridge), or undefined. */
  readonly viewSlot: (record: number) => number | undefined;
  /** The index of a record's field by source name, or undefined. */
  readonly fieldIndex: (record: number, name: string) => number | undefined;
  /** Debugging: the record a type's values statically use, among layouts
   * already planned (never plans one), and a record's source names. */
  readonly plannedRecord: (type: number) => number | undefined;
  readonly debugNames: (record: number) => RecordDebugInfo | undefined;
  readonly typeRecords: readonly (number | undefined)[];
  readonly records: readonly RecordLayout[];
  readonly append: (record: RecordLayout) => number;
  readonly constructClass: (
    node: Expression & { readonly kind: "new" },
    target: number,
  ) => void;
  /** Plan `x instanceof C` for the typed class stored as `storage`. */
  readonly testClassInstance: (
    node: Expression,
    storage: ClassRecordStorage,
  ) => void;
  readonly construct: (node: Expression & { readonly kind: "object" }) => void;
  readonly addFiniteAccess: (
    node: Expression,
    cases: readonly FiniteRecordAccess[],
  ) => void;
  readonly access: (
    node: Expression,
    receiver: Expression,
    name: string,
    type: ScalarType,
    write: boolean,
  ) => void;
  /** Plan `super.name` from a derived class method/constructor: walks each
   * concrete subclass layout in `receiverType`'s family up to `basePrototypeType`
   * (skipping own slots along the way) and reads `name` on that prototype chain. */
  readonly superAccess: (
    node: Expression,
    receiverType: number,
    basePrototypeType: number,
    name: string,
    type: ScalarType,
  ) => void;
  /** Plan private field, method, or accessor access (`obj.#x`). */
  readonly planPrivateAccess: (
    node: Expression,
    info: PrivateMemberAccess,
    ownerLocal: number | undefined,
    type: ScalarType,
  ) => void;
  /** Plan private brand check (`#x in obj`). */
  readonly planPrivateBrandCheck: (
    node: Expression,
    info: PrivateMemberAccess,
    ownerLocal: number | undefined,
  ) => void;
}
/** Optional frontend identity partitions otherwise equal physical layouts. An
 * absent key retains ordinary storage interning; keys belong to this checked graph. */
export type RecordIdentitySelection =
  | { readonly ok: true; readonly value: number | undefined }
  | { readonly ok: false; readonly error: string };
export type RecordIdentityResolver = (type: number) => RecordIdentitySelection;
/** The name of a viewed record's hidden view slot (debug information and
 * layout keys); source property access never reaches it. */
export const viewSlotName = "[[view]]";
/** Representation-specialized record contracts; object unions travel as managed references. */
export function createRecordContracts(
  checked: CheckedClosures,
  target: TargetDataLayout,
  maxBytes: number,
  fail: (message: string) => never,
  listElements: readonly CollectionElement[] = [],
  setElements: readonly CollectionElement[] = [],
  mapTypes: readonly MapEncoding[] = [],
  typeSystem?: TypeSystem,
  identity?: RecordIdentityResolver,
  /** Object types whose values cross into JavaScript as views: their
   * layouts get one hidden optional general field holding the view, so a
   * record keeps one JavaScript identity (docs/unified-pipeline.md). Other
   * layouts are unchanged. */
  viewed: ReadonlySet<number> = new Set<number>(),
  distinct?: ReadonlySet<number>,
  /** The signature witness of a checked function type, for accessor calls. */
  callableWitness?: (type: number) => number,
): RecordContracts {
  if (target.pointerSize !== 8 || target.wordSize !== 8)
    fail("record IR currently requires a 64-bit target");
  // A supplied system must describe this same immutable checked graph.
  const system: Result<TypeSystem> =
    typeSystem === undefined
      ? createTypeSystem(checked.types)
      : { ok: true, value: typeSystem };
  if (!system.ok) fail("invalid checked type graph");
  const planner = createLayoutPlanner(target, maxBytes);
  if (!planner.ok) fail("invalid record layout target");
  const relations = system.value,
    layout = planner.value,
    records: RecordLayout[] = [],
    identities: (number | undefined)[] = [],
    names: (readonly string[])[] = [],
    // Source class names by record (instances, prototypes, constructors).
    classNames: (string | undefined)[] = [],
    byType: (number | undefined)[] = [],
    viewSlots: (number | undefined)[] = [],
    unsupported = new Uint8Array(checked.types.length);
  // Equal physical layouts share storage: the first record (object or class)
  // with the same identity partition, field encodings, mutability, presence
  // and names. Keyed instead of rescanning every record per new layout.
  const layoutIndex = createStringIndex<number>();
  let indexedLayouts = 0;
  function identityKey(value: number | undefined): string {
    return identity === undefined
      ? ""
      : value === undefined
        ? "u"
        : "n" + String(value);
  }
  function layoutFieldKey(
    type: ScalarType,
    mutable: boolean,
    optional: boolean,
    name: string,
  ): string {
    return (
      "|" +
      type +
      (mutable ? ",m" : ",r") +
      (optional ? ",o" : ",p") +
      "," +
      String(name.length) +
      ":" +
      name
    );
  }
  // Native error brands belong to their factory layouts even when another
  // record has exactly the same public fields and storage.
  const distinctLayouts =
    distinct === undefined ? undefined : new Set<number>();
  function sharedLayout(wanted: string): number {
    // Index records added since the last lookup; a record with cell state
    // or a missing field name can never be shared.
    for (; indexedLayouts < records.length; indexedLayouts++) {
      if (distinctLayouts?.has(indexedLayouts) === true) continue;
      const record = records[indexedLayouts],
        recordNames = names[indexedLayouts];
      if (record === undefined || recordNames === undefined) continue;
      let stored =
        identityKey(identities[indexedLayouts]) +
        "#" +
        String(record.fields.length);
      let shareable = true;
      for (let i = 0; i < record.fields.length; i++) {
        const field = record.fields[i],
          name = recordNames[i];
        if (
          field === undefined ||
          name === undefined ||
          field.stateOffset !== undefined
        ) {
          shareable = false;
          break;
        }
        stored += layoutFieldKey(
          field.type,
          field.mutable,
          field.presenceOffset !== undefined,
          name,
        );
      }
      if (shareable && !layoutIndex.has(stored))
        layoutIndex.set(stored, indexedLayouts);
    }
    return layoutIndex.get(wanted) ?? -1;
  }
  // The checked graph is immutable for this contract instance. Structural
  // compatibility depends on the receiver type, not the access expression.
  const receiverShapes: (readonly number[] | undefined)[] = [],
    objectIds: number[] = [],
    propertyCandidates = createStringIndex<number[]>();
  let indexedObjects = false;
  function indexObjects(): void {
    if (indexedObjects) return;
    for (let id = 0; id < checked.types.length; id++) {
      const type = checked.types[id];
      if (type?.kind !== "object") continue;
      objectIds.push(id);
      for (const property of type.properties) {
        if (property === undefined) throw "property candidate invariant";
        const ids = propertyCandidates.get(property.name);
        if (ids === undefined) propertyCandidates.set(property.name, [id]);
        else ids.push(id);
      }
    }
    indexedObjects = true;
  }
  /** A receiver property typed only by literals (and undefined) lists its
   * literal member ids; otherwise undefined. */
  function literalMembers(id: number): readonly number[] | undefined {
    const property = checked.types[id];
    if (property?.kind === "literal") return [id];
    if (property?.kind !== "union") return undefined;
    const members: number[] = [];
    for (const member of property.members) {
      if (member === undefined) throw "receiver literal invariant";
      const kind = checked.types[member]?.kind;
      if (kind === "literal") members.push(member);
      else if (kind !== "undefined") return undefined;
    }
    return members;
  }
  /** Most candidates with the receiver's property names still fail
   * assignability, and each failure runs the relation solver. Object
   * assignability requires every receiver property on the candidate, with
   * compatible optional/readonly modifiers and a related type, and the
   * receiver's signatures. A candidate that misses a property, breaks a
   * modifier rule, has a property type whose kinds are not a subset of the
   * receiver's (relations never add kinds), whose mutable property type has
   * a different exact shape (mutable properties relate exactly), or whose
   * single literal tag is outside the receiver's literal members, can never
   * be assignable.
   * Every other candidate still gets the full relation. */
  function cheapMismatch(
    candidate: number,
    receiverId: number,
    discriminants: readonly { name: string; members: readonly number[] }[],
  ): boolean {
    const shape = checked.types[candidate],
      receiver = checked.types[receiverId];
    if (shape?.kind !== "object" || receiver?.kind !== "object") return false;
    if (
      (receiver.call !== undefined && shape.call === undefined) ||
      (receiver.construct !== undefined && shape.construct === undefined)
    )
      return true;
    for (const property of receiver.properties) {
      if (property === undefined) throw "receiver property invariant";
      let found = -1;
      for (let index = 0; index < shape.properties.length; index++)
        if (shape.properties[index]?.name === property.name) {
          found = index;
          break;
        }
      const source = found < 0 ? undefined : shape.properties[found];
      if (source === undefined) return true;
      if (
        (source.optional === true && property.optional !== true) ||
        (!property.readonly &&
          ((source.optional === true) !== (property.optional === true) ||
            source.readonly !== property.readonly))
      )
        return true;
      if (
        (relations.kindMask(source.type) &
          ~relations.kindMask(property.type)) !==
        0
      )
        return true;
      // A mutable receiver property relates exactly; instantiations of one
      // generic shape (e.g. list nodes over different elements) differ here.
      if (
        !property.readonly &&
        relations.exactShape(source.type) !==
          relations.exactShape(property.type)
      )
        return true;
    }
    for (const discriminant of discriminants) {
      if (discriminant === undefined) throw "discriminant invariant";
      for (const property of shape.properties) {
        if (property === undefined) throw "candidate property invariant";
        if (property.name !== discriminant.name) continue;
        const source = checked.types[property.type];
        if (source?.kind !== "literal") break;
        let matched = false;
        for (const member of discriminant.members) {
          if (member === undefined) throw "discriminant member invariant";
          const target = checked.types[member];
          if (target?.kind === "literal" && target.value === source.value) {
            matched = true;
            break;
          }
        }
        if (!matched) return true;
        break;
      }
    }
    return false;
  }
  /** Union of two ascending id lists, ascending and without duplicates. */
  function mergeAscending(
    left: readonly number[],
    right: readonly number[],
  ): readonly number[] {
    if (left.length === 0) return right;
    if (right.length === 0) return left;
    const merged: number[] = [];
    let i = 0,
      j = 0;
    while (i < left.length || j < right.length) {
      const a = i < left.length ? left[i] : undefined,
        b = j < right.length ? right[j] : undefined;
      if (b === undefined || (a !== undefined && a < b)) {
        if (a === undefined) throw "receiver merge invariant";
        merged.push(a);
        i++;
      } else {
        if (a === b) i++;
        merged.push(b);
        j++;
      }
    }
    return merged;
  }
  function compatibleShapes(receiver: number): readonly number[] {
    const known = receiverShapes[receiver];
    if (known !== undefined) return known;
    indexObjects();
    const type = checked.types[receiver];
    const result: number[] = [];
    if (type?.kind === "union") {
      // Object-to-union assignability is a disjunction. Reuse each member's
      // completed candidate set and preserve global type order for dispatch:
      // every candidate set ascends in type order, so members merge linearly
      // instead of marking a table of every type and rescanning every object.
      let merged: readonly number[] = [];
      for (const member of type.members) {
        if (member === undefined) throw "receiver union invariant";
        merged = mergeAscending(merged, compatibleShapes(member));
      }
      for (const id of merged) {
        if (id === undefined) throw "receiver shape invariant";
        if (result.length === 0 || result[result.length - 1] !== id)
          result.push(id);
      }
    } else if (type?.kind === "unknown") {
      receiverShapes[receiver] = objectIds;
      return objectIds;
    } else if (type?.kind === "object") {
      let candidates: readonly number[] = objectIds;
      const discriminants: { name: string; members: readonly number[] }[] = [];
      for (const property of type.properties) {
        if (property === undefined) throw "receiver property invariant";
        const ids = propertyCandidates.get(property.name);
        if (ids === undefined) {
          candidates = [];
          break;
        }
        if (ids.length < candidates.length) candidates = ids;
        const members = literalMembers(property.type);
        if (members !== undefined)
          discriminants.push({ name: property.name, members });
      }
      for (const id of candidates) {
        if (id === undefined) throw "property candidate invariant";
        if (cheapMismatch(id, receiver, discriminants)) continue;
        if (relations.assignable(id, receiver)) result.push(id);
      }
    }
    receiverShapes[receiver] = result;
    return result;
  }
  const encodings: (ScalarType | false | undefined)[] = [];
  function fieldEncoding(id: number): ScalarType | undefined {
    const known = encodings[id];
    if (known !== undefined) return known === false ? undefined : known;
    const result = entryType(checked, id, listElements, setElements, mapTypes);
    encodings[id] = result ?? false;
    return result;
  }
  const classes: ClassRecordStorage[] = [],
    classShapes: (number[] | undefined)[] = [],
    constructorStates: (number[] | undefined)[] = [],
    constructorFamilyStates: (number[] | undefined)[] = [],
    constructorReceivers: (boolean | undefined)[] = [],
    constructionFields: (number | undefined)[] = [],
    nonEnumerable: number[] = [],
    prototypes: (
      | { field: number; record: number; inherited: readonly number[] }
      | undefined
    )[] = [];
  /** A method, field, or accessor closure slot of a prototype/constructor
   * record, falling through a derived link to its base while absent. */
  function prototypeAccess(
    record: number,
    field: number,
    type: ScalarType,
  ): RecordAccess {
    const fieldInfo = records[record]?.fields[field],
      link = prototypes[record],
      through = link?.inherited[field];
    const choice: RecordAccessChoice = {
      record,
      field,
      type: fieldInfo?.type ?? "reference",
      initialized: fieldInfo?.stateOffset !== undefined,
    };
    // Own non-optional fields are always present (no presence byte).
    if (
      fieldInfo?.presenceOffset === undefined ||
      link === undefined ||
      through === undefined ||
      through < 0
    )
      return { type, choices: [choice] };
    return {
      type,
      choices: [
        {
          ...choice,
          prototype: {
            field: link.field,
            access: prototypeAccess(link.record, through, type),
          },
        },
      ],
    };
  }
  // Class instance fields ("record:field") that code may read before their
  // first assignment: only speculative reads and numeric updates are exact.
  const unprovenFields = new Set<string>();
  // Accessor properties of class layouts ("record:name"): where the getter
  // and setter closures live, and their checked function types.
  const accessorProperties = new Map<
    string,
    {
      readonly pointer: number;
      readonly closures: number;
      readonly getter: number;
      readonly getType: number;
      readonly setter: number | undefined;
      readonly setType: number | undefined;
    }
  >();
  /** The checked function type of a class accessor's getter or setter,
   * walking up base classes when inherited. */
  function classAccessorType(
    contract: ClassContract,
    name: string,
    kind: "get" | "set",
    isStatic: boolean,
  ): number | undefined {
    let cursor: ClassContract | undefined = contract;
    while (cursor !== undefined) {
      for (const member of cursor.members) {
        if (member === undefined) throw "class member invariant";
        const element = member.node;
        if (element.kind === "static-block" || element.kind !== kind) continue;
        if (element.static !== isStatic) continue;
        const key = element.key;
        if (key.kind === "string" && key.value === name) return member.type;
      }
      const nextBase: number | undefined = cursor.base;
      cursor =
        nextBase === undefined
          ? undefined
          : checked.classes.find(
              (c) => c !== undefined && c.instance === nextBase,
            );
    }
    return undefined;
  }
  function accessorChoice(
    shape: number,
    name: string,
    write: boolean,
    type: ScalarType,
  ): RecordAccessChoice | undefined {
    const accessor = accessorProperties.get(String(shape) + ":" + name);
    if (accessor === undefined) return undefined;
    const witness = callableWitness;
    if (witness === undefined)
      fail("class accessors require callable signature witnesses");
    if (write && accessor.setter === undefined) return undefined;
    const closures = accessor.closures;
    function closure(field: number): RecordAccess {
      if (records[closures]?.fields[field] === undefined)
        throw "class accessor closure invariant";
      return prototypeAccess(closures, field, "reference");
    }
    const setter = accessor.setter,
      setType = accessor.setType;
    return {
      record: shape,
      field: accessor.pointer,
      type,
      accessor: {
        get: closure(accessor.getter),
        getTarget: witness(accessor.getType),
        set: setter === undefined ? undefined : closure(setter),
        setTarget: setType === undefined ? undefined : witness(setType),
      },
    };
  }
  function constructorReceiver(id: number): boolean {
    const known = constructorReceivers[id];
    if (known !== undefined) return known;
    const type = checked.types[id];
    const result = type?.kind === "object" && type.construct !== undefined;
    constructorReceivers[id] = result;
    return result;
  }
  /** Layouts of the receiver's own (canonical) type or union members: values
   * constructed at that type, rather than at structurally compatible wider
   * types, are expected to dominate, so their layouts are tested first. The
   * candidates are distinct layouts, so the order is unobservable. */
  function exactLayoutsFirst(
    receiver: number,
    choices: RecordAccessChoice[],
  ): RecordAccessChoice[] {
    const type = checked.types[receiver],
      exact: number[] = [];
    if (type?.kind === "union")
      for (const member of type.members) {
        if (member === undefined) throw "receiver union invariant";
        const layout = record(member);
        if (layout !== undefined) exact.push(layout);
      }
    else {
      // A class type's values are usually its instances.
      const classes = classLayouts(receiver);
      if (classes !== undefined)
        for (const layout of classes) {
          if (layout === undefined) throw "class shape invariant";
          exact.push(layout);
        }
      else {
        const layout = record(receiver);
        if (layout !== undefined) exact.push(layout);
      }
    }
    if (exact.length === 0) return choices;
    const first: RecordAccessChoice[] = [],
      rest: RecordAccessChoice[] = [];
    for (const choice of choices) {
      if (choice === undefined) throw "record choice invariant";
      if (exact.includes(choice.record)) first.push(choice);
      else rest.push(choice);
    }
    for (const choice of rest) {
      if (choice === undefined) throw "record choice invariant";
      first.push(choice);
    }
    return first;
  }
  const equivalentClassShapes: (readonly number[] | undefined)[] = [],
    equivalenceSearched: (boolean | undefined)[] = [];
  /** The class layouts of a class instance or prototype type, or of a type
   * equivalent to one (checking may intern the same object type more than
   * once), else undefined. */
  function classLayouts(id: number): readonly number[] | undefined {
    const own = classShapes[id];
    if (own !== undefined) return own;
    if (equivalenceSearched[id] === true) return equivalentClassShapes[id];
    let found: readonly number[] | undefined;
    if (checked.types[id]?.kind === "object")
      for (const contract of checked.classes) {
        if (contract === undefined) throw "class contract invariant";
        for (const type of [contract.instance, contract.prototype]) {
          if (type === undefined) throw "class contract type invariant";
          const shapes = classShapes[type];
          if (
            found === undefined &&
            shapes !== undefined &&
            relations.assignable(id, type) &&
            relations.assignable(type, id)
          )
            found = shapes;
        }
      }
    equivalenceSearched[id] = true;
    equivalentClassShapes[id] = found;
    return found;
  }
  /** Class layouts some object literal's type shares: TypeScript lets an
   * object literal be typed as a class instance, so such values are plain
   * records too. Found once, from every checked object literal. */
  let literalClassLayouts: Set<readonly number[]> | undefined;
  function literalClass(layouts: readonly number[]): boolean {
    let found = literalClassLayouts;
    if (found === undefined) {
      const literals = new Set<readonly number[]>();
      checked.expressions.forEach((type, node) => {
        if (node.kind !== "object") return;
        const shared = classLayouts(type);
        if (shared !== undefined) literals.add(shared);
      });
      found = literals;
      literalClassLayouts = literals;
    }
    return found.has(layouts);
  }
  function shapesForType(id: number): readonly number[] {
    // Class constructors are always managed closures with constructorState
    // environments, never plain record layouts.
    if (constructorStates[id] !== undefined) return [];
    // Values of a class instance or prototype type have the class layouts,
    // plus the plain record layout only when an object literal has that
    // type, so accesses usually check one layout and record facts can prove
    // it for later accesses.
    const layouts = classLayouts(id);
    if (layouts !== undefined && !literalClass(layouts)) return layouts;
    const ordinary = record(id);
    if (layouts === undefined) return ordinary === undefined ? [] : [ordinary];
    const shapes: number[] = [];
    for (const shape of layouts) {
      if (shape === undefined) throw "class shape invariant";
      shapes.push(shape);
    }
    if (ordinary !== undefined) shapes.push(ordinary);
    return shapes;
  }
  const constructions = createKeyIndex<Expression, RecordConstruction>(
      syntaxHash,
    ),
    accesses = createKeyIndex<Expression, RecordAccess>(syntaxHash),
    finiteAccesses = createKeyIndex<Expression, readonly FiniteRecordAccess[]>(
      syntaxHash,
    ),
    constructors = createKeyIndex<Expression, ConstructorCall>(syntaxHash),
    classInstanceTests = createKeyIndex<Expression, ClassInstanceTest>(
      syntaxHash,
    ),
    privateAccesses = createKeyIndex<Expression, PrivateAccessPlan>(syntaxHash),
    privateBrandChecks = createKeyIndex<Expression, PrivateBrandCheckPlan>(
      syntaxHash,
    );
  const spreads = new Map<
    Expression,
    { name: string; access: RecordAccess; alwaysPresent: boolean }[]
  >();
  function record(id: number): number | undefined {
    const known = byType[id];
    if (known !== undefined) return known;
    if (unsupported[id] === 1 || hasDynamicObject(checked, id))
      return undefined;
    const t = checked.types[id];
    if (t?.kind === "union") {
      unsupported[id] = 1;
      let shared: number | undefined;
      const first = t.members[0];
      if (first === undefined) return undefined;
      for (const member of t.members) {
        if (member === undefined) throw "record union invariant";
        const candidate = record(member);
        if (
          candidate === undefined ||
          (shared !== undefined && candidate !== shared)
        )
          return undefined;
        const fieldNames = names[candidate];
        if (fieldNames === undefined) throw "record union names invariant";
        for (const name of fieldNames) {
          if (name === undefined) throw "record union field invariant";
          if (
            optionalPrimitiveField(member, name) !==
            optionalPrimitiveField(first, name)
          )
            return undefined;
        }
        shared = candidate;
      }
      if (shared !== undefined) {
        unsupported[id] = 0;
        byType[id] = shared;
      }
      return shared;
    }
    if (
      t?.kind !== "object" ||
      t.call !== undefined ||
      t.construct !== undefined
    )
      return undefined;
    const fields: RecordFieldStorage[] = [];
    for (const p of t.properties) {
      if (p === undefined) throw "record property invariant";
      let type = fieldEncoding(p.type);
      if (p.optional)
        type =
          type === "general"
            ? "general"
            : type === "primitive"
              ? "optional-reference"
              : type === "boolean" || type === "optional-boolean"
                ? "optional-boolean"
                : type === "number" || type === "optional-number"
                  ? "optional-number"
                  : type === "reference" ||
                      type === "optional-reference" ||
                      isNativeTypedArray(type ?? "")
                    ? "optional-reference"
                    : type === "string" || type === "optional-string"
                      ? "optional-string"
                      : undefined;
      if (type === undefined) {
        unsupported[id] = 1;
        return undefined;
      }
      fields.push({
        type,
        mutable: !p.readonly,
        optional: p.optional === true,
      });
    }
    const fieldNames: string[] = [];
    for (const p of t.properties) {
      if (p === undefined) throw "record property invariant";
      fieldNames.push(p.name);
    }
    // A viewed layout ends with its view slot: optional (absent until the
    // record first crosses), general, and named so that no source property
    // can reach it (field access resolves source property names).
    if (viewed.has(id)) {
      fields.push({ type: "general", mutable: true, optional: true });
      fieldNames.push(viewSlotName);
    }
    // AOT may share storage descriptors. Managed imports must preserve checked
    // identities until their semantic contracts have been selected.
    const selectedIdentity = identity?.(id);
    if (selectedIdentity !== undefined && !selectedIdentity.ok)
      fail(selectedIdentity.error);
    const key =
      selectedIdentity?.ok === true ? selectedIdentity.value : undefined;
    let wanted = identityKey(key) + "#" + String(fields.length);
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i],
        name = fieldNames[i];
      if (field === undefined || name === undefined)
        throw "record field invariant";
      wanted += layoutFieldKey(field.type, field.mutable, field.optional, name);
    }
    const distinctLayout = distinct?.has(id) === true;
    const duplicate = distinctLayout ? -1 : sharedLayout(wanted);
    if (duplicate >= 0) {
      byType[id] = duplicate;
      return duplicate;
    }
    const result = records.length;
    if (identity !== undefined) identities[result] = key;
    if (distinctLayout) distinctLayouts?.add(result);
    records.push(planRecordLayout(fields, layout, fail));
    names.push(fieldNames);
    if (viewed.has(id)) viewSlots[result] = fields.length - 1;
    byType[id] = result;
    return result;
  }
  function optionalPrimitiveField(
    id: number | undefined,
    name: string,
  ): boolean {
    const type = id === undefined ? undefined : checked.types[id];
    if (type?.kind === "union") {
      const first = type.members[0];
      return first !== undefined && optionalPrimitiveField(first, name);
    }
    if (type?.kind !== "object") return false;
    const property = type.properties.find(
      (p) => p !== undefined && p.name === name,
    );
    if (property === undefined || property.optional !== true) return false;
    return fieldEncoding(property.type) === "primitive";
  }
  function spreadProperties(
    source: Expression,
    fieldNames: readonly string[],
    excluded?: readonly string[],
  ): { name: string; access: RecordAccess; alwaysPresent: boolean }[] {
    const sourceType = checked.expressions.get(source);
    if (sourceType === undefined) fail("missing spread source type");
    if (checked.types[sourceType]?.kind === "undefined") return [];
    const encoding = fieldEncoding(sourceType);
    if (encoding !== "reference" && encoding !== "optional-reference")
      fail("object spread requires fixed object representations");
    const exact = new Set<number>();
    function literalShapes(node: Expression): boolean {
      if (node.kind === "group") return literalShapes(node.expression);
      if (node.kind === "conditional")
        return literalShapes(node.consequent) && literalShapes(node.alternate);
      if (node.kind !== "object") return false;
      const type = checked.expressions.get(node);
      if (type === undefined) return false;
      exact.add(type);
      return true;
    }
    const closed = literalShapes(source);
    const candidates: { type: number; record: number }[] = [];
    for (let id = 0; id < checked.types.length; id++) {
      if (
        checked.types[id]?.kind !== "object" ||
        (closed ? !exact.has(id) : !relations.assignable(id, sourceType))
      )
        continue;
      for (const shape of shapesForType(id)) {
        if (shape === undefined) throw "spread shape invariant";
        if (excluded !== undefined) {
          const excludedNames = excluded;

          if (nonEnumerable[shape] === 1)
            fail("typed object rest requires known own enumerable fields");
          const fields = names[shape];
          if (fields === undefined) throw "spread shape fields invariant";
          for (const name of fields)
            if (
              name !== undefined &&
              !fieldNames.includes(name) &&
              !excludedNames.includes(name)
            )
              fail("typed object rest requires known own enumerable fields");
        }
        if (nonEnumerable[shape] !== 1)
          candidates.push({ type: id, record: shape });
      }
    }
    if (candidates.length === 0)
      fail("object spread requires known source shapes");
    const properties: {
      name: string;
      access: RecordAccess;
      alwaysPresent: boolean;
    }[] = [];
    for (const name of fieldNames) {
      if (name === undefined) throw "spread field invariant";
      let alwaysPresent = encoding === "reference";
      const choices: RecordAccessChoice[] = [];
      const logical: ScalarType[] = [];
      const seen = new Set<string>();
      for (const candidate of candidates) {
        if (candidate === undefined) throw "spread candidate invariant";
        const fieldNames = names[candidate.record];
        const field =
          fieldNames === undefined ? undefined : fieldNames.indexOf(name);
        const info =
          field === undefined
            ? undefined
            : records[candidate.record]?.fields[field];
        if (field === undefined || info === undefined) {
          alwaysPresent = false;
          continue;
        }
        if (info.presenceOffset !== undefined) alwaysPresent = false;
        const primitive = optionalPrimitiveField(candidate.type, name);
        const key = String(candidate.record) + ":" + String(field);
        if (seen.has(key)) continue;
        seen.add(key);
        choices.push({
          record: candidate.record,
          field,
          type: info.type,
          primitive,
          initialized: info.stateOffset !== undefined,
        });
        logical.push(primitive ? "primitive" : info.type);
      }
      const first = logical[0];
      if (first === undefined) continue;
      let type: ScalarType;
      if (logical.every((t) => t === first)) type = first;
      else if (logical.every((t) => t === "number" || t === "optional-number"))
        type = "optional-number";
      else if (
        logical.every((t) => t === "boolean" || t === "optional-boolean")
      )
        type = "optional-boolean";
      else if (logical.every((t) => t === "string" || t === "optional-string"))
        type = "optional-string";
      else if (
        logical.every((t) => t === "reference" || t === "optional-reference")
      )
        type = "optional-reference";
      else if (
        logical.every(
          (t) =>
            t !== undefined &&
            [
              "primitive",
              "number",
              "optional-number",
              "boolean",
              "optional-boolean",
              "string",
              "optional-string",
            ].includes(t),
        )
      )
        type = "primitive";
      else if (
        logical.every(
          (t) =>
            t !== undefined &&
            [
              "number",
              "boolean",
              "string",
              "reference",
              "general",
              "optional-number",
              "optional-boolean",
              "optional-string",
              "optional-reference",
            ].includes(t),
        )
      )
        type = "general";
      else
        fail(
          "spread property " +
            name +
            " requires a compatible native representation: " +
            logical.join(",") +
            " at " +
            String(source.start) +
            " source type " +
            String(sourceType),
        );
      if (
        !alwaysPresent &&
        ![
          "general",
          "primitive",
          "number",
          "optional-number",
          "boolean",
          "optional-boolean",
          "string",
          "optional-string",
          "reference",
          "optional-reference",
        ].includes(type)
      )
        fail(
          "conditional spread property requires an optional native representation",
        );
      properties.push({ name, access: { type, choices }, alwaysPresent });
    }
    return properties;
  }
  // Planned classes by instance type: a base precedes its derived classes
  // in checked.classes, so its plan is available when they are planned.
  const plannedClasses = new Map<
    number,
    {
      contract: ClassContract;
      planned: PlannedClassRecords;
      instance: number;
      prototype: number;
      constructorState: number;
      base: number | undefined;
    }
  >();
  for (const contract of checked.classes) {
    if (contract === undefined) throw "class storage contract invariant";
    const baseType = contract.base,
      baseClass =
        baseType === undefined ? undefined : plannedClasses.get(baseType);
    if (baseType !== undefined && baseClass === undefined)
      fail("base class storage must be planned before derived classes");
    const planned = planClassRecords(
        contract,
        checked.types,
        layout,
        fieldEncoding,
        fail,
        (element) => checked.uninitializedFields?.get(element) === true,
        baseClass?.planned,
      ),
      prototype = records.length;
    records.push(planned.prototype);
    names.push(planned.prototypeNames);
    const className = contract.definition.name ?? "class";
    classNames[prototype] = className + ".prototype";
    nonEnumerable[prototype] = 1;
    const instance = records.length;
    records.push(planned.instance);
    names.push(planned.instanceNames);
    classNames[instance] = className;
    prototypes[instance] = {
      field: planned.prototypeField,
      record: prototype,
      inherited: planned.inherited,
    };
    // A derived prototype falls through its hidden link to the base's.
    const link = planned.prototypeLink;
    if (baseClass !== undefined && link !== undefined)
      prototypes[prototype] = {
        field: link,
        record: baseClass.prototype,
        inherited: planned.prototypeInherited,
      };
    for (const field of planned.unproven)
      unprovenFields.add(String(instance) + ":" + String(field));
    const staticAccessors: ClassAccessorStorage[] = [];
    for (const accessor of planned.accessors) {
      if (accessor === undefined) throw "class accessor invariant";
      if (accessor.static) {
        staticAccessors.push(accessor);
        continue;
      }
      const getType = classAccessorType(contract, accessor.name, "get", false);
      if (getType === undefined || accessor.getter < 0)
        fail("class accessor getter invariant");
      accessorProperties.set(String(instance) + ":" + accessor.name, {
        pointer: planned.prototypeField,
        closures: prototype,
        getter: accessor.getter,
        getType,
        setter: accessor.setter,
        setType: classAccessorType(contract, accessor.name, "set", false),
      });
    }
    for (const type of [contract.instance, contract.prototype]) {
      if (type === undefined) throw "class storage type invariant";
      let shapes = classShapes[type];
      if (shapes === undefined) {
        shapes = [];
        classShapes[type] = shapes;
      }
      shapes.push(type === contract.instance ? instance : prototype);
    }
    // A base-typed value may hold any instance of its family.
    let ancestor = baseType;
    while (ancestor !== undefined) {
      const shapes = classShapes[ancestor];
      if (shapes === undefined) throw "base class shape invariant";
      shapes.push(instance);
      ancestor = plannedClasses.get(ancestor)?.base;
    }
    const constructorState = records.length;
    constructionFields[constructorState] = planned.constructionField;
    records.push(planned.constructorState);
    names.push(planned.constructorNames);
    classNames[constructorState] = className + ".constructor";
    const ctorLink = planned.constructorLink;
    if (baseClass !== undefined && ctorLink !== undefined)
      prototypes[constructorState] = {
        field: ctorLink,
        record: baseClass.constructorState,
        inherited: planned.constructorInherited,
      };
    plannedClasses.set(contract.instance, {
      contract,
      planned,
      instance,
      prototype,
      constructorState,
      base: baseType,
    });
    let states = constructorStates[contract.constructor];
    if (states === undefined) {
      states = [];
      constructorStates[contract.constructor] = states;
    }
    states.push(constructorState);
    let familyStates = constructorFamilyStates[contract.constructor];
    if (familyStates === undefined) {
      familyStates = [];
      constructorFamilyStates[contract.constructor] = familyStates;
    }
    familyStates.push(constructorState);
    // A base static method/accessor's `this` may hold any derived constructor.
    let ctorAncestor = baseType;
    while (ctorAncestor !== undefined) {
      const entry = plannedClasses.get(ctorAncestor);
      if (entry === undefined) throw "base constructor shape invariant";
      let baseFamily = constructorFamilyStates[entry.contract.constructor];
      if (baseFamily === undefined) {
        baseFamily = [];
        constructorFamilyStates[entry.contract.constructor] = baseFamily;
      }
      baseFamily.push(constructorState);
      ctorAncestor = entry.base;
    }
    for (const accessor of staticAccessors) {
      if (accessor === undefined) throw "class accessor invariant";
      const getType = classAccessorType(contract, accessor.name, "get", true);
      if (getType === undefined || accessor.getter < 0)
        fail("class accessor getter invariant");
      accessorProperties.set(String(constructorState) + ":" + accessor.name, {
        pointer: -1,
        closures: constructorState,
        getter: accessor.getter,
        getType,
        setter: accessor.setter,
        setType: classAccessorType(contract, accessor.name, "set", true),
      });
    }
    const definitionEnvironment = records.length;
    records.push(planned.members.definitionEnvironment);
    names.push(
      planned.members.definitionEnvironment.fields.map(
        (_, index) => "$member" + String(index),
      ),
    );
    classNames[definitionEnvironment] = className + ".definition";
    const constructionEnvironment = records.length;
    records.push(planned.members.constructionEnvironment);
    names.push(
      planned.members.constructionEnvironment.fields.map(
        (_, index) => "$entry" + String(index),
      ),
    );
    classNames[constructionEnvironment] = className + ".construction";
    const staticsLayout = planned.members.staticsEnvironment;
    let staticsEnvironment: number | undefined;
    if (staticsLayout !== undefined) {
      staticsEnvironment = records.length;
      records.push(staticsLayout);
      names.push(
        staticsLayout.fields.map((_, index) => "$static" + String(index)),
      );
      classNames[staticsEnvironment] = className + ".statics";
    }
    const prototypeConstructorField =
        planned.prototypeNames.indexOf("constructor"),
      statePrototypeField = planned.constructorNames.indexOf("prototype");
    if (prototypeConstructorField < 0 || statePrototypeField < 0)
      fail("class prototype and constructor storage require their links");
    classes.push({
      constructorState,
      constructionField: planned.constructionField,
      initializationField: planned.initializationField,
      prototypeConstructorField,
      statePrototypeField,
      contract,
      instance,
      prototype,
      prototypeField: planned.prototypeField,
      privateBrandField: planned.privateBrandField,
      prototypeLink: planned.prototypeLink,
      constructorLink: planned.constructorLink,
      definitionEnvironment,
      constructionEnvironment,
      staticsEnvironment,
      members: planned.members,
    });
  }
  let structuralErrors: readonly number[] | undefined;
  function errorRecords(): readonly number[] {
    if (structuralErrors !== undefined) return structuralErrors;
    const errorType = checked.types.findIndex((type) => type?.kind === "Error");
    if (errorType < 0) throw "Error type invariant";
    const descriptors: number[] = [];
    indexObjects();
    for (const id of objectIds) {
      if (id === undefined) throw "Error shape invariant";
      if (!relations.assignable(id, errorType)) continue;
      for (const descriptor of shapesForType(id)) {
        if (descriptor === undefined) throw "Error record invariant";
        if (!descriptors.includes(descriptor)) descriptors.push(descriptor);
      }
    }
    structuralErrors = descriptors;
    return descriptors;
  }
  return {
    classes,
    records,
    errorRecords,
    errorProperty: (node, name, type) => {
      const choices: RecordAccessChoice[] = [];
      for (const descriptor of errorRecords()) {
        if (descriptor === undefined) throw "Error record invariant";
        const field = names[descriptor]?.indexOf(name) ?? -1;
        const info = records[descriptor]?.fields[field];
        if (
          info !== undefined &&
          (info.type === "string" || info.type === "optional-string")
        )
          choices.push({ record: descriptor, field, type: info.type });
      }
      accesses.set(node, { type, choices });
    },
    planProperty: (node, receiver, name, type) => {
      const candidates = compatibleShapes(receiver);
      const choices: RecordAccessChoice[] = [];
      const seen = new Set<number>();
      function property(record: number): RecordAccessChoice | undefined {
        const field = names[record]?.indexOf(name) ?? -1;
        const info = records[record]?.fields[field];
        if (info === undefined)
          return accessorChoice(record, name, false, type);
        const prototype = prototypes[record];
        const inherited =
          prototype === undefined ? undefined : property(prototype.record);
        if (inherited === undefined || prototype === undefined)
          return { record, field, type: info.type };
        return {
          record,
          field,
          type: info.type,
          prototype: {
            field: prototype.field,
            access: { type: inherited.type, choices: [inherited] },
          },
        };
      }
      for (const candidate of candidates) {
        if (candidate === undefined)
          throw "record membership candidate invariant";
        for (const descriptor of shapesForType(candidate)) {
          if (descriptor === undefined || seen.has(descriptor)) continue;
          seen.add(descriptor);
          const choice = property(descriptor);
          if (choice !== undefined) choices.push(choice);
        }
      }
      accesses.set(node, { type, choices });
    },
    forType: record,
    viewSlot: (record: number): number | undefined => viewSlots[record],
    fieldIndex: (record: number, name: string): number | undefined => {
      const fields = names[record];
      if (fields === undefined) return undefined;
      const index = fields.indexOf(name);
      return index < 0 ? undefined : index;
    },
    plannedRecord: (type) => {
      const shapes = classShapes[type];
      if (shapes !== undefined)
        return shapes.length === 1 ? shapes[0] : undefined;
      return byType[type];
    },
    debugNames: (id) => {
      const fields = names[id],
        layout = records[id];
      if (
        fields === undefined ||
        layout === undefined ||
        fields.length !== layout.fields.length
      )
        return undefined;
      return {
        name: classNames[id] ?? "{" + fields.join(", ") + "}",
        fields: fields.slice(),
      };
    },
    typeRecords: byType,
    append: (record) => {
      if (record.byteLength > maxBytes)
        fail("owned record exceeds layout limit");
      names.push([]);
      records.push(record);
      return records.length - 1;
    },
    constructions,
    constructors,
    classInstanceTests,
    privateAccesses,
    privateBrandChecks,
    clearFunctionOperations: () => {
      constructions.clear();
      constructors.clear();
      classInstanceTests.clear();
      privateAccesses.clear();
      privateBrandChecks.clear();
      accesses.clear();
      spreads.clear();
    },
    testClassInstance: (node, storage) => {
      const targetInstance = storage.contract.instance;
      const derives = (candidate: ClassRecordStorage): boolean => {
        let current: number | undefined = candidate.contract.instance;
        while (current !== undefined) {
          if (current === targetInstance) return true;
          current = plannedClasses.get(current)?.base;
        }
        return false;
      };
      const family: {
        readonly instance: number;
        readonly prototypeField: number;
        readonly prototypeChain: readonly {
          readonly record: number;
          readonly linkField: number;
        }[];
      }[] = [];
      for (const candidate of classes) {
        if (candidate === undefined || !derives(candidate)) continue;
        const chain: { readonly record: number; readonly linkField: number }[] =
          [];
        let proto = candidate.prototype;
        while (proto !== storage.prototype) {
          const link = prototypes[proto];
          if (link === undefined) break;
          chain.push({ record: proto, linkField: link.field });
          proto = link.record;
        }
        family.push({
          instance: candidate.instance,
          prototypeField: candidate.prototypeField,
          prototypeChain: chain,
        });
      }
      classInstanceTests.set(node, {
        prototype: {
          type: "reference",
          functionEnvironment: true,
          choices: [
            {
              record: storage.constructorState,
              field: storage.statePrototypeField,
              type: "reference",
            },
          ],
        },
        instance: storage.instance,
        prototypeField: storage.prototypeField,
        family,
      });
    },
    constructClass: (node, target) => {
      const receiver = checked.expressions.get(node.callee);
      if (receiver === undefined || !constructorReceiver(receiver))
        fail("class construction requires a construct-signature receiver");
      const choices: RecordAccessChoice[] = [];
      for (const type of compatibleShapes(receiver)) {
        if (type === undefined) throw "constructor type invariant";
        for (const record of constructorStates[type] ?? []) {
          if (record === undefined) throw "constructor state invariant";
          const field = constructionFields[record];
          if (field === undefined) throw "construction entry invariant";
          choices.push({ record, field, type: "reference", initialized: true });
        }
      }
      if (choices.length === 0)
        fail("class construction requires known constructor layouts");
      constructors.set(node, {
        target,
        entry: { type: "reference", functionEnvironment: true, choices },
      });
    },
    accesses,
    finiteAccesses,
    addFiniteAccess: (node, cases): void => {
      finiteAccesses.set(node, cases);
    },
    spreads,
    construct: (node) => {
      const type = checked.expressions.get(node);
      if (type === undefined) fail("missing constructed type");
      function shape(type: number, id: number): RecordConstructionShape {
        const fields = names[id];
        if (fields === undefined) throw "record names invariant";
        return {
          record: id,
          fields: fields.map((name, index): ConstructionField => {
            const field = records[id]?.fields[index];
            if (field === undefined || name === undefined)
              throw "construction field invariant";
            return {
              name,
              type: field.type,
              optional: field.presenceOffset !== undefined,
              primitive: optionalPrimitiveField(type, name),
            };
          }),
        };
      }
      const id = record(type);
      let construction: RecordConstruction;
      if (id !== undefined) {
        const common = shape(type, id);
        construction = { record: common.record, fields: common.fields };
      } else {
        const union = checked.types[type];
        if (union?.kind !== "union")
          fail(
            "object construction requires supported fixed field representations (type " +
              String(type) +
              ")",
          );
        const first = union.members[0],
          firstType = first === undefined ? undefined : checked.types[first];
        if (firstType?.kind !== "object")
          fail("union construction requires object variants");
        function tags(
          id: number,
        ): readonly (string | number | boolean | undefined)[] | undefined {
          const value = checked.types[id];
          if (value?.kind === "literal") return [value.value];
          if (value?.kind === "undefined") return [undefined];
          if (value?.kind !== "union") return undefined;
          const result: (string | number | boolean | undefined)[] = [];
          for (const member of value.members) {
            if (member === undefined) throw "discriminant member invariant";
            const literals = tags(member);
            if (literals === undefined) return undefined;
            for (const literal of literals) {
              result.push(literal);
            }
          }
          return result;
        }
        let variants: (RecordConstructionShape & {
          readonly tag: string | number | boolean | undefined;
        })[] = [];
        let discriminant: string | undefined;
        for (const property of firstType.properties) {
          if (property === undefined) throw "discriminant property invariant";
          const choices: (RecordConstructionShape & {
            readonly tag: string | number | boolean | undefined;
          })[] = [];
          const seen = new Set<string | number | boolean | undefined>();
          let category: string | undefined,
            valid = true;
          for (const member of union.members) {
            if (member === undefined) throw "union construction invariant";
            const value = checked.types[member],
              layout = record(member);
            if (value?.kind !== "object" || layout === undefined) {
              valid = false;
              break;
            }
            const field = value.properties.find(
              (p) => p !== undefined && p.name === property.name,
            );
            const values = field === undefined ? undefined : tags(field.type);
            if (
              field === undefined ||
              values === undefined ||
              values.length === 0
            ) {
              valid = false;
              break;
            }
            const literals: readonly (string | number | boolean | undefined)[] =
              field.optional ? [...values, undefined] : values;
            for (const literal of literals) {
              if (
                seen.has(literal) ||
                (literal !== undefined &&
                  category !== undefined &&
                  category !== typeof literal)
              ) {
                valid = false;
                break;
              }
              seen.add(literal);
              if (literal !== undefined) category = typeof literal;
              choices.push({ ...shape(member, layout), tag: literal });
            }
            if (!valid) break;
          }
          if (valid) {
            discriminant = property.name;
            variants = choices;
            break;
          }
        }
        const initial = variants[0];
        if (discriminant === undefined || initial === undefined)
          fail(
            "union construction requires a distinct literal discriminant (type " +
              String(type) +
              ")",
          );
        construction = {
          record: initial.record,
          fields: initial.fields,
          discriminant,
          variants,
        };
      }
      const fields: string[] = [];
      const shapes: readonly RecordConstructionShape[] =
        construction.variants ?? [construction];
      for (const variant of shapes) {
        if (variant === undefined) throw "construction shape invariant";
        for (const field of variant.fields) {
          if (field === undefined) throw "construction field invariant";
          if (!fields.includes(field.name)) fields.push(field.name);
        }
      }
      const overwritten = new Set<string>();
      for (let index = node.properties.length - 1; index >= 0; index--) {
        const property = node.properties[index];
        if (property === undefined) throw "construction property invariant";
        if (property.kind === "spread") {
          // Strict records have stored fields, without getters. The source
          // expression still executes, but overwritten field reads are dead.
          const copied = fields.filter(
            (name) => name !== undefined && !overwritten.has(name),
          );
          spreads.set(
            property.value,
            spreadProperties(
              property.value,
              copied,
              checked.bindingRestExclusions?.get(node),
            ),
          );
        } else overwritten.add(property.name);
      }
      constructions.set(node, construction);
    },
    access: (node, receiver, name, type, write) => {
      const receiverType = checked.expressions.get(receiver);
      if (receiverType === undefined) fail("missing receiver type");
      const property = relations.property(receiverType, name);
      const storage = property.ok ? fieldEncoding(property.value) : undefined;
      if (write) {
        if (storage === undefined) fail("unsupported property storage");
        type = storage;
      }
      const functionEnvironment = constructorReceiver(receiverType);
      const choices: RecordAccessChoice[] = [],
        seen = new Set<string>(),
        ctorChoices: RecordAccessChoice[] = [],
        ctorSeen = new Set<string>();
      function collectShape(
        id: number,
        shape: number,
        targetChoices: RecordAccessChoice[],
        targetSeen: Set<string>,
      ): void {
        const fieldNames = names[shape];
        const field =
            fieldNames === undefined ? undefined : fieldNames.indexOf(name),
          info =
            field === undefined ? undefined : records[shape]?.fields[field];
        if (info === undefined) {
          const accessor = accessorChoice(shape, name, write, type);
          const key = String(shape) + ":@" + name;
          if (accessor !== undefined && !targetSeen.has(key)) {
            targetSeen.add(key);
            targetChoices.push(accessor);
          }
          return;
        }
        const primitive = optionalPrimitiveField(id, name);
        const inheritedSlot =
          field !== undefined &&
          (prototypes[shape]?.inherited[field] ?? -1) >= 0;
        if (
          field === undefined ||
          info === undefined ||
          (info.type !== type &&
            !(
              write &&
              ((info.type === "optional-reference" && type === "reference") ||
                ((unprovenFields.has(String(shape) + ":" + String(field)) ||
                  inheritedSlot) &&
                  ((info.type === "optional-number" && type === "number") ||
                    (info.type === "optional-string" && type === "string") ||
                    (info.type === "optional-boolean" && type === "boolean"))))
            ) &&
            !primitive &&
            !(
              !write &&
              (info.type === "general" ||
                type === "general" ||
                ((info.type === "primitive" || type === "primitive") &&
                  [
                    "primitive",
                    "number",
                    "boolean",
                    "string",
                    "optional-number",
                    "optional-string",
                  ].includes(info.type) &&
                  [
                    "primitive",
                    "number",
                    "boolean",
                    "string",
                    "optional-number",
                    "optional-string",
                  ].includes(type)) ||
                (info.type === "number" && type === "optional-number") ||
                (info.type === "reference" && type === "optional-reference") ||
                (info.type === "string" && type === "optional-string") ||
                (info.type === "optional-number" && type === "number") ||
                (info.type === "optional-boolean" && type === "boolean") ||
                (info.type === "optional-reference" && type === "reference") ||
                (info.type === "optional-string" && type === "string"))
            )) ||
          (write && !info.mutable)
        )
          return;
        const key = shape + ":" + field;
        if (targetSeen.has(key)) return;
        targetSeen.add(key);
        if (!write && type !== "general" && unprovenFields.has(key))
          fail(
            "a field read before its first assignment requires a speculative read: " +
              name +
              " at " +
              node.start +
              ":" +
              node.end,
          );
        const prototype = prototypes[shape],
          inherited = prototype?.inherited[field];
        const choice: RecordAccessChoice = {
          record: shape,
          field,
          type: info.type,
          primitive,
          initialized: info.stateOffset !== undefined,
        };
        if (prototype === undefined || inherited === undefined || inherited < 0)
          targetChoices.push(choice);
        else
          targetChoices.push({
            ...choice,
            prototype: {
              field: prototype.field,
              access: prototypeAccess(prototype.record, inherited, type),
            },
          });
      }
      for (const id of compatibleShapes(receiverType)) {
        if (id === undefined) throw "receiver shape invariant";
        if (functionEnvironment) {
          for (const shape of constructorFamilyStates[id] ??
            constructorStates[id] ??
            []) {
            if (shape === undefined) throw "receiver shape invariant";
            collectShape(id, shape, choices, seen);
          }
        } else {
          for (const shape of shapesForType(id)) {
            if (shape === undefined) throw "receiver shape invariant";
            collectShape(id, shape, choices, seen);
          }
          for (const shape of constructorFamilyStates[id] ??
            constructorStates[id] ??
            []) {
            if (shape === undefined) throw "receiver shape invariant";
            collectShape(id, shape, ctorChoices, ctorSeen);
          }
        }
      }
      if (choices.length === 0 && ctorChoices.length === 0)
        fail(
          "property access requires supported matching record layouts: " +
            name +
            " at " +
            node.start +
            ":" +
            node.end,
        );
      if (choices.length === 0)
        accesses.set(node, {
          type,
          choices: ctorChoices,
          functionEnvironment: true,
        });
      else if (ctorChoices.length > 0)
        accesses.set(node, {
          type,
          choices: exactLayoutsFirst(receiverType, choices),
          functionEnvironment,
          constructorFallback: {
            type,
            choices: ctorChoices,
            functionEnvironment: true,
          },
        });
      else
        accesses.set(node, {
          type,
          choices: exactLayoutsFirst(receiverType, choices),
          functionEnvironment,
        });
    },
    superAccess: (node, receiverType, basePrototypeType, name, type) => {
      const isStatic = constructorReceiver(basePrototypeType);
      const targetProto = isStatic
        ? constructorStates[basePrototypeType]?.[0]
        : classLayouts(basePrototypeType)?.[0];
      if (targetProto === undefined)
        fail("super property access requires a known base prototype layout");
      const targetField = names[targetProto]?.indexOf(name) ?? -1;
      const getterField =
        targetField >= 0
          ? -1
          : (names[targetProto]?.indexOf(classAccessorSlot("get", name)) ?? -1);
      if (targetField < 0 && getterField < 0)
        fail(
          "super property access requires a known base prototype member: " +
            name,
        );
      let getterTarget: number | undefined;
      if (getterField >= 0) {
        const witness = callableWitness;
        if (witness === undefined)
          fail("super getter access requires callable signature witnesses");
        const targetClass = classes.find(
          (c) =>
            c !== undefined &&
            (isStatic
              ? c.constructorState === targetProto
              : c.prototype === targetProto),
        );
        if (targetClass === undefined)
          fail("super getter access requires a known base class");
        const getType = classAccessorType(
          targetClass.contract,
          name,
          "get",
          isStatic,
        );
        if (getType === undefined)
          fail("super getter access requires a base getter signature");
        getterTarget = witness(getType);
      }
      const targetAccess =
        getterField >= 0
          ? prototypeAccess(targetProto, getterField, "reference")
          : prototypeAccess(targetProto, targetField, type);
      const receiverRecords = isStatic
        ? (constructorFamilyStates[receiverType] ??
          constructorStates[receiverType] ??
          [])
        : shapesForType(receiverType);
      const choices: RecordAccessChoice[] = [];
      for (const instanceRecord of receiverRecords) {
        if (instanceRecord === undefined)
          throw "super receiver shape invariant";
        // Walk prototype/constructor links from instanceRecord -> ... -> targetProto.
        const hops: { readonly record: number; readonly field: number }[] = [];
        let cursor = instanceRecord;
        let reached = false;
        for (let depth = 0; depth < 64; depth++) {
          const link = prototypes[cursor];
          if (link === undefined) break;
          hops.push({ record: cursor, field: link.field });
          if (link.record === targetProto) {
            reached = true;
            break;
          }
          cursor = link.record;
        }
        if (!reached)
          fail("super property access could not reach base prototype layout");
        if (getterField >= 0 && getterTarget !== undefined) {
          const startHop = isStatic ? 0 : 1;
          let chain: RecordAccess = targetAccess;
          for (let i = hops.length - 1; i >= startHop; i--) {
            const hop = hops[i];
            if (hop === undefined) throw "super hop invariant";
            chain = {
              type: "reference",
              choices: [
                {
                  record: hop.record,
                  field: 0,
                  type: "reference",
                  prototype: {
                    field: hop.field,
                    skipOwn: true,
                    access: chain,
                  },
                },
              ],
            };
          }
          const first = hops[0];
          if (first === undefined) throw "super first hop invariant";
          choices.push({
            record: first.record,
            field: isStatic ? -1 : first.field,
            type,
            accessor: {
              get: chain,
              getTarget: getterTarget,
              set: undefined,
              setTarget: undefined,
            },
          });
          continue;
        }
        let chain: RecordAccess = targetAccess;
        for (let i = hops.length - 1; i >= 1; i--) {
          const hop = hops[i];
          if (hop === undefined) throw "super hop invariant";
          chain = {
            type,
            choices: [
              {
                record: hop.record,
                field: 0,
                type: "reference",
                prototype: {
                  field: hop.field,
                  skipOwn: true,
                  access: chain,
                },
              },
            ],
          };
        }
        const first = hops[0];
        if (first === undefined) throw "super first hop invariant";
        choices.push({
          record: first.record,
          field: 0,
          type: "reference",
          prototype: {
            field: first.field,
            skipOwn: true,
            access: chain,
          },
        });
      }
      if (choices.length === 0)
        fail("super property access requires known receiver layouts");
      accesses.set(
        node,
        isStatic
          ? { type, choices, functionEnvironment: true }
          : { type, choices },
      );
    },
    planPrivateAccess: (node, info, ownerLocal, type) => {
      const contract = info.contract,
        member = info.member;
      const storage = classes.find((c) => c?.contract === contract);
      if (storage === undefined) fail("missing private member class storage");
      function familySlotChoices(slotName: string): RecordAccessChoice[] {
        const family = classShapes[contract.instance] ?? [];
        const choices: RecordAccessChoice[] = [];
        for (const rec of family) {
          if (rec === undefined) throw "private family record invariant";
          const field = names[rec]?.indexOf(slotName) ?? -1;
          const fieldInfo = records[rec]?.fields[field];
          if (field < 0 || fieldInfo === undefined)
            fail("missing private instance field storage: " + slotName);
          choices.push({
            record: rec,
            field,
            type: fieldInfo.type,
            initialized: fieldInfo.stateOffset !== undefined,
          });
        }
        if (choices.length === 0)
          fail("private instance access requires class instance layouts");
        return choices;
      }
      function stateSlotAccess(
        slotName: string,
        accessType: ScalarType,
      ): RecordAccess {
        const state = storage?.constructorState;
        if (state === undefined) throw "private constructor state invariant";
        const field = names[state]?.indexOf(slotName) ?? -1;
        const fieldInfo = records[state]?.fields[field];
        if (field < 0 || fieldInfo === undefined)
          fail("missing private constructor state slot: " + slotName);
        return {
          type: accessType,
          functionEnvironment: true,
          choices: [
            {
              record: state,
              field,
              type: fieldInfo.type,
              initialized: fieldInfo.stateOffset !== undefined,
            },
          ],
        };
      }
      if (!member.static && member.kind === "field") {
        const slotName = classPrivateSlot(contract.instance, member.name);
        privateAccesses.set(node, {
          kind: "instance-field",
          name: member.name,
          type,
          fieldAccess: { type, choices: familySlotChoices(slotName) },
        });
        return;
      }
      if (ownerLocal === undefined)
        fail(
          "private member access requires declaring class constructor local",
        );
      if (member.static && member.kind === "field") {
        const slotName = classPrivateSlot(contract.instance, member.name);
        privateAccesses.set(node, {
          kind: "static-field",
          name: member.name,
          type,
          ownerLocal,
          staticFieldAccess: stateSlotAccess(slotName, type),
        });
        return;
      }
      if (member.kind === "method") {
        const slotName = classPrivateSlot(contract.instance, member.name);
        const methodAccess = stateSlotAccess(slotName, "reference");
        if (member.static) {
          privateAccesses.set(node, {
            kind: "static-method",
            name: member.name,
            type: "reference",
            ownerLocal,
            methodAccess,
          });
        } else {
          if (storage.privateBrandField === undefined) {
            const brandRecords = (classShapes[contract.instance] ?? []).map(
              (record) => ({ record, field: storage.prototypeField }),
            );
            if (brandRecords.length === 0)
              fail("private instance method requires class instance layouts");
            privateAccesses.set(node, {
              kind: "instance-method",
              name: member.name,
              type: "reference",
              ownerLocal,
              brandRecords,
              methodAccess,
            });
          } else {
            const brandName = classPrivateBrandSlot(contract.instance);
            privateAccesses.set(node, {
              kind: "instance-method",
              name: member.name,
              type: "reference",
              ownerLocal,
              brandCheck: {
                type: "boolean",
                choices: familySlotChoices(brandName),
              },
              methodAccess,
            });
          }
        }
        return;
      }
      const witness = callableWitness;
      if (witness === undefined)
        fail("private class accessors require callable signature witnesses");
      const getSlot =
        member.getter === undefined
          ? undefined
          : stateSlotAccess(
              classPrivateAccessorSlot(contract.instance, "get", member.name),
              "reference",
            );
      const setSlot =
        member.setter === undefined
          ? undefined
          : stateSlotAccess(
              classPrivateAccessorSlot(contract.instance, "set", member.name),
              "reference",
            );
      const accessor: {
        get?: RecordAccess;
        getTarget?: number;
        set?: RecordAccess;
        setTarget?: number;
      } = {};
      const getterType = member.getter,
        setterType = member.setter;
      if (getSlot !== undefined && getterType !== undefined) {
        accessor.get = getSlot;
        accessor.getTarget = witness(getterType);
      }
      if (setSlot !== undefined && setterType !== undefined) {
        accessor.set = setSlot;
        accessor.setTarget = witness(setterType);
      }
      if (member.static) {
        privateAccesses.set(node, {
          kind: "static-accessor",
          name: member.name,
          type,
          ownerLocal,
          accessor,
        });
      } else {
        if (storage.privateBrandField === undefined) {
          const brandRecords = (classShapes[contract.instance] ?? []).map(
            (record) => ({ record, field: storage.prototypeField }),
          );
          if (brandRecords.length === 0)
            fail("private instance accessor requires class instance layouts");
          privateAccesses.set(node, {
            kind: "instance-accessor",
            name: member.name,
            type,
            ownerLocal,
            brandRecords,
            accessor,
          });
        } else {
          const brandName = classPrivateBrandSlot(contract.instance);
          privateAccesses.set(node, {
            kind: "instance-accessor",
            name: member.name,
            type,
            ownerLocal,
            brandCheck: {
              type: "boolean",
              choices: familySlotChoices(brandName),
            },
            accessor,
          });
        }
      }
    },
    planPrivateBrandCheck: (node, info, ownerLocal) => {
      const contract = info.contract,
        member = info.member;
      const storage = classes.find((c) => c?.contract === contract);
      if (storage === undefined) fail("missing private brand class storage");
      if (member.static) {
        if (ownerLocal === undefined)
          fail("static private brand check requires declaring class local");
        let check: RecordAccess | undefined;
        if (member.kind === "field") {
          const slotName = classPrivateSlot(contract.instance, member.name);
          const state = storage.constructorState;
          const field = names[state]?.indexOf(slotName) ?? -1;
          const fieldInfo = records[state]?.fields[field];
          if (field < 0 || fieldInfo === undefined)
            fail("missing static private field storage: " + slotName);
          check = {
            type: fieldInfo.type,
            functionEnvironment: true,
            choices: [
              {
                record: state,
                field,
                type: fieldInfo.type,
                initialized: fieldInfo.stateOffset !== undefined,
              },
            ],
          };
        }
        privateBrandChecks.set(node, {
          static: true,
          name: member.name,
          ownerLocal,
          ...(check === undefined ? {} : { check }),
        });
        return;
      }
      const family = classShapes[contract.instance] ?? [];
      if (member.kind !== "field" && storage.privateBrandField === undefined) {
        if (family.length === 0)
          fail("private brand check requires class instance layouts");
        privateBrandChecks.set(node, {
          static: false,
          name: member.name,
          brandRecords: family.map((record) => ({
            record,
            field: storage.prototypeField,
          })),
        });
        return;
      }
      const slotName =
        member.kind === "field"
          ? classPrivateSlot(contract.instance, member.name)
          : classPrivateBrandSlot(contract.instance);
      const choices: RecordAccessChoice[] = [];
      let checkType: ScalarType = "boolean";
      for (const rec of family) {
        if (rec === undefined) throw "private brand family invariant";
        const field = names[rec]?.indexOf(slotName) ?? -1;
        const fieldInfo = records[rec]?.fields[field];
        if (field < 0 || fieldInfo === undefined)
          fail("missing private brand slot: " + slotName);
        checkType = fieldInfo.type;
        choices.push({
          record: rec,
          field,
          type: fieldInfo.type,
          initialized: fieldInfo.stateOffset !== undefined,
        });
      }
      if (choices.length === 0)
        fail("private brand check requires class instance layouts");
      privateBrandChecks.set(node, {
        static: false,
        name: member.name,
        check: { type: checkType, choices },
      });
    },
  };
}

import {
  configurableField,
  enumerableField,
  getField,
  setField,
  valueField,
  writableField,
  type Descriptor,
  type DescriptorUpdate,
} from "../descriptors/index.ts";
import {
  createExoticObject,
  ordinaryDefineOwnProperty,
  ordinaryDeleteProperty,
  ordinaryGetOwnProperty,
  ordinaryOwnKeys,
  type ObjectHooks,
  type ObjectInternalMethods,
  type OrdinaryObject,
  type PropertyDefinitionResult,
} from "./operations.ts";
import { scriptPropertyKeyOrder, type ScriptPropertyKey } from "./symbols.ts";

/** How a record view reaches its record's fields, by index into `keys`:
 * `read` returns a field's current value as a JavaScript value; `write`
 * stores a JavaScript value into a writable field, throwing a TypeError when
 * the value is outside the field's declared type (an enforced contract). */
export interface RecordViewAccess {
  readonly keys: readonly string[];
  readonly writable: readonly boolean[];
  readonly read: (field: number) => unknown;
  readonly write: (field: number, value: unknown) => void;
}

/** A JavaScript object over a typed record (docs/unified-pipeline.md, the
 * value bridge). Each field is an own enumerable, configurable data property
 * whose value is the record's current field value, writable unless the field
 * is `readonly`; reads and writes go to the record's storage, so typed code
 * and JavaScript observe the same values. Fields cannot be deleted or turned
 * into accessors (the record's shape is fixed); they report configurable
 * because another typed alias may change a `readonly` field. Other keys are
 * ordinary own properties of the view (expandos). Identity is the caller's:
 * one view per record. */
export function createRecordView(
  prototype: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  record: unknown,
  access: RecordViewAccess,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const keys = access.keys;
  const fieldCount = keys.length;
  let index: Map<string, number> | undefined = undefined;
  let noToJSON = true,
    noIntegerKeys = true;
  if (fieldCount <= 8) {
    for (let field = 0; field < fieldCount; field++) {
      const key = keys[field];
      if (key === undefined) throw "RECORD_VIEW_FIELD_INVARIANT";
      for (let prev = 0; prev < field; prev++) {
        if (keys[prev] === key) throw "RECORD_VIEW_DUPLICATE_FIELD";
      }
      if (key === "toJSON") noToJSON = false;
      if (noIntegerKeys) {
        const c = key.charCodeAt(0);
        if (c >= 48 && c <= 57 && scriptPropertyKeyOrder(key) >= 0)
          noIntegerKeys = false;
      }
    }
  } else {
    const map = new Map<string, number>();
    for (let field = 0; field < fieldCount; field++) {
      const key = keys[field];
      if (key === undefined) throw "RECORD_VIEW_FIELD_INVARIANT";
      if (map.has(key)) throw "RECORD_VIEW_DUPLICATE_FIELD";
      map.set(key, field);
      if (key === "toJSON") noToJSON = false;
      if (noIntegerKeys) {
        const c = key.charCodeAt(0);
        if (c >= 48 && c <= 57 && scriptPropertyKeyOrder(key) >= 0)
          noIntegerKeys = false;
      }
    }
    index = map;
  }
  function fieldFor(key: ScriptPropertyKey): number {
    if (typeof key !== "string") return -1;
    if (index !== undefined) return index.get(key) ?? -1;
    for (let i = 0; i < fieldCount; i++) {
      if (keys[i] === key) return i;
    }
    return -1;
  }
  function writable(field: number): boolean {
    return access.writable[field] === true;
  }
  const methods: ObjectInternalMethods<ScriptPropertyKey, unknown> = {
    typedRecord: (): unknown => record,
    recordViewAccess: access,
    recordViewNoToJSON: noToJSON,
    recordViewNoIntegerKeys: noIntegerKeys,
    getOwnProperty: (
      object: OrdinaryObject<ScriptPropertyKey, unknown>,
      key: ScriptPropertyKey,
    ): Descriptor<unknown> | undefined => {
      const field = fieldFor(key);
      if (field < 0)
        return ordinaryGetOwnProperty<ScriptPropertyKey, unknown>(object, key);
      return {
        accessor: false,
        value: access.read(field),
        writable: writable(field),
        get: undefined,
        set: undefined,
        enumerable: true,
        configurable: true,
      };
    },
    defineOwnProperty: (
      object: OrdinaryObject<ScriptPropertyKey, unknown>,
      key: ScriptPropertyKey,
      update: DescriptorUpdate<unknown>,
      hooks: ObjectHooks<unknown>,
    ): PropertyDefinitionResult => {
      const field = fieldFor(key);
      if (field < 0)
        return ordinaryDefineOwnProperty<ScriptPropertyKey, unknown>(
          object,
          key,
          update,
          hooks,
        );
      return defineField(access, field, writable(field), update, hooks);
    },
    deleteProperty: (
      object: OrdinaryObject<ScriptPropertyKey, unknown>,
      key: ScriptPropertyKey,
    ): boolean =>
      fieldFor(key) < 0 &&
      ordinaryDeleteProperty<ScriptPropertyKey, unknown>(object, key),
    ownKeys: (
      object: OrdinaryObject<ScriptPropertyKey, unknown>,
    ): ScriptPropertyKey[] => {
      // Fields come first: integer-like names lead in ascending order
      // (interleaved with integer-like expandos), other names follow in
      // declaration order, then expandos.
      const indices: string[] = [],
        names: string[] = [];
      for (const key of access.keys) {
        if (key === undefined) throw "RECORD_VIEW_FIELD_INVARIANT";
        if (scriptPropertyKeyOrder(key) >= 0) indices.push(key);
        else names.push(key);
      }
      indices.sort(
        (a: string, b: string): number =>
          scriptPropertyKeyOrder(a) - scriptPropertyKeyOrder(b),
      );
      const own = ordinaryOwnKeys<ScriptPropertyKey, unknown>(
        object,
        scriptPropertyKeyOrder,
      );
      const keys: ScriptPropertyKey[] = [];
      let position = 0;
      for (const key of own) {
        if (key === undefined) throw "RECORD_VIEW_KEY_INVARIANT";
        if (scriptPropertyKeyOrder(key) < 0) break;
        while (
          position < indices.length &&
          scriptPropertyKeyOrder(indices[position] ?? "") <
            scriptPropertyKeyOrder(key)
        )
          keys.push(indices[position++] ?? "");
        keys.push(key);
      }
      while (position < indices.length) keys.push(indices[position++] ?? "");
      for (const name of names) if (name !== undefined) keys.push(name);
      for (const key of own) {
        if (key === undefined) throw "RECORD_VIEW_KEY_INVARIANT";
        if (scriptPropertyKeyOrder(key) < 0) keys.push(key);
      }
      return keys;
    },
  };
  return createExoticObject<ScriptPropertyKey, unknown>(prototype, methods);
}

/** A field accepts a definition that keeps it an enumerable, configurable
 * data property with its writability, and stores a supplied value through
 * the field (a read-only field accepts only its current value). */
function defineField(
  access: RecordViewAccess,
  field: number,
  writable: boolean,
  update: DescriptorUpdate<unknown>,
  hooks: ObjectHooks<unknown>,
): PropertyDefinitionResult {
  if ((update.fields & (getField | setField)) !== 0) return "rejected";
  if ((update.fields & enumerableField) !== 0 && !update.enumerable)
    return "rejected";
  if ((update.fields & configurableField) !== 0 && !update.configurable)
    return "rejected";
  if ((update.fields & writableField) !== 0 && update.writable !== writable)
    return "rejected";
  if ((update.fields & valueField) !== 0) {
    if (writable) access.write(field, update.value);
    else if (!hooks.sameValue(update.value, access.read(field)))
      return "rejected";
  }
  return "accepted";
}

/** The typed record a view presents, or undefined for any other object. */
export function typedRecordOf(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
): unknown {
  const recordOf = object.internalMethods?.typedRecord;
  return recordOf === undefined ? undefined : recordOf();
}

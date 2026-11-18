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

/** One field of a typed (native) record as a JavaScript property. `read`
 * returns the field's current value as a JavaScript value; `write` stores a
 * JavaScript value into the field, throwing a TypeError when the value is
 * outside the field's declared type (an enforced contract). */
export interface RecordViewField {
  readonly key: string;
  readonly writable: boolean;
  readonly read: () => unknown;
  readonly write: (value: unknown) => void;
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
  fields: readonly RecordViewField[],
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const index = new Map<string, RecordViewField>();
  for (const field of fields) {
    if (field === undefined) throw "RECORD_VIEW_FIELD_INVARIANT";
    if (index.has(field.key)) throw "RECORD_VIEW_DUPLICATE_FIELD";
    index.set(field.key, field);
  }
  function fieldFor(key: ScriptPropertyKey): RecordViewField | undefined {
    return typeof key === "string" ? index.get(key) : undefined;
  }
  const methods: ObjectInternalMethods<ScriptPropertyKey, unknown> = {
    typedRecord: record,
    getOwnProperty: (
      object: OrdinaryObject<ScriptPropertyKey, unknown>,
      key: ScriptPropertyKey,
    ): Descriptor<unknown> | undefined => {
      const field = fieldFor(key);
      if (field === undefined)
        return ordinaryGetOwnProperty<ScriptPropertyKey, unknown>(object, key);
      return {
        accessor: false,
        value: field.read(),
        writable: field.writable,
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
      if (field === undefined)
        return ordinaryDefineOwnProperty<ScriptPropertyKey, unknown>(
          object,
          key,
          update,
          hooks,
        );
      return defineField(field, update, hooks);
    },
    deleteProperty: (
      object: OrdinaryObject<ScriptPropertyKey, unknown>,
      key: ScriptPropertyKey,
    ): boolean =>
      fieldFor(key) === undefined &&
      ordinaryDeleteProperty<ScriptPropertyKey, unknown>(object, key),
    ownKeys: (
      object: OrdinaryObject<ScriptPropertyKey, unknown>,
    ): ScriptPropertyKey[] => {
      // Fields are created first: integer-like names lead in ascending
      // order, other names follow in declaration order, then expandos.
      const indices: string[] = [],
        names: string[] = [];
      for (const field of fields) {
        if (field === undefined) throw "RECORD_VIEW_FIELD_INVARIANT";
        if (scriptPropertyKeyOrder(field.key) >= 0) indices.push(field.key);
        else names.push(field.key);
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
      // Expando array indices interleave with field indices by value.
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
  field: RecordViewField,
  update: DescriptorUpdate<unknown>,
  hooks: ObjectHooks<unknown>,
): PropertyDefinitionResult {
  if ((update.fields & (getField | setField)) !== 0) return "rejected";
  if ((update.fields & enumerableField) !== 0 && !update.enumerable)
    return "rejected";
  if ((update.fields & configurableField) !== 0 && !update.configurable)
    return "rejected";
  if (
    (update.fields & writableField) !== 0 &&
    update.writable !== field.writable
  )
    return "rejected";
  if ((update.fields & valueField) !== 0) {
    if (field.writable) field.write(update.value);
    else if (!hooks.sameValue(update.value, field.read())) return "rejected";
  }
  return "accepted";
}

/** The typed record a view presents, or undefined for any other object. */
export function typedRecordOf(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
): unknown {
  return object.internalMethods?.typedRecord;
}

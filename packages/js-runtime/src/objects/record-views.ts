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

interface RecordViewMeta {
  readonly keys: readonly string[];
  readonly noToJSON: boolean;
  readonly noIntegerKeys: boolean;
  readonly index: Map<string, number> | undefined;
}

let cachedMeta0: RecordViewMeta | undefined = undefined;
let cachedMeta1: RecordViewMeta | undefined = undefined;
let cachedMeta2: RecordViewMeta | undefined = undefined;
let cachedMeta3: RecordViewMeta | undefined = undefined;

function recordViewMeta(keys: readonly string[]): RecordViewMeta {
  if (cachedMeta0 !== undefined && cachedMeta0.keys === keys)
    return cachedMeta0;
  if (cachedMeta1 !== undefined && cachedMeta1.keys === keys)
    return cachedMeta1;
  if (cachedMeta2 !== undefined && cachedMeta2.keys === keys)
    return cachedMeta2;
  if (cachedMeta3 !== undefined && cachedMeta3.keys === keys)
    return cachedMeta3;
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
  const meta: RecordViewMeta = { keys, noToJSON, noIntegerKeys, index };
  cachedMeta3 = cachedMeta2;
  cachedMeta2 = cachedMeta1;
  cachedMeta1 = cachedMeta0;
  cachedMeta0 = meta;
  return meta;
}

function recordViewFieldFor(
  methods: ObjectInternalMethods<ScriptPropertyKey, unknown>,
  key: ScriptPropertyKey,
): number {
  if (typeof key !== "string") return -1;
  const access = methods.recordViewAccess;
  if (access === undefined) return -1;
  const keys = access.keys;
  const fieldCount = keys.length;
  if (fieldCount > 8) {
    const index = recordViewMeta(keys).index;
    if (index !== undefined) return index.get(key) ?? -1;
  }
  for (let i = 0; i < fieldCount; i++) {
    if (keys[i] === key) return i;
  }
  return -1;
}

function recordViewGetOwnProperty(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  key: ScriptPropertyKey,
): Descriptor<unknown> | undefined {
  const methods = object.internalMethods;
  const access = methods === undefined ? undefined : methods.recordViewAccess;
  if (methods === undefined || access === undefined)
    return ordinaryGetOwnProperty<ScriptPropertyKey, unknown>(object, key);
  const field = recordViewFieldFor(methods, key);
  if (field < 0)
    return ordinaryGetOwnProperty<ScriptPropertyKey, unknown>(object, key);
  const mask = methods.recordViewWritableMask ?? 0;
  return {
    accessor: false,
    value: access.read(field),
    writable: ((mask >>> field) & 1) !== 0,
    get: undefined,
    set: undefined,
    enumerable: true,
    configurable: true,
  };
}

function recordViewDefineOwnProperty(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  key: ScriptPropertyKey,
  update: DescriptorUpdate<unknown>,
  hooks: ObjectHooks<unknown>,
): PropertyDefinitionResult {
  const methods = object.internalMethods;
  const access = methods === undefined ? undefined : methods.recordViewAccess;
  if (methods === undefined || access === undefined)
    return ordinaryDefineOwnProperty<ScriptPropertyKey, unknown>(
      object,
      key,
      update,
      hooks,
    );
  const field = recordViewFieldFor(methods, key);
  if (field < 0)
    return ordinaryDefineOwnProperty<ScriptPropertyKey, unknown>(
      object,
      key,
      update,
      hooks,
    );
  const mask = methods.recordViewWritableMask ?? 0;
  const writable = ((mask >>> field) & 1) !== 0;
  return defineField(
    access.read,
    methods.recordViewWrite,
    field,
    writable,
    update,
    hooks,
  );
}

function recordViewDeleteProperty(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  key: ScriptPropertyKey,
): boolean {
  const methods = object.internalMethods;
  if (methods !== undefined && recordViewFieldFor(methods, key) >= 0)
    return false;
  return ordinaryDeleteProperty<ScriptPropertyKey, unknown>(object, key);
}

function recordViewOwnKeys(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
): ScriptPropertyKey[] {
  const access = object.internalMethods?.recordViewAccess;
  if (access === undefined)
    return ordinaryOwnKeys<ScriptPropertyKey, unknown>(
      object,
      scriptPropertyKeyOrder,
    );
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
  const meta = recordViewMeta(keys);
  if (fieldCount <= 32) {
    let writableMask = 0;
    const writableFlags = access.writable;
    for (let i = 0; i < fieldCount; i++) {
      if (writableFlags[i] === true) writableMask |= 1 << i;
    }
    const methods: ObjectInternalMethods<ScriptPropertyKey, unknown> = {
      typedView: { value: record },
      recordViewWritableMask: writableMask,
      recordViewWrite: access.write,
      recordViewAccess: access,
      recordViewNoToJSON: meta.noToJSON,
      recordViewNoIntegerKeys: meta.noIntegerKeys,
      getOwnProperty: recordViewGetOwnProperty,
      defineOwnProperty: recordViewDefineOwnProperty,
      deleteProperty: recordViewDeleteProperty,
      ownKeys: recordViewOwnKeys,
    };
    return createExoticObject<ScriptPropertyKey, unknown>(prototype, methods);
  }
  const index = meta.index;
  function fieldFor(key: ScriptPropertyKey): number {
    if (typeof key !== "string") return -1;
    if (index !== undefined) return index.get(key) ?? -1;
    for (let i = 0; i < fieldCount; i++) {
      if (keys[i] === key) return i;
    }
    return -1;
  }
  const methods: ObjectInternalMethods<ScriptPropertyKey, unknown> = {
    typedView: { value: record },
    recordViewAccess: access,
    recordViewNoToJSON: meta.noToJSON,
    recordViewNoIntegerKeys: meta.noIntegerKeys,
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
        writable: access.writable[field] === true,
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
      return defineField(
        access.read,
        access.write,
        field,
        access.writable[field] === true,
        update,
        hooks,
      );
    },
    deleteProperty: recordViewDeleteProperty,
    ownKeys: recordViewOwnKeys,
  };
  return createExoticObject<ScriptPropertyKey, unknown>(prototype, methods);
}

/** A field accepts a definition that keeps it an enumerable, configurable
 * data property with its writability, and stores a supplied value through
 * the field (a read-only field accepts only its current value). */
function defineField(
  read: (field: number) => unknown,
  write: ((field: number, value: unknown) => void) | undefined,
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
    if (writable) {
      if (write === undefined) return "rejected";
      write(field, update.value);
    } else if (!hooks.sameValue(update.value, read(field))) return "rejected";
  }
  return "accepted";
}

/** The typed record a view presents, or undefined for any other object. */
export function typedRecordOf(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
): unknown {
  const methods = object.internalMethods;
  if (methods === undefined) return undefined;
  const view = methods.typedView;
  if (view !== undefined) return view.value;
  const recordOf = methods.typedRecord;
  return recordOf === undefined ? undefined : recordOf();
}

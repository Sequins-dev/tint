import {
  acceptsPropertyContract,
  attachPropertyContract,
  getOwnProperty,
  ordinaryHasOwnProperty,
  ownKeys,
  shapeKeyIndex,
  storedValue,
  type OrdinaryObject,
  type PropertyWriteContract,
  objectFlagArrayData,
  objectFlagDictionary,
  propertyAccessor,
} from "./operations.ts";
import { arrayElementCount, readArrayElement } from "./array-elements.ts";
import type { Descriptor } from "../descriptors/index.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  acceptsPrimitiveContract,
  callObjectValue,
  checkPrimitiveContract,
  checkPrimitiveRestArguments,
  isArrayValue,
  viewObjectValue,
} from "./values.ts";
import { viewBigIntValue } from "./bigints.ts";
import {
  scriptPropertyKeyOrder,
  viewSymbolValue,
  type ScriptPropertyKey,
} from "./symbols.ts";

export interface ContractField {
  readonly name: string;
  readonly value: number;
  readonly required: boolean;
  readonly readonly: boolean;
}
export interface IndexedObjectRule {
  readonly kind: "object";
  readonly stringIndex: number;
  readonly readonlyIndex: boolean;
  readonly fields: readonly ContractField[];
}
export type PropertyValueRule =
  | IndexedObjectRule
  | {
      readonly kind: "class-field";
      readonly name: ScriptPropertyKey;
      readonly allowed: number;
    }
  | {
      readonly kind: "class-method";
      readonly name: ScriptPropertyKey;
      readonly call: ClassMethodContract;
    }
  | {
      readonly kind: "array-elements";
      readonly element: number;
      readonly readonly: boolean;
    }
  | { readonly kind: "union"; readonly members: readonly number[] }
  | { readonly kind: "literal"; readonly value: string | number | boolean }
  | {
      readonly kind:
        | "array"
        | "number"
        | "string"
        | "boolean"
        | "null"
        | "undefined"
        | "bigint"
        | "unknown"
        | "never";
    };
export interface ObjectShapeContract {
  readonly types: readonly PropertyValueRule[];
  readonly root: number;
  subSchemas?: ObjectShapeContract[] | undefined;
  canonicalId?: number | undefined;
  unionMask?: number | undefined;
  unionObjectMember?: ObjectShapeContract | undefined;
  cachedRealm?: ErrorRealm | undefined;
  cachedContract?:
    PropertyWriteContract<ScriptPropertyKey, unknown> | undefined;
  cachedInitContract?:
    PropertyWriteContract<ScriptPropertyKey, unknown> | undefined;
}
export interface ClassMethodContract {
  readonly parameters: readonly number[];
  readonly rest: number;
  readonly result: number;
}
type ObjectRecord = OrdinaryObject<ScriptPropertyKey, unknown>;
interface PendingList {
  readonly objects: ObjectRecord[];
  readonly schemas: ObjectShapeContract[];
}
const scratchPending: PendingList = { objects: [], schemas: [] };
let scratchInUse = false;

function acquirePending(): PendingList {
  if (!scratchInUse) {
    scratchInUse = true;
    scratchPending.objects.length = 0;
    scratchPending.schemas.length = 0;
    return scratchPending;
  }
  return { objects: [], schemas: [] };
}

function releasePending(list: PendingList): void {
  if (list === scratchPending) {
    scratchPending.objects.length = 0;
    scratchPending.schemas.length = 0;
    scratchInUse = false;
  }
}

function subSchema(
  schema: ObjectShapeContract,
  index: number,
): ObjectShapeContract {
  let table = schema.subSchemas;
  if (table === undefined) {
    table = [];
    for (let i = 0; i < schema.types.length; i++) {
      table.push(
        i === schema.root
          ? schema
          : { types: schema.types, root: i, subSchemas: table },
      );
    }
    schema.subSchemas = table;
  }
  const existing = table[index];
  if (existing === undefined) throw "PROPERTY_CONTRACT_SUBSCHEMA_INVARIANT";
  return existing;
}

function reject(realm: ErrorRealm): never {
  const context = realm.agent.activeContext;
  throw createRuntimeError(
    context === undefined ? realm : context.realm,
    "type",
  );
}
function fieldFor(
  rule: IndexedObjectRule,
  key: string,
): ContractField | undefined {
  for (const field of rule.fields) {
    if (field === undefined) throw "PROPERTY_CONTRACT_FIELD_INVARIANT";
    if (field.name === key) return field;
  }
  return undefined;
}
let schemaIds: Map<string, number> | undefined = undefined;
let nextSchemaId = 1;

function sortStrings(items: string[]): void {
  for (let i = 1; i < items.length; i++) {
    const current = items[i];
    if (current === undefined) continue;
    let j = i - 1;
    while (j >= 0) {
      const prev = items[j];
      if (prev === undefined || prev <= current) break;
      items[j + 1] = prev;
      j--;
    }
    items[j + 1] = current;
  }
}

function canonicalSchemaKey(
  types: readonly PropertyValueRule[],
  root: number,
): string | undefined {
  const visited: number[] = [];
  for (let i = 0; i < types.length; i++) visited.push(-1);
  let nextVisit = 0;
  let uncanonical = false;
  function encode(index: number): string {
    if (index < 0) return "-";
    const seen = visited[index];
    if (seen !== undefined && seen >= 0) return "@" + String(seen);
    const rule = types[index];
    if (rule === undefined) throw "PROPERTY_CONTRACT_VALUE_INVARIANT";
    if (rule.kind === "class-field" || rule.kind === "class-method") {
      uncanonical = true;
      return "";
    }
    const visit = nextVisit++;
    visited[index] = visit;
    switch (rule.kind) {
      case "object": {
        let out =
          "O(" +
          encode(rule.stringIndex) +
          "," +
          (rule.readonlyIndex ? "1" : "0") +
          ",";
        const fields = rule.fields;
        if (fields.length > 0) {
          const encodedFields: string[] = [];
          for (let i = 0; i < fields.length; i++) {
            const f = fields[i];
            if (f === undefined) throw "PROPERTY_CONTRACT_FIELD_INVARIANT";
            encodedFields.push(
              String(f.name.length) +
                ":" +
                f.name +
                ":" +
                (f.required ? "1" : "0") +
                (f.readonly ? "1" : "0") +
                ":" +
                encode(f.value),
            );
          }
          if (encodedFields.length > 1) sortStrings(encodedFields);
          out += encodedFields.join(";");
        }
        return out + ")";
      }
      case "array-elements":
        return (
          "A(" + (rule.readonly ? "1" : "0") + "," + encode(rule.element) + ")"
        );
      case "union": {
        const members: string[] = [];
        for (let i = 0; i < rule.members.length; i++) {
          const m = rule.members[i];
          if (m === undefined) throw "PROPERTY_CONTRACT_MEMBER_INVARIANT";
          members.push(encode(m));
        }
        if (members.length > 1) sortStrings(members);
        return "U(" + members.join(",") + ")";
      }
      case "literal": {
        const v = rule.value;
        return typeof v === "string"
          ? "L(s:" + v + ")"
          : typeof v === "number"
            ? "L(n:" + String(v) + ")"
            : v
              ? "L(b:1)"
              : "L(b:0)";
      }
      default:
        return "P(" + rule.kind + ")";
    }
  }
  const key = encode(root);
  return uncanonical ? undefined : key;
}

function ensureSchemaId(schema: ObjectShapeContract): number {
  const existing = schema.canonicalId;
  if (existing !== undefined) return existing;
  const key = canonicalSchemaKey(schema.types, schema.root);
  if (key === undefined) {
    const unique = nextSchemaId++;
    schema.canonicalId = unique;
    return unique;
  }
  let table = schemaIds;
  if (table === undefined) {
    table = new Map<string, number>();
    schemaIds = table;
  }
  const known = table.get(key);
  if (known !== undefined) {
    schema.canonicalId = known;
    return known;
  }
  const created = nextSchemaId++;
  table.set(key, created);
  schema.canonicalId = created;
  return created;
}

function sameSchema(
  left: ObjectShapeContract,
  right: ObjectShapeContract,
): boolean {
  if (left === right) return true;
  if (left.types === right.types && left.root === right.root) return true;
  return ensureSchemaId(left) === ensureSchemaId(right);
}
function attached(object: ObjectRecord, schema: ObjectShapeContract): boolean {
  const rare = object.internalRareSlots;
  const contract =
    rare === undefined ? undefined : rare.internalPropertyContract;
  if (contract === undefined) return false;
  const schemas = contract.schemas;
  for (let i = 0; i < schemas.length; i++) {
    const existing = schemas[i];
    if (existing !== undefined && sameSchema(existing, schema)) return true;
  }
  return false;
}
function requiredFieldsPresent(
  object: ObjectRecord,
  rule: IndexedObjectRule,
): boolean {
  for (const field of rule.fields) {
    if (field === undefined) throw "PROPERTY_CONTRACT_FIELD_INVARIANT";
    if (!field.required) continue;
    const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(
      object,
      field.name,
    );
    if (descriptor === undefined || descriptor.accessor) return false;
  }
  return true;
}

function validateObject(
  object: ObjectRecord,
  schema: ObjectShapeContract,
  pending: PendingList,
  realm: ErrorRealm,
): boolean {
  if (!acceptsPropertyContract<ScriptPropertyKey, unknown>(object))
    return false;
  if (attached(object, schema)) return true;
  const pendingObjects = pending.objects,
    pendingSchemas = pending.schemas;
  for (let i = 0; i < pendingObjects.length; i++) {
    if (pendingObjects[i] === object) {
      const seen = pendingSchemas[i];
      if (seen !== undefined && sameSchema(seen, schema)) return true;
    }
  }
  const rule = schema.types[schema.root];
  if (rule?.kind === "object") {
    if ((object.internalFlags & objectFlagArrayData) !== 0) return false;
    if (
      object.internalMethods === undefined &&
      object.internalArrayElements === undefined &&
      object.internalRareSlots?.internalContractedElements === undefined
    ) {
      if ((object.internalFlags & objectFlagDictionary) === 0) {
        const shape = object.internalShape;
        const fields = rule.fields;
        if (shape === undefined) {
          for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            if (field === undefined) throw "PROPERTY_CONTRACT_FIELD_INVARIANT";
            if (field.required) return false;
          }
          pendingObjects.push(object);
          pendingSchemas.push(schema);
          return true;
        }
        const kinds = shape.kinds;
        const keys = shape.keys;
        if (rule.stringIndex < 0) {
          pendingObjects.push(object);
          pendingSchemas.push(schema);
          for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            if (field === undefined) throw "PROPERTY_CONTRACT_FIELD_INVARIANT";
            const pos =
              keys[i] === field.name
                ? i
                : shapeKeyIndex<ScriptPropertyKey, unknown>(shape, field.name);
            if (pos < 0) {
              if (field.required) return false;
              continue;
            }
            if (((kinds[pos] ?? 0) & propertyAccessor) !== 0) return false;
            const raw = storedValue<ScriptPropertyKey, unknown>(object, pos);
            const value = raw === undefined ? shape.undefinedValue : raw;
            if (!validateValue(value, schema, field.value, pending, realm))
              return false;
          }
          return true;
        }
        for (let i = 0; i < fields.length; i++) {
          const field = fields[i];
          if (field === undefined) throw "PROPERTY_CONTRACT_FIELD_INVARIANT";
          if (!field.required) continue;
          const pos =
            keys[i] === field.name
              ? i
              : shapeKeyIndex<ScriptPropertyKey, unknown>(shape, field.name);
          if (pos < 0 || ((kinds[pos] ?? 0) & propertyAccessor) !== 0)
            return false;
        }
        pendingObjects.push(object);
        pendingSchemas.push(schema);
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          if (typeof key !== "string") continue;
          const field = fieldFor(rule, key);
          if (rule.stringIndex < 0 && field === undefined) continue;
          if (((kinds[i] ?? 0) & propertyAccessor) !== 0) return false;
          const raw = storedValue<ScriptPropertyKey, unknown>(object, i);
          const value = raw === undefined ? shape.undefinedValue : raw;
          if (
            rule.stringIndex >= 0 &&
            !validateValue(value, schema, rule.stringIndex, pending, realm)
          )
            return false;
          if (
            field !== undefined &&
            !validateValue(value, schema, field.value, pending, realm)
          )
            return false;
        }
        return true;
      }
      const props = object.internalRareSlots?.properties;
      const fields = rule.fields;
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (field === undefined) throw "PROPERTY_CONTRACT_FIELD_INVARIANT";
        if (!field.required) continue;
        const desc = props === undefined ? undefined : props.get(field.name);
        if (desc === undefined || desc.accessor) return false;
      }
      pendingObjects.push(object);
      pendingSchemas.push(schema);
      if (props !== undefined) {
        for (const [key, desc] of props) {
          if (typeof key !== "string") continue;
          const field = fieldFor(rule, key);
          if (rule.stringIndex < 0 && field === undefined) continue;
          if (desc.accessor) return false;
          if (
            rule.stringIndex >= 0 &&
            !validateValue(desc.value, schema, rule.stringIndex, pending, realm)
          )
            return false;
          if (
            field !== undefined &&
            !validateValue(desc.value, schema, field.value, pending, realm)
          )
            return false;
        }
      }
      return true;
    }
    if (!requiredFieldsPresent(object, rule)) return false;
  } else if (rule?.kind === "array-elements") {
    if ((object.internalFlags & objectFlagArrayData) === 0) return false;
    const packed =
      object.internalArrayElements ??
      object.internalRareSlots?.internalContractedElements;
    if (packed !== undefined) {
      pendingObjects.push(object);
      pendingSchemas.push(schema);
      const count = arrayElementCount<ScriptPropertyKey, unknown>(packed);
      if (count > 0) {
        if (packed.generalCount === 0) {
          const elemRule = schema.types[rule.element];
          if (elemRule === undefined) throw "PROPERTY_CONTRACT_VALUE_INVARIANT";
          if (elemRule.kind !== "number" && elemRule.kind !== "unknown") {
            const numbers = packed.numbers;
            for (let i = 0; i < count; i++) {
              if (
                !validateValue(numbers[i], schema, rule.element, pending, realm)
              )
                return false;
            }
          }
        } else {
          for (let i = 0; i < count; i++) {
            const elem = readArrayElement<ScriptPropertyKey, unknown>(
              packed,
              i,
            );
            if (!validateValue(elem, schema, rule.element, pending, realm))
              return false;
          }
        }
      }
      const props = object.internalRareSlots?.properties;
      if (props !== undefined) {
        for (const [key, desc] of props) {
          if (!validateDescriptor(key, desc, schema, pending, realm, false))
            return false;
        }
      }
      return true;
    }
    const props = object.internalRareSlots?.properties;
    if (props !== undefined) {
      pendingObjects.push(object);
      pendingSchemas.push(schema);
      for (const [key, desc] of props) {
        if (!validateDescriptor(key, desc, schema, pending, realm, false))
          return false;
      }
      return true;
    }
  } else return false;
  pendingObjects.push(object);
  pendingSchemas.push(schema);
  for (const key of ownKeys<ScriptPropertyKey, unknown>(
    object,
    scriptPropertyKeyOrder,
  )) {
    if (key === undefined) throw "contract key invariant";
    const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(object, key);
    if (descriptor === undefined) throw "contract descriptor invariant";
    if (!validateDescriptor(key, descriptor, schema, pending, realm, false))
      return false;
  }
  return true;
}
function validateValue(
  value: unknown,
  parent: ObjectShapeContract,
  index: number,
  pending: PendingList,
  realm: ErrorRealm,
): boolean {
  const rule = parent.types[index];
  if (rule === undefined) throw "PROPERTY_CONTRACT_VALUE_INVARIANT";
  switch (rule.kind) {
    case "array":
      return isArrayValue(value, realm);
    case "unknown":
      return (
        value === null ||
        typeof value !== "object" ||
        viewObjectValue(value, realm.objectPrototype) !== undefined ||
        viewBigIntValue(value) !== undefined ||
        viewSymbolValue(value) !== undefined
      );
    case "never":
      return false;
    case "null":
      return value === null;
    case "undefined":
      return value === undefined;
    case "literal":
      return value === rule.value;
    case "number":
    case "string":
    case "boolean":
      return typeof value === rule.kind;
    case "bigint":
      return viewBigIntValue(value) !== undefined;
    case "array-elements":
    case "object": {
      const object = viewObjectValue(value, realm.objectPrototype);
      return (
        object !== undefined &&
        validateObject(object, subSchema(parent, index), pending, realm)
      );
    }
    case "union": {
      const before = pending.objects.length;
      for (const member of rule.members) {
        if (member === undefined) throw "PROPERTY_CONTRACT_MEMBER_INVARIANT";
        if (validateValue(value, parent, member, pending, realm)) return true;
        pending.objects.length = before;
        pending.schemas.length = before;
      }
      return false;
    }
  }
  throw "PROPERTY_CONTRACT_KIND_INVARIANT";
}
function validateDescriptor(
  key: ScriptPropertyKey,
  descriptor: Descriptor<unknown>,
  schema: ObjectShapeContract,
  pending: PendingList,
  realm: ErrorRealm,
  modifyingValue: boolean,
): boolean {
  const rule = schema.types[schema.root];
  if (rule?.kind === "class-method") return true;
  if (rule?.kind === "class-field")
    return (
      key !== rule.name ||
      (!descriptor.accessor &&
        (!modifyingValue ||
          acceptsPrimitiveContract(descriptor.value, rule.allowed)))
    );
  if (typeof key !== "string") return true;
  if (rule?.kind === "array-elements") {
    if (scriptPropertyKeyOrder(key) < 0)
      return key !== "length" || !rule.readonly || !modifyingValue;
    return (
      !descriptor.accessor &&
      (!modifyingValue || !rule.readonly) &&
      validateValue(descriptor.value, schema, rule.element, pending, realm)
    );
  }
  if (rule?.kind !== "object") throw "PROPERTY_CONTRACT_ROOT_INVARIANT";
  const field = fieldFor(rule, key);
  if (rule.stringIndex < 0 && field === undefined) return true;
  if (
    descriptor.accessor ||
    (modifyingValue && (rule.readonlyIndex || field?.readonly === true))
  )
    return false;
  return (
    (rule.stringIndex < 0 ||
      validateValue(
        descriptor.value,
        schema,
        rule.stringIndex,
        pending,
        realm,
      )) &&
    (field === undefined ||
      validateValue(descriptor.value, schema, field.value, pending, realm))
  );
}
function buildSingleSchemaContract(
  schema: ObjectShapeContract,
  realm: ErrorRealm,
  initializing: boolean,
): PropertyWriteContract<ScriptPropertyKey, unknown> {
  const schemas: readonly ObjectShapeContract[] = [schema];
  const rule = schema.types[schema.root];
  if (
    rule?.kind === "object" &&
    rule.fields.length === 0 &&
    rule.stringIndex >= 0 &&
    !rule.readonlyIndex
  ) {
    const indexRule = schema.types[rule.stringIndex];
    if (
      indexRule !== undefined &&
      (indexRule.kind === "number" ||
        indexRule.kind === "string" ||
        indexRule.kind === "boolean")
    ) {
      const expected = indexRule.kind;
      return {
        schemas,
        beforeDefine: (key, descriptor, _writesValue): void => {
          if (typeof key !== "string") return;
          if (descriptor.accessor || typeof descriptor.value !== expected)
            reject(realm);
        },
        canDelete: (_key): boolean => true,
      };
    }
  }
  if (rule?.kind === "array-elements" && !rule.readonly) {
    const elemRule = schema.types[rule.element];
    if (
      elemRule !== undefined &&
      (elemRule.kind === "number" ||
        elemRule.kind === "string" ||
        elemRule.kind === "boolean")
    ) {
      const expected = elemRule.kind;
      return {
        schemas,
        beforeDefine: (key, descriptor, _writesValue): void => {
          if (typeof key !== "string" || scriptPropertyKeyOrder(key) < 0)
            return;
          if (descriptor.accessor || typeof descriptor.value !== expected)
            reject(realm);
        },
        canDelete: (_key): boolean => true,
      };
    }
  }
  return {
    schemas,
    beforeDefine: (key, descriptor, writesValue): void => {
      const pending = acquirePending();
      try {
        if (
          !validateDescriptor(
            key,
            descriptor,
            schema,
            pending,
            realm,
            !initializing && writesValue,
          )
        )
          reject(realm);
        if (pending.objects.length > 0) commit(pending, realm);
      } finally {
        releasePending(pending);
      }
    },
    canDelete: (key): boolean => {
      if (rule?.kind === "class-method") return true;
      if (rule?.kind === "class-field") return key !== rule.name;
      if (typeof key !== "string") return true;
      if (rule?.kind === "array-elements")
        return !(rule.readonly && scriptPropertyKeyOrder(key) >= 0);
      if (rule?.kind !== "object") throw "PROPERTY_CONTRACT_ROOT_INVARIANT";
      const field = fieldFor(rule, key);
      return !(
        rule.readonlyIndex ||
        field?.required === true ||
        field?.readonly === true
      );
    },
  };
}
function singleSchemaContract(
  schema: ObjectShapeContract,
  realm: ErrorRealm,
  initializing: boolean,
): PropertyWriteContract<ScriptPropertyKey, unknown> {
  if (schema.cachedRealm === realm) {
    const existing = initializing
      ? schema.cachedInitContract
      : schema.cachedContract;
    if (existing !== undefined) return existing;
  } else {
    schema.cachedRealm = realm;
    schema.cachedContract = undefined;
    schema.cachedInitContract = undefined;
  }
  const created = buildSingleSchemaContract(schema, realm, initializing);
  if (initializing) schema.cachedInitContract = created;
  else schema.cachedContract = created;
  return created;
}
function publishSingle(
  object: ObjectRecord,
  schema: ObjectShapeContract,
  realm: ErrorRealm,
  initializing: boolean,
): void {
  const kind = schema.types[schema.root]?.kind;
  const allowCallable = kind === "class-field" || kind === "class-method";
  attachPropertyContract<ScriptPropertyKey, unknown>(
    object,
    singleSchemaContract(schema, realm, initializing),
    allowCallable,
  );
}
function publish(
  object: ObjectRecord,
  schemas: readonly ObjectShapeContract[],
  realm: ErrorRealm,
  initializing: boolean,
): void {
  if (schemas.length === 1) {
    const only = schemas[0];
    if (only !== undefined) {
      publishSingle(object, only, realm, initializing);
      return;
    }
  }
  let allowCallable = false;
  for (let i = 0; i < schemas.length; i++) {
    const schema = schemas[i];
    if (schema === undefined) continue;
    const kind = schema.types[schema.root]?.kind;
    if (kind === "class-field" || kind === "class-method") {
      allowCallable = true;
      break;
    }
  }
  attachPropertyContract<ScriptPropertyKey, unknown>(
    object,
    {
      schemas,
      beforeDefine: (key, descriptor, writesValue): void => {
        const pending = acquirePending();
        try {
          for (const schema of schemas) {
            if (schema === undefined)
              throw "PROPERTY_CONTRACT_SCHEMA_INVARIANT";
            if (
              !validateDescriptor(
                key,
                descriptor,
                schema,
                pending,
                realm,
                !initializing && writesValue,
              )
            )
              reject(realm);
          }
          if (pending.objects.length > 0) commit(pending, realm);
        } finally {
          releasePending(pending);
        }
      },
      canDelete: (key): boolean => {
        for (const schema of schemas) {
          if (schema === undefined) throw "PROPERTY_CONTRACT_SCHEMA_INVARIANT";
          const rule = schema.types[schema.root];
          if (rule?.kind === "class-method") continue;
          if (rule?.kind === "class-field") {
            if (key === rule.name) return false;
            continue;
          }
          if (typeof key !== "string") continue;
          if (rule?.kind === "array-elements") {
            if (rule.readonly && scriptPropertyKeyOrder(key) >= 0) return false;
            continue;
          }
          if (rule?.kind !== "object") throw "PROPERTY_CONTRACT_ROOT_INVARIANT";
          const field = fieldFor(rule, key);
          if (
            rule.readonlyIndex ||
            field?.required === true ||
            field?.readonly === true
          )
            return false;
        }
        return true;
      },
    },
    allowCallable,
  );
}

/** A class field already owns its initialized descriptor. A declaration
 * without an initializer may hold undefined until the constructor writes. */
export function attachClassFieldContract(
  object: ObjectRecord,
  name: ScriptPropertyKey,
  allowed: number,
  realm: ErrorRealm,
): void {
  if (!acceptsPropertyContract<ScriptPropertyKey, unknown>(object, true))
    reject(realm);
  const schema: ObjectShapeContract = {
    types: [{ kind: "class-field", name, allowed }],
    root: 0,
  };
  commitOne(object, schema, realm);
}

export function attachClassMethodContract(
  object: ObjectRecord,
  name: ScriptPropertyKey,
  call: ClassMethodContract,
  realm: ErrorRealm,
): void {
  if (!acceptsPropertyContract<ScriptPropertyKey, unknown>(object, true))
    reject(realm);
  const schema: ObjectShapeContract = {
    types: [{ kind: "class-method", name, call }],
    root: 0,
  };
  commitOne(object, schema, realm);
}

/** Lookup on ordinary storage mirrors the completed member reference. The
 * method object itself is left unchanged so aliases and decorators retain it. */
export function findClassMethodContract(
  base: unknown,
  key: ScriptPropertyKey,
  realm: ErrorRealm,
): ClassMethodContract | undefined {
  let cursor = viewObjectValue(base, realm.objectPrototype);
  while (cursor !== undefined && cursor.internalMethods === undefined) {
    if (ordinaryHasOwnProperty<ScriptPropertyKey, unknown>(cursor, key)) {
      const rare = cursor.internalRareSlots;
      const contract =
        rare === undefined ? undefined : rare.internalPropertyContract;
      const schemas = contract === undefined ? undefined : contract.schemas;
      for (const schema of schemas ?? []) {
        if (schema === undefined) throw "PROPERTY_CONTRACT_SCHEMA_INVARIANT";
        const rule = schema.types[schema.root];
        if (rule?.kind === "class-method" && rule.name === key)
          return rule.call;
      }
      return undefined;
    }
    cursor = cursor.prototype;
  }
  return undefined;
}

export function callWithClassMethodContract(
  method: unknown,
  receiver: unknown,
  args: readonly unknown[],
  contract: ClassMethodContract | undefined,
  realm: ErrorRealm,
): { readonly error: "none" | "type"; readonly value: unknown } {
  if (contract !== undefined) {
    const parameters = contract.parameters;
    const rest = contract.rest;
    for (let i = 0; i < parameters.length; i++) {
      const allowed = parameters[i] ?? 0;
      if (allowed !== 0) checkPrimitiveContract(realm, args[i], allowed);
    }
    if (rest !== 0)
      checkPrimitiveRestArguments(realm, args, parameters.length, rest);
  }
  const completed = callObjectValue(
    method,
    receiver,
    args,
    realm.objectPrototype,
  );
  if (
    completed.error === "none" &&
    contract !== undefined &&
    contract.result !== 0
  )
    checkPrimitiveContract(realm, completed.value, contract.result);
  return completed;
}
function commitOne(
  object: ObjectRecord,
  schema: ObjectShapeContract,
  realm: ErrorRealm,
): void {
  if (attached(object, schema)) return;
  const rare = object.internalRareSlots;
  const existing =
    rare === undefined ? undefined : rare.internalPropertyContract;
  if (existing === undefined) {
    publishSingle(object, schema, realm, false);
    return;
  }
  const schemas: ObjectShapeContract[] = existing.schemas.slice();
  schemas.push(schema);
  publish(object, schemas, realm, false);
}
function commit(pending: PendingList, realm: ErrorRealm): void {
  const objects = pending.objects,
    schemas = pending.schemas;
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i],
      schema = schemas[i];
    if (object === undefined || schema === undefined)
      throw "PROPERTY_CONTRACT_ENROLLMENT_INVARIANT";
    commitOne(object, schema, realm);
  }
}
/** Side-effect-free admission until every reachable own descriptor has passed. */
export function enrollObjectPropertyContract(
  object: ObjectRecord,
  schema: ObjectShapeContract,
  realm: ErrorRealm,
): void {
  const pending = acquirePending();
  try {
    if (!validateObject(object, schema, pending, realm)) reject(realm);
    if (pending.objects.length > 0) commit(pending, realm);
  } finally {
    releasePending(pending);
  }
}
/** The literal is fresh and unpublished. It may initialize readonly keys. */
export function beginObjectPropertyContract(
  object: ObjectRecord,
  schema: ObjectShapeContract,
  realm: ErrorRealm,
): void {
  publishSingle(object, schema, realm, true);
}
export function finishObjectPropertyContract(
  object: ObjectRecord,
  schema: ObjectShapeContract,
  realm: ErrorRealm,
): void {
  const rule = schema.types[schema.root];
  if (rule?.kind === "object" && !requiredFieldsPresent(object, rule))
    reject(realm);
  publishSingle(object, schema, realm, false);
}
/** Validate the live result of a property read without enrolling its receiver. */
export function projectPropertyContract(
  value: unknown,
  schema: ObjectShapeContract,
  realm: ErrorRealm,
  enroll: boolean = false,
): unknown {
  const root = schema.types[schema.root];
  if (root !== undefined) {
    if (root.kind === "unknown") return value;
    if (root.kind === "boolean") {
      if (typeof value !== "boolean") reject(realm);
      return value;
    }
    if (root.kind === "number") {
      if (typeof value !== "number") reject(realm);
      return value;
    }
    if (root.kind === "string") {
      if (typeof value !== "string") reject(realm);
      return value;
    }
    if (root.kind === "null") {
      if (value !== null) reject(realm);
      return value;
    }
    if (root.kind === "undefined") {
      if (value !== undefined) reject(realm);
      return value;
    }
    if (root.kind === "object" || root.kind === "array-elements") {
      const obj = viewObjectValue(value, realm.objectPrototype);
      if (obj !== undefined && attached(obj, schema)) return value;
    }
    if (root.kind === "union") {
      let mask = schema.unionMask;
      if (mask === undefined) {
        let computed = 0;
        let objectMember: ObjectShapeContract | undefined = undefined;
        let objectCount = 0;
        const members = root.members;
        for (let i = 0; i < members.length; i++) {
          const memberIndex = members[i];
          if (memberIndex === undefined) continue;
          const m = schema.types[memberIndex];
          if (m === undefined) continue;
          if (m.kind === "number") computed |= 1;
          else if (m.kind === "string") computed |= 2;
          else if (m.kind === "boolean") computed |= 4;
          else if (m.kind === "null") computed |= 8;
          else if (m.kind === "undefined") computed |= 16;
          else if (m.kind === "object" || m.kind === "array-elements") {
            objectCount++;
            if (objectCount === 1)
              objectMember = subSchema(schema, memberIndex);
            else objectMember = undefined;
          }
        }
        schema.unionMask = computed;
        schema.unionObjectMember = objectMember;
        mask = computed;
      }
      if (value === undefined) {
        if ((mask & 16) !== 0) return value;
      } else if (typeof value === "number") {
        if ((mask & 1) !== 0) return value;
      } else if (typeof value === "string") {
        if ((mask & 2) !== 0) return value;
      } else if (typeof value === "boolean") {
        if ((mask & 4) !== 0) return value;
      } else if (value === null) {
        if ((mask & 8) !== 0) return value;
      } else {
        const objMember = schema.unionObjectMember;
        if (objMember !== undefined) {
          const obj = viewObjectValue(value, realm.objectPrototype);
          if (obj !== undefined && attached(obj, objMember)) return value;
        }
      }
    }
  }
  const pending = acquirePending();
  try {
    if (!validateValue(value, schema, schema.root, pending, realm))
      reject(realm);
    if (enroll && pending.objects.length > 0) commit(pending, realm);
  } finally {
    releasePending(pending);
  }
  return value;
}

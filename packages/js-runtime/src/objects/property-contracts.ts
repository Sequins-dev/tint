import {
  acceptsPropertyContract,
  attachPropertyContract,
  type OrdinaryObject,
} from "./operations.ts";
import type { Descriptor } from "../descriptors/index.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { isArrayValue, viewObjectValue } from "./values.ts";
import { viewBigIntValue } from "./bigints.ts";
import { viewSymbolValue, type ScriptPropertyKey } from "./symbols.ts";

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
}
type ObjectRecord = OrdinaryObject<ScriptPropertyKey, unknown>;
interface Enrollment {
  readonly object: ObjectRecord;
  readonly schema: ObjectShapeContract;
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
function shape(schema: ObjectShapeContract): IndexedObjectRule {
  const rule = schema.types[schema.root];
  if (rule?.kind !== "object") throw "PROPERTY_CONTRACT_ROOT_INVARIANT";
  return rule;
}
function sameSchema(
  left: ObjectShapeContract,
  right: ObjectShapeContract,
): boolean {
  return left.types === right.types && left.root === right.root;
}
function attached(object: ObjectRecord, schema: ObjectShapeContract): boolean {
  const contract = object.internalPropertyContract;
  return (
    contract !== undefined &&
    contract.schemas.some(
      (existing) => existing !== undefined && sameSchema(existing, schema),
    )
  );
}
function requiredFieldsPresent(
  object: ObjectRecord,
  rule: IndexedObjectRule,
): boolean {
  for (const field of rule.fields) {
    if (field === undefined) throw "PROPERTY_CONTRACT_FIELD_INVARIANT";
    if (!field.required) continue;
    const descriptor = object.properties.get(field.name);
    if (descriptor === undefined || descriptor.accessor) return false;
  }
  return true;
}

function validateObject(
  object: ObjectRecord,
  schema: ObjectShapeContract,
  pending: Enrollment[],
  realm: ErrorRealm,
): boolean {
  if (!acceptsPropertyContract<ScriptPropertyKey, unknown>(object))
    return false;
  if (attached(object, schema)) return true;
  for (const item of pending) {
    if (item === undefined) throw "PROPERTY_CONTRACT_ENROLLMENT_INVARIANT";
    if (item.object === object && sameSchema(item.schema, schema)) return true;
  }
  const rule = shape(schema);
  if (!requiredFieldsPresent(object, rule)) return false;
  pending.push({ object, schema });
  for (const [key, descriptor] of object.properties) {
    if (!validateDescriptor(key, descriptor, schema, pending, realm, false))
      return false;
  }
  return true;
}
function validateValue(
  value: unknown,
  types: readonly PropertyValueRule[],
  index: number,
  pending: Enrollment[],
  realm: ErrorRealm,
): boolean {
  const rule = types[index];
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
    case "object": {
      const object = viewObjectValue(value, realm.objectPrototype);
      return (
        object !== undefined &&
        validateObject(object, { types, root: index }, pending, realm)
      );
    }
    case "union": {
      const before = pending.length;
      for (const member of rule.members) {
        if (member === undefined) throw "PROPERTY_CONTRACT_MEMBER_INVARIANT";
        if (validateValue(value, types, member, pending, realm)) return true;
        pending.length = before;
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
  pending: Enrollment[],
  realm: ErrorRealm,
  modifyingValue: boolean,
): boolean {
  if (typeof key !== "string") return true;
  const rule = shape(schema);
  const field = fieldFor(rule, key);
  if (
    descriptor.accessor ||
    (modifyingValue && (rule.readonlyIndex || field?.readonly === true))
  )
    return false;
  return (
    validateValue(
      descriptor.value,
      schema.types,
      rule.stringIndex,
      pending,
      realm,
    ) &&
    (field === undefined ||
      validateValue(
        descriptor.value,
        schema.types,
        field.value,
        pending,
        realm,
      ))
  );
}
function publish(
  object: ObjectRecord,
  schemas: readonly ObjectShapeContract[],
  realm: ErrorRealm,
  initializing: boolean,
): void {
  attachPropertyContract<ScriptPropertyKey, unknown>(object, {
    schemas,
    beforeDefine: (key, descriptor, writesValue): void => {
      const pending: Enrollment[] = [];
      for (const schema of schemas) {
        if (schema === undefined) throw "PROPERTY_CONTRACT_SCHEMA_INVARIANT";
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
      commit(pending, realm);
    },
    canDelete: (key): boolean => {
      if (typeof key !== "string") return true;
      for (const schema of schemas) {
        if (schema === undefined) throw "PROPERTY_CONTRACT_SCHEMA_INVARIANT";
        const rule = shape(schema);
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
  });
}
function commit(pending: readonly Enrollment[], realm: ErrorRealm): void {
  for (const item of pending) {
    if (item === undefined) throw "PROPERTY_CONTRACT_ENROLLMENT_INVARIANT";
    const object = item.object;
    if (attached(object, item.schema)) continue;
    const existing = object.internalPropertyContract;
    const schemas: ObjectShapeContract[] =
      existing === undefined ? [] : existing.schemas.slice();
    schemas.push(item.schema);
    publish(object, schemas, realm, false);
  }
}
/** Side-effect-free admission until every reachable own descriptor has passed. */
export function enrollObjectPropertyContract(
  object: ObjectRecord,
  schema: ObjectShapeContract,
  realm: ErrorRealm,
): void {
  const pending: Enrollment[] = [];
  if (!validateObject(object, schema, pending, realm)) reject(realm);
  commit(pending, realm);
}
/** The literal is fresh and unpublished. It may initialize readonly keys. */
export function beginObjectPropertyContract(
  object: ObjectRecord,
  schema: ObjectShapeContract,
  realm: ErrorRealm,
): void {
  publish(object, [schema], realm, true);
}
export function finishObjectPropertyContract(
  object: ObjectRecord,
  schema: ObjectShapeContract,
  realm: ErrorRealm,
): void {
  if (!requiredFieldsPresent(object, shape(schema))) reject(realm);
  publish(object, [schema], realm, false);
}
/** Validate the live result of a property read without enrolling its receiver. */
export function projectPropertyContract(
  value: unknown,
  schema: ObjectShapeContract,
  realm: ErrorRealm,
  enroll: boolean = false,
): unknown {
  const pending: Enrollment[] = [];
  if (!validateValue(value, schema.types, schema.root, pending, realm))
    reject(realm);
  if (enroll) commit(pending, realm);
  return value;
}

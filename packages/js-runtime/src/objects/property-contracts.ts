import {
  acceptsPropertyContract,
  attachPropertyContract,
  getOwnProperty,
  ordinaryHasOwnProperty,
  ownKeys,
  type OrdinaryObject,
  objectFlagArrayData,
} from "./operations.ts";
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
}
export interface ClassMethodContract {
  readonly parameters: readonly number[];
  readonly rest: number;
  readonly result: number;
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
function sameSchema(
  left: ObjectShapeContract,
  right: ObjectShapeContract,
): boolean {
  return left.types === right.types && left.root === right.root;
}
function attached(object: ObjectRecord, schema: ObjectShapeContract): boolean {
  const rare = object.internalRareSlots;
  const contract =
    rare === undefined ? undefined : rare.internalPropertyContract;
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
  const rule = schema.types[schema.root];
  if (rule?.kind === "object") {
    if (
      (object.internalFlags & objectFlagArrayData) !== 0 ||
      !requiredFieldsPresent(object, rule)
    )
      return false;
  } else if (
    rule?.kind !== "array-elements" ||
    (object.internalFlags & objectFlagArrayData) === 0
  )
    return false;
  pending.push({ object, schema });
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
    case "array-elements":
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
      validateValue(
        descriptor.value,
        schema.types,
        rule.element,
        pending,
        realm,
      )
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
        schema.types,
        rule.stringIndex,
        pending,
        realm,
      )) &&
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
  attachPropertyContract<ScriptPropertyKey, unknown>(
    object,
    {
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
    schemas.some((schema) => {
      const kind = schema.types[schema.root]?.kind;
      return kind === "class-field" || kind === "class-method";
    }),
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
  commit([{ object, schema }], realm);
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
  commit([{ object, schema }], realm);
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
function commit(pending: readonly Enrollment[], realm: ErrorRealm): void {
  for (const item of pending) {
    if (item === undefined) throw "PROPERTY_CONTRACT_ENROLLMENT_INVARIANT";
    const object = item.object;
    if (attached(object, item.schema)) continue;
    const rare = object.internalRareSlots;
    const existing =
      rare === undefined ? undefined : rare.internalPropertyContract;
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
  const rule = schema.types[schema.root];
  if (rule?.kind === "object" && !requiredFieldsPresent(object, rule))
    reject(realm);
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

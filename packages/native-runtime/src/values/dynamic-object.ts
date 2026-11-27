import {
  beginObjectPropertyContract,
  bigIntFromString,
  binaryObjectValueOperationOrThrow,
  unaryObjectValueOperationOrThrow,
  updateObjectValue,
  stringValueOrThrow,
  scriptStrictEqual,
  looselyEqual,
  objectPropertyKeyOrThrow,
  throwIfRuntimeError,
  requireObjectCoercible,
  getScriptIterator,
  stepScriptIterator,
  skipScriptIterator,
  collectScriptIterator,
  closeScriptIterator,
  type ScriptIterator,
  callObjectValue,
  isArrayValue,
  copyObjectProperties,
  enumerateObjectValue,
  nextEnumerableProperty,
  createDataProperty,
  createArrayObject,
  installProgramArrayIntrinsics,
  createObject,
  createRuntimeError,
  deleteObjectValueProperty,
  exoticSlots,
  finishObjectPropertyContract,
  installProgramObjectIntrinsics,
  installProgramConstructorGroup,
  installProgramTypedArrayIntrinsics,
  instanceOfValue,
  hasProperty,
  objectValueHasProperty,
  programRealmCore,
  projectPropertyContract,
  propertyEpoch,
  propertyKeyValue,
  readDynamicObjectProperty,
  readObjectValueProperty,
  setObjectLiteralPrototype,
  setObjectValueProperty,
  symbolDescriptiveString,
  typedArrayWindow,
  viewObjectValue,
  viewSymbolValue,
  type BigIntValue,
  type ContractField,
  type ObjectShapeContract,
  type OrdinaryObject,
  type ProgramRealmCore,
  type PropertyEnumeration,
  type PropertyValueRule,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import { byteStorageData } from "@tint/js-runtime/bytes";
import { detachNativeArray } from "../intrinsics/native-array-detach.ts";

type ObjectRecord = OrdinaryObject<ScriptPropertyKey, unknown>;
let cachedContracts: Map<string, ObjectShapeContract> | undefined = undefined;
let lastContractText0 = "";
let lastContractSchema0: ObjectShapeContract | undefined = undefined;
let lastContractText1 = "";
let lastContractSchema1: ObjectShapeContract | undefined = undefined;
let lastContractText2 = "";
let lastContractSchema2: ObjectShapeContract | undefined = undefined;
let lastContractText3 = "";
let lastContractSchema3: ObjectShapeContract | undefined = undefined;

function contractCache(): Map<string, ObjectShapeContract> {
  const existing = cachedContracts;
  if (existing !== undefined) return existing;
  const created = new Map<string, ObjectShapeContract>();
  cachedContracts = created;
  return created;
}

function rememberContract(text: string, schema: ObjectShapeContract): void {
  lastContractText3 = lastContractText2;
  lastContractSchema3 = lastContractSchema2;
  lastContractText2 = lastContractText1;
  lastContractSchema2 = lastContractSchema1;
  lastContractText1 = lastContractText0;
  lastContractSchema1 = lastContractSchema0;
  lastContractText0 = text;
  lastContractSchema0 = schema;
}

function contract(text: string): ObjectShapeContract {
  if (text === lastContractText0 && lastContractSchema0 !== undefined)
    return lastContractSchema0;
  if (text === lastContractText1 && lastContractSchema1 !== undefined)
    return lastContractSchema1;
  if (text === lastContractText2 && lastContractSchema2 !== undefined)
    return lastContractSchema2;
  if (text === lastContractText3 && lastContractSchema3 !== undefined)
    return lastContractSchema3;
  const contracts = contractCache();
  const known = contracts.get(text);
  if (known !== undefined) {
    rememberContract(text, known);
    return known;
  }
  let cursor = 0;
  function token(): string {
    const separator = text.indexOf(":", cursor);
    if (separator < 0) throw "DYNAMIC_CONTRACT_TOKEN_INVARIANT";
    const length = Number(text.slice(cursor, separator));
    cursor = separator + 1 + length;
    return text.slice(separator + 1, cursor);
  }
  const types: PropertyValueRule[] = [];
  const count = Number(token());
  for (let index = 0; index < count; index++) {
    const kind = token();
    switch (kind) {
      case "array":
        types.push({ kind: "array" });
        break;
      case "array-elements":
        types.push({
          kind: "array-elements",
          element: Number(token()),
          readonly: token() === "1",
        });
        break;
      case "number":
        types.push({ kind: "number" });
        break;
      case "string":
        types.push({ kind: "string" });
        break;
      case "boolean":
        types.push({ kind: "boolean" });
        break;
      case "null":
        types.push({ kind: "null" });
        break;
      case "undefined":
        types.push({ kind: "undefined" });
        break;
      case "bigint":
        types.push({ kind: "bigint" });
        break;
      case "unknown":
        types.push({ kind: "unknown" });
        break;
      case "never":
        types.push({ kind: "never" });
        break;
      case "string-literal":
        types.push({ kind: "literal", value: token() });
        break;
      case "number-literal":
        types.push({ kind: "literal", value: Number(token()) });
        break;
      case "boolean-literal":
        types.push({ kind: "literal", value: token() === "true" });
        break;
      case "object": {
        const stringIndex = Number(token());
        const readonlyIndex = token() === "1";
        const fields: ContractField[] = [];
        const length = Number(token());
        for (let position = 0; position < length; position++)
          fields.push({
            name: token(),
            value: Number(token()),
            required: token() === "1",
            readonly: token() === "1",
          });
        types.push({ kind: "object", stringIndex, readonlyIndex, fields });
        break;
      }
      case "union": {
        const members: number[] = [];
        const length = Number(token());
        for (let position = 0; position < length; position++)
          members.push(Number(token()));
        types.push({ kind: "union", members });
        break;
      }
      default:
        throw "DYNAMIC_CONTRACT_RULE_INVARIANT";
    }
  }
  const schema: ObjectShapeContract = { types, root: 0 };
  contracts.set(text, schema);
  rememberContract(text, schema);
  return schema;
}

function requireObject(value: unknown, core: ProgramRealmCore): ObjectRecord {
  const object = viewObjectValue(value, core.realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(core.realm, "type");
  return object;
}
function requireKey(value: unknown, core: ProgramRealmCore): ScriptPropertyKey {
  const key = propertyKeyValue(value, core.hooks, core.realm);
  if (key.error !== "none") throw createRuntimeError(core.realm, "type");
  return key.value;
}

export function create(schema: string): unknown {
  const core = programRealmCore();
  installProgramObjectIntrinsics(core);
  const object = createObject<ScriptPropertyKey, unknown>(
    core.realm.objectPrototype,
  );
  if (schema !== "")
    beginObjectPropertyContract(object, contract(schema), core.realm);
  return object;
}
export function finish(value: unknown, schema: string): void {
  if (schema === "") return;
  const core = programRealmCore();
  finishObjectPropertyContract(
    requireObject(value, core),
    contract(schema),
    core.realm,
  );
}
export function enroll(value: unknown, schema: string): unknown {
  const core = programRealmCore();
  return projectPropertyContract(value, contract(schema), core.realm, true);
}
export function convertKey(value: unknown): unknown {
  return requireKey(value, programRealmCore());
}
export function define(base: unknown, key: unknown, value: unknown): void {
  const core = programRealmCore();
  const object = requireObject(base, core);
  if (
    !createDataProperty<ScriptPropertyKey, unknown>(
      object,
      requireKey(key, core),
      value,
      core.hooks,
    )
  )
    throw createRuntimeError(core.realm, "type");
}
export function setPrototype(base: unknown, value: unknown): void {
  const core = programRealmCore();
  setObjectLiteralPrototype(requireObject(base, core), value);
}
export function read(base: unknown, key: unknown): unknown {
  const core = programRealmCore();
  if (typeof key === "string" || typeof key === "number")
    return readDynamicObjectProperty(base, key, core.hooks, core.realm);
  return readObjectValueProperty(
    base,
    objectPropertyKeyOrThrow(base, key, core.hooks, core.realm),
    core.hooks,
    core.realm,
  );
}
export function speculativeBinary(
  operator: string,
  left: unknown,
  right: unknown,
): unknown {
  if (operator === "===" || operator === "!==")
    return scriptStrictEqual(left, right) === (operator === "===");
  const core = programRealmCore();
  if (operator === "==" || operator === "!=") {
    const result = looselyEqual(left, right, core.hooks, core.realm);
    throwIfRuntimeError(core.realm, result.error);
    return result.value === (operator === "==");
  }
  return binaryObjectValueOperationOrThrow(
    operator,
    left,
    right,
    core.hooks,
    core.realm,
  );
}
export function speculativeUnary(operator: string, value: unknown): unknown {
  const core = programRealmCore();
  return unaryObjectValueOperationOrThrow(
    operator,
    value,
    core.hooks,
    core.realm,
  );
}
export function speculativeString(value: unknown): string {
  const core = programRealmCore();
  return stringValueOrThrow(value, core.hooks, core.realm);
}
/** `String(value)` for a value typed code holds as unknown: a Symbol's
 * descriptive string, any other value's ToString. */
export function stringConstructor(value: unknown): string {
  const symbol = viewSymbolValue(value);
  if (symbol !== undefined) return symbolDescriptiveString(symbol);
  const core = programRealmCore();
  return stringValueOrThrow(value, core.hooks, core.realm);
}
export function project(value: unknown, schema: string): unknown {
  const core = programRealmCore();
  return projectPropertyContract(value, contract(schema), core.realm);
}
export function write(base: unknown, key: unknown, value: unknown): void {
  const core = programRealmCore();
  const property: ScriptPropertyKey =
    typeof key === "string" ? key : requireKey(key, core);
  if (
    setObjectValueProperty(
      base,
      property,
      value,
      true,
      core.hooks,
      core.realm,
    ) !== "none"
  )
    throw createRuntimeError(core.realm, "type");
}
export function update(
  base: unknown,
  key: unknown,
  operator: string,
  prefix: boolean,
): unknown {
  const core = programRealmCore();
  const property = objectPropertyKeyOrThrow(base, key, core.hooks, core.realm);
  const old = readObjectValueProperty(base, property, core.hooks, core.realm);
  const result = updateObjectValue(operator, old, core.hooks, core.realm);
  throwIfRuntimeError(core.realm, result.error);
  write(base, property, result.value);
  return prefix ? result.value : result.previous;
}
export function has(key: unknown, base: unknown): boolean {
  const core = programRealmCore();
  const result = objectValueHasProperty(key, base, core.hooks, core.realm);
  if (result.error !== "none") throw createRuntimeError(core.realm, "type");
  return result.value;
}
export function remove(base: unknown, key: unknown): boolean {
  const core = programRealmCore();
  const property: ScriptPropertyKey =
    typeof key === "string" ? key : requireKey(key, core);
  const result = deleteObjectValueProperty(
    base,
    property,
    true,
    core.realm.objectPrototype,
  );
  if (result.error !== "none") throw createRuntimeError(core.realm, "type");
  return result.value;
}

export function spread(base: unknown, source: unknown): void {
  const core = programRealmCore();
  copyObjectProperties(
    requireObject(base, core),
    source,
    [],
    core.hooks,
    core.realm,
  );
}
export function enumerate(
  value: unknown,
): PropertyEnumeration<ScriptPropertyKey, unknown> {
  const core = programRealmCore();
  const enumeration = enumerateObjectValue(value, core.hooks, core.realm);
  if (enumeration.error !== "none")
    throw createRuntimeError(core.realm, "type");
  return enumeration.value;
}
export function advance(
  enumeration: PropertyEnumeration<ScriptPropertyKey, unknown>,
): string | undefined {
  const key = nextEnumerableProperty<ScriptPropertyKey, unknown>(enumeration);
  return typeof key === "string" ? key : undefined;
}

let cachedObjectCore: ProgramRealmCore | undefined = undefined;
let cachedObjectValue: unknown = undefined;
let cachedObjectGlobalEpoch = -1;
let cachedObjectPropEpoch = -1;

export function objectConstructor(): unknown {
  const core = programRealmCore();
  installProgramObjectIntrinsics(core);
  if (
    cachedObjectCore === core &&
    core.object.internalPropertyEpoch === cachedObjectGlobalEpoch &&
    propertyEpoch.value === cachedObjectPropEpoch
  )
    return cachedObjectValue;
  const ctor = readObjectValueProperty(
    core.object,
    "Object",
    core.hooks,
    core.realm,
  );
  cachedObjectCore = core;
  cachedObjectValue = ctor;
  cachedObjectGlobalEpoch = core.object.internalPropertyEpoch;
  cachedObjectPropEpoch = propertyEpoch.value;
  return ctor;
}
export function invokeEnumeration(
  receiver: unknown,
  callee: unknown,
  input: unknown,
): unknown {
  const core = programRealmCore();
  const args: unknown[] = [input];
  const result = callObjectValue(
    callee,
    receiver,
    args,
    core.realm.objectPrototype,
  );
  if (result.error !== "none" || !isArrayValue(result.value, core.realm))
    throw createRuntimeError(core.realm, "type");
  return result.value;
}

/** Evaluate a typed source's realm global as an ordinary property lookup. */
export function realmGlobal(name: string, installer: string): unknown {
  const core = programRealmCore();
  installProgramConstructorGroup(core, installer);
  if (!hasProperty<ScriptPropertyKey, unknown>(core.object, name))
    throw createRuntimeError(core.realm, "reference");
  return readObjectValueProperty(core.object, name, core.hooks, core.realm);
}
export function realmInstanceOf(
  value: unknown,
  constructor: unknown,
  nativeKind: string,
): boolean {
  const core = programRealmCore();
  let prototype: ObjectRecord | undefined;
  if (nativeKind === "Error") prototype = core.realm.prototypes.get("error");
  else if (nativeKind === "TypeError")
    prototype = core.realm.prototypes.get("type");
  else if (nativeKind === "RangeError")
    prototype = core.realm.prototypes.get("range");
  else if (nativeKind === "ReferenceError")
    prototype = core.realm.prototypes.get("reference");
  else if (nativeKind === "SharedArrayBuffer")
    prototype = core.realm.sharedArrayBufferPrototype;
  else if (nativeKind !== "") {
    installProgramTypedArrayIntrinsics(core);
    prototype = core.realm.typedArrayPrototypes.get(nativeKind.slice(0, -5));
  }
  const result = instanceOfValue(
    value,
    constructor,
    core.hooks,
    core.realm,
    prototype,
  );
  if (result.error !== "none") throw createRuntimeError(core.realm, "type");
  return result.value;
}
/** A realm typed array as the native typed array of `nativeKind` (Uint8Array,
 * Uint16Array, Uint32Array or Float64Array) that views the same bytes, for
 * typed code (the slice 2b buffer view): over an ordinary buffer's backing,
 * which collections move together with the view, or over a shared block's
 * nonmoving payload. An ordinary buffer keeps one view per element kind and
 * window, and its detachment detaches them as V8's typed arrays observe it:
 * their length becomes 0. A typed array already detached is an empty one.
 * Undefined when there is no fixed native window: another kind, a big-endian
 * or length-tracking view, a resizable buffer or a growable shared one. */
export function projectNativeTypedArray(
  value: unknown,
  nativeKind: string,
): unknown {
  const core = programRealmCore();
  const object = viewObjectValue(value, core.realm.objectPrototype);
  const data =
    object === undefined
      ? undefined
      : exoticSlots(object).internalTypedArrayData;
  if (
    data === undefined ||
    data.kind + "Array" !== nativeKind ||
    data.endian !== "little"
  )
    return undefined;
  const length = data.length;
  if (length === undefined) return undefined;
  const storage = data.storage;
  if (storage.kind === "shared") {
    const bytes = storage.growable
      ? undefined
      : storage.service.bytes(storage.handle);
    if (bytes === undefined || typedArrayWindow(data) === undefined)
      return undefined;
    return nativeView(nativeKind, bytes, data.byteOffset, length);
  }
  if (storage.resizable) return undefined;
  const bytes = byteStorageData(storage);
  if (bytes === undefined) return emptyNativeArray(nativeKind);
  if (typedArrayWindow(data) === undefined) return undefined;
  let known = storage.nativeViews;
  while (known !== undefined) {
    if (
      known.kind === nativeKind &&
      known.byteOffset === data.byteOffset &&
      known.length === length
    )
      return known.view;
    known = known.next;
  }
  const view = nativeView(nativeKind, bytes, data.byteOffset, length);
  storage.nativeViews = {
    kind: nativeKind,
    byteOffset: data.byteOffset,
    length,
    view,
    next: storage.nativeViews,
  };
  if (storage.onDetach === undefined) {
    const owner = storage;
    storage.onDetach = (): void => {
      let projected = owner.nativeViews;
      while (projected !== undefined) {
        detachNativeArray(projected.view);
        projected = projected.next;
      }
    };
  }
  return view;
}
/** A realm SharedArrayBuffer as the borrowed native byte array that views
 * its shared block payload, for typed code. Growable shared buffers have
 * no fixed native window and return undefined (throwing TypeError). */
export function projectNativeSharedArrayBuffer(value: unknown): unknown {
  const core = programRealmCore();
  const object = viewObjectValue(value, core.realm.objectPrototype);
  const storage =
    object === undefined
      ? undefined
      : exoticSlots(object).internalSharedArrayBufferData;
  if (storage === undefined || storage.growable) return undefined;
  return storage.service.bytes(storage.handle);
}
/** A native typed array of `nativeKind` over `bytes` from `byteOffset`. */
function nativeView(
  nativeKind: string,
  bytes: Uint8Array,
  byteOffset: number,
  length: number,
): unknown {
  const offset = bytes.byteOffset + byteOffset;
  if (nativeKind === "Uint8Array")
    return new Uint8Array(bytes.buffer, offset, length);
  if (nativeKind === "Int8Array")
    return new Int8Array(bytes.buffer, offset, length);
  if (nativeKind === "Uint8ClampedArray")
    return new Uint8ClampedArray(bytes.buffer, offset, length);
  if (nativeKind === "Uint16Array")
    return new Uint16Array(bytes.buffer, offset, length);
  if (nativeKind === "Int16Array")
    return new Int16Array(bytes.buffer, offset, length);
  if (nativeKind === "Float16Array")
    return new Float16Array(bytes.buffer, offset, length);
  if (nativeKind === "Uint32Array")
    return new Uint32Array(bytes.buffer, offset, length);
  if (nativeKind === "Int32Array")
    return new Int32Array(bytes.buffer, offset, length);
  if (nativeKind === "Float32Array")
    return new Float32Array(bytes.buffer, offset, length);
  if (nativeKind === "Float64Array")
    return new Float64Array(bytes.buffer, offset, length);
  if (nativeKind === "BigInt64Array")
    return new BigInt64Array(bytes.buffer, offset, length);
  if (nativeKind === "BigUint64Array")
    return new BigUint64Array(bytes.buffer, offset, length);
  return undefined;
}
function emptyNativeArray(nativeKind: string): unknown {
  if (nativeKind === "Uint8Array") return new Uint8Array(0);
  if (nativeKind === "Int8Array") return new Int8Array(0);
  if (nativeKind === "Uint8ClampedArray") return new Uint8ClampedArray(0);
  if (nativeKind === "Uint16Array") return new Uint16Array(0);
  if (nativeKind === "Int16Array") return new Int16Array(0);
  if (nativeKind === "Float16Array") return new Float16Array(0);
  if (nativeKind === "Uint32Array") return new Uint32Array(0);
  if (nativeKind === "Int32Array") return new Int32Array(0);
  if (nativeKind === "Float32Array") return new Float32Array(0);
  if (nativeKind === "Float64Array") return new Float64Array(0);
  if (nativeKind === "BigInt64Array") return new BigInt64Array(0);
  if (nativeKind === "BigUint64Array") return new BigUint64Array(0);
  return undefined;
}
export function invokeArrayMethod(
  receiver: unknown,
  callable: unknown,
  arity: number,
  first: unknown,
  second: unknown,
  third: unknown,
): unknown {
  const core = programRealmCore();
  const args: unknown[] =
    arity === 0
      ? []
      : arity === 1
        ? [first]
        : arity === 2
          ? [first, second]
          : [first, second, third];
  const result = callObjectValue(
    callable,
    receiver,
    args,
    core.realm.objectPrototype,
  );
  if (result.error !== "none") throw createRuntimeError(core.realm, "type");
  return result.value;
}

export function createArray(length: number): unknown {
  const core = programRealmCore();
  installProgramObjectIntrinsics(core);
  installProgramArrayIntrinsics(core);
  return createArrayObject<ScriptPropertyKey, unknown>(
    length,
    core.realm.arrayPrototype,
    core.realm.arrayHooks,
    core.hooks,
  );
}

export function invoke(
  receiver: unknown,
  callee: unknown,
  values: unknown,
): unknown {
  const core = programRealmCore();
  const length = read(values, "length");
  if (typeof length !== "number") throw "dynamic call argument count invariant";
  const args: unknown[] = [];
  for (let index = 0; index < length; index++)
    args.push(read(values, String(index)));
  const result = callObjectValue(
    callee,
    receiver,
    args,
    core.realm.objectPrototype,
  );
  if (result.error !== "none") throw createRuntimeError(core.realm, "type");
  return result.value;
}

export function bindingObject(source: unknown): void {
  requireObjectCoercible(source, programRealmCore().realm);
}
export function bindingIterator(source: unknown): ScriptIterator {
  const core = programRealmCore();
  installProgramArrayIntrinsics(core);
  return getScriptIterator(source, core.realm, core.hooks);
}
export function bindingNext(iterator: ScriptIterator): unknown {
  return stepScriptIterator(iterator).value;
}
export function bindingSkip(iterator: ScriptIterator): void {
  skipScriptIterator(iterator);
}
export function bindingTail(iterator: ScriptIterator): unknown {
  const core = programRealmCore();
  return collectScriptIterator(iterator, core.realm, core.hooks);
}
export function bindingClose(
  iterator: ScriptIterator,
  throwing: boolean,
): void {
  closeScriptIterator(iterator, throwing);
}
export function bindingRest(
  source: unknown,
  keys: unknown,
  count: number,
): unknown {
  const core = programRealmCore();
  const excluded: ScriptPropertyKey[] = [];
  for (let i = 0; i < count; i++) {
    const key = readObjectValueProperty(
      keys,
      String(i),
      core.hooks,
      core.realm,
    );
    excluded.push(requireKey(key, core));
  }
  const result = createObject<ScriptPropertyKey, unknown>(
    core.realm.objectPrototype,
  );
  copyObjectProperties(result, source, excluded, core.hooks, core.realm);
  return result;
}
export function bigIntFromStringOrThrow(input: string): BigIntValue {
  const parsed = bigIntFromString(input);
  if (parsed === undefined) {
    const core = programRealmCore();
    installProgramConstructorGroup(core, "installErrorIntrinsics");
    throw createRuntimeError(core.realm, "syntax");
  }
  return parsed;
}
export { jsonParse, jsonStringify } from "./json.ts";
export {
  projectUnaryNumber,
  projectNativeCallback,
  projectNumberList,
  projectNativeRecord,
} from "../intrinsics/value-views.ts";

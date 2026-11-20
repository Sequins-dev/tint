import type { WeakData } from "./weak-storage.ts";
import type { ShadowRealmHost } from "./shadow-realm.ts";
import type { SegmenterState } from "./segmenter-state.ts";
import type { RelativeTimeFormatter } from "./relative-time.ts";
import type { DecimalNumberFormatter } from "./decimal-number-format.ts";
import type { PluralFormatter } from "./plural-format.ts";
import type { DisposalStack } from "../disposal/index.ts";
import type { LocaleData } from "./locale-id.ts";
import type { CollatorData } from "./collator.ts";
import type { ListFormatter } from "./list-format.ts";
import type { BigIntValue } from "./bigints.ts";
import type { TemporalZonedDateTime } from "./temporal-zoned-date-time.ts";
import type {
  ISODateTime,
  ISOTime,
} from "@tint/foundation/chrono/iso-date-time";
import type { Duration } from "@tint/foundation/chrono/temporal-duration";
import type { GregorianDate } from "@tint/foundation/chrono/gregorian-calendar";
import type {
  LinkedMap,
  MapCursor,
} from "@tint/foundation/collections/linked-map";
import type { TypedArrayData } from "./typed-array-data.ts";
import type { RegExpIteratorData } from "./regexp-iterator.ts";
import type { DataViewData } from "./data-view.ts";
import type { ByteStorage } from "../bytes/index.ts";
import type { SharedBlockStorage } from "../bytes/shared.ts";
import type { ErrorRealm } from "./errors.ts";
import type { ObjectShapeContract } from "./property-contracts.ts";
import type { RegExpData } from "./regexp-data.ts";
import type { PromiseRecord } from "../promises/index.ts";
import type { ScriptExecutionContext } from "./jobs.ts";
import type {
  AsyncGeneratorRecord,
  AsyncGeneratorHooks,
  IteratorRecord,
  GeneratorRecord,
} from "../iterators/index.ts";
import type { PrivateElement } from "./private-elements.ts";
import {
  applyDescriptor,
  emptyUpdate,
  valueField,
  writableField,
  enumerableField,
  configurableField,
  type Descriptor,
  type DescriptorUpdate,
} from "../descriptors/index.ts";
import {
  arrayElementCount,
  arrayElementDescriptor,
  packedElementUpdate,
  readArrayElement,
  truncateArrayElements,
  writeArrayElement,
  type ArrayElements,
} from "./array-elements.ts";
/** Compiler-owned suspension work; never exposed as a JavaScript property. */
export interface NativeAwaitOperation<Value> {
  readonly subscribe: (
    fulfilled: (value: Value) => void,
    rejected: (error: Value) => void,
  ) => void;
}
export interface PropertyWriteContract<Key, Value> {
  readonly schemas: readonly ObjectShapeContract[];
  readonly beforeDefine: (
    key: Key,
    descriptor: Descriptor<Value>,
    writesValue: boolean,
  ) => void;
  readonly canDelete: (key: Key) => boolean;
}
/** Internal object state with optional runtime capabilities. Keys must be canonical;
 * values and callable handles belong to the embedding runtime. Mutate through this module. */
export interface OrdinaryObject<Key, Value> {
  prototype: OrdinaryObject<Key, Value> | undefined;
  extensible: boolean;
  internalImmutablePrototype: boolean;
  readonly properties: Map<Key, Descriptor<Value>>;
  /** Bumped whenever a key is added or deleted or a stored descriptor is
   * replaced. Only an in-place [[Value]] write to a writable data descriptor
   * leaves it unchanged, so a cached descriptor stays the live cell. */
  internalPropertyEpoch: number;
  internalPropertyContract: PropertyWriteContract<Key, Value> | undefined;
  internalPrivateElements: PrivateElement<Value>[] | undefined;
  /** Internal [[Call]], never a named/inherited JavaScript property. */
  readonly internalCall: ObjectCall<Value> | undefined;
  /** Compiler/runtime-owned call steps. Each step owns and restores its context
   * before returning a transfer; JavaScript return values never select a step. */
  internalTailDispatch: ObjectTailDispatch<Key, Value> | undefined;
  /** Built-in [[InitialName]], independent of the mutable public name property. */
  internalInitialName: string | undefined;
  internalSourceText: string | undefined;
  /** Frozen primitive JSON text; presence is the non-proxy-forwarding raw JSON brand. */
  internalRawJSON: string | undefined;
  internalModuleSourceClassName: string | undefined;
  internalShadowRealm: ShadowRealmHost | undefined;
  readonly internalConstruct: ObjectConstruct<Value> | undefined;
  readonly internalExecutionContext: ObjectExecutionContext<Value> | undefined;
  /** Presence of [[ErrorData]], independent of the object's prototype chain. */
  internalErrorData: boolean;
  /** Creation-time logical stack, independent of the public stack property. */
  internalErrorStack: string | undefined;
  /** Typed error operations supplied by a mixed-program boundary adapter. */
  internalTypedErrorAccess: ((operation: string) => unknown) | undefined;
  internalDisposableStack: DisposalStack<Value> | undefined;
  internalAsyncDisposableStack: DisposalStack<Value> | undefined;
  internalTemporalPlainYearMonth: GregorianDate | undefined;
  internalTemporalPlainMonthDay: GregorianDate | undefined;
  internalTemporalPlainDate: GregorianDate | undefined;
  internalTemporalDuration: Duration | undefined;
  internalTemporalPlainTime: ISOTime | undefined;
  internalTemporalPlainDateTime: ISODateTime | undefined;
  internalTemporalZonedDateTime: TemporalZonedDateTime | undefined;
  internalTemporalCalendar: string | undefined;
  internalTemporalInstant: BigIntValue | undefined;
  internalLocaleData: LocaleData | undefined;
  internalListFormatData: ListFormatter | undefined;
  /** Intl.Segmenter, Segments and Segment Iterator slots, tagged by kind. */
  internalSegmenterData: SegmenterState | undefined;
  internalCollatorData: CollatorData | undefined;
  internalPluralRulesData: PluralFormatter | undefined;
  /** DateTimeFormat or DurationFormat formatter record, read only through the
   * checked views in intl-format-views.ts; undefined for every other object. */
  internalIntlFormatData: unknown;
  internalRelativeTimeData: RelativeTimeFormatter | undefined;
  internalNumberFormatData: DecimalNumberFormatter | undefined;
  /** [[DateValue]] is present even for an invalid (NaN) Date. */
  internalDateValue: number | undefined;
  /** Host-only [[IsHTMLDDA]]; neither inherited nor forwarded through proxies. */
  internalIsHTMLDDA: boolean;
  internalRegExpData: RegExpData | undefined;
  /** Presence of [[ParameterMap]], including unmapped arguments objects. */
  internalArgumentsData: boolean;
  internalArrayData: boolean;
  /** Packed own elements; present only on array exotic objects until a
   * property operation requires ordinary descriptors for their indices. */
  internalArrayElements: ArrayElements<Key, Value> | undefined;
  internalArrayBufferData: ByteStorage | undefined;
  internalSharedArrayBufferData: SharedBlockStorage | undefined;
  internalArrayBufferView: boolean;
  internalDataViewData: DataViewData | undefined;
  internalTypedArrayData: TypedArrayData | undefined;
  internalProxyData: ProxyState<Key, Value> | undefined;
  internalPromiseData: PromiseRecord<Value> | undefined;
  internalAwaitOperation: NativeAwaitOperation<Value> | undefined;
  internalSetData: LinkedMap<Value, Value> | undefined;
  internalSetIteratorData:
    | { readonly cursor: MapCursor<Value, Value>; readonly entries: boolean }
    | undefined;
  internalMapData: LinkedMap<Value, Value> | undefined;
  internalWeakData: WeakData | undefined;
  /** Agent-unique identity for weak-collection indexing, 0 until first needed.
   * A number, so indexes keyed by it never retain the object. */
  internalIdentity: number;
  internalMapIteratorData:
    | {
        readonly cursor: MapCursor<Value, Value>;
        readonly kind: "key" | "value" | "entry";
      }
    | undefined;
  internalGeneratorData: GeneratorRecord<Value> | undefined;
  internalSyncIteratorData: IteratorRecord<Value> | undefined;
  /** Separate [[Iterated]] brand from async-from-sync wrappers. */
  internalWrappedIteratorData: IteratorRecord<Value> | undefined;
  internalIteratorHelperData:
    | { readonly generator: GeneratorRecord<Value>; readonly close: () => void }
    | undefined;
  internalAsyncGeneratorData:
    | {
        readonly record: AsyncGeneratorRecord<Value>;
        readonly hooks: AsyncGeneratorHooks<Value>;
        readonly context: ScriptExecutionContext;
      }
    | undefined;
  internalRegExpIteratorData: RegExpIteratorData | undefined;
  internalArrayIteratorData:
    | {
        iterated: OrdinaryObject<Key, Value> | undefined;
        index: number;
        readonly kind: "key" | "value" | "entry";
      }
    | undefined;
  internalStringIteratorData:
    { text: string | undefined; index: number } | undefined;
  internalPrimitiveData:
    | {
        readonly kind: "number" | "boolean" | "string" | "symbol" | "bigint";
        readonly value: Value;
      }
    | undefined;
  internalBoundTarget: OrdinaryObject<Key, Value> | undefined;
  /** Definition-time [[HomeObject]] for super; independent of call receiver. */
  internalHomeObject: OrdinaryObject<Key, Value> | undefined;
  readonly internalMethods: ObjectInternalMethods<Key, Value> | undefined;
  readonly internalDataAliases: Map<Key, DataAlias<Value>> | undefined;
}
export interface ProxyState<Key, Value> {
  target: OrdinaryObject<Key, Value> | undefined;
  handler: OrdinaryObject<Key, Value> | undefined;
}
export type PropertyDefinitionResult = "accepted" | "rejected" | "invalid";
/** Internal exotic definition capability. Implementations delegate ordinary
 * descriptor work to ordinaryDefineOwnProperty to avoid recursive dispatch. */
export type ObjectDefineOwnProperty<Key, Value> = (
  object: OrdinaryObject<Key, Value>,
  key: Key,
  update: DescriptorUpdate<Value>,
  hooks: ObjectHooks<Value>,
) => PropertyDefinitionResult;
/** Optional internal-method overrides. Missing entries retain ordinary semantics;
 * traps own their invariants and may propagate arbitrary abrupt completions. */
export interface ObjectInternalMethods<Key, Value> {
  readonly getOwnProperty?: (
    object: OrdinaryObject<Key, Value>,
    key: Key,
  ) => Descriptor<Value> | undefined;
  readonly defineOwnProperty?: ObjectDefineOwnProperty<Key, Value>;
  readonly deleteProperty?: (
    object: OrdinaryObject<Key, Value>,
    key: Key,
  ) => boolean;
  readonly hasProperty?: (
    object: OrdinaryObject<Key, Value>,
    key: Key,
  ) => boolean;
  readonly get?: (
    object: OrdinaryObject<Key, Value>,
    key: Key,
    receiver: Value,
    hooks: ObjectHooks<Value>,
  ) => Value;
  readonly set?: (
    object: OrdinaryObject<Key, Value>,
    key: Key,
    value: Value,
    receiver: Receiver<Key, Value>,
    hooks: ObjectHooks<Value>,
  ) => boolean;
  readonly ownKeys?: (object: OrdinaryObject<Key, Value>) => Key[];
  readonly getPrototype?: (
    object: OrdinaryObject<Key, Value>,
  ) => OrdinaryObject<Key, Value> | undefined;
  readonly setPrototype?: (
    object: OrdinaryObject<Key, Value>,
    prototype: OrdinaryObject<Key, Value> | undefined,
  ) => boolean;
  readonly isExtensible?: (object: OrdinaryObject<Key, Value>) => boolean;
  readonly preventExtensions?: (object: OrdinaryObject<Key, Value>) => boolean;
  /** The typed (native) record a record view presents (record-views.ts). */
  readonly typedRecord?: () => unknown;
}
/** Internal parameter access, never user-visible accessor functions. Callbacks
 * must not execute user code; descriptor changes can disconnect this alias. */
export interface DataAlias<Value> {
  readonly get: () => Value;
  readonly set: (value: Value) => void;
}
/** Embedding-owned dynamic context, independent of mutable JavaScript properties.
 * run must restore the previous context on both normal and abrupt completion. */
export interface ObjectExecutionContext<Value> {
  /** Script contexts expose their realm without entering it or invoking code. */
  readonly getRealm?: () => ErrorRealm;
  readonly run: (action: () => Value) => Value;
}
export type ObjectConstruct<Value> = (
  arguments_: readonly Value[],
  newTarget: Value,
) => Value;
export type ObjectCall<Value> = (
  receiver: Value,
  arguments_: readonly Value[],
) => Value;
export type ObjectCallDispatch<Key, Value> =
  | { readonly kind: "return"; readonly value: Value }
  | {
      readonly kind: "call";
      readonly target: OrdinaryObject<Key, Value> | undefined;
      readonly receiver: Value;
      readonly arguments: readonly Value[];
    };
export type ObjectTailDispatch<Key, Value> = (
  receiver: Value,
  arguments_: readonly Value[],
) => ObjectCallDispatch<Key, Value>;
export interface ObjectHooks<Value> {
  readonly undefinedValue: Value;
  readonly sameValue: (left: Value, right: Value) => boolean;
  readonly call: (
    callee: Value,
    receiver: Value,
    arguments_: readonly Value[],
  ) => Value;
}
/** object is present exactly when value represents that object in the embedding runtime. */
export interface Receiver<Key, Value> {
  readonly value: Value;
  readonly object: OrdinaryObject<Key, Value> | undefined;
}
export function createObject<Key, Value>(
  prototype: OrdinaryObject<Key, Value> | undefined,
): OrdinaryObject<Key, Value> {
  return allocateObject<Key, Value>(
    prototype,
    undefined,
    undefined,
    undefined,
    undefined,
  );
}
/** Only ordinary data storage and the standard Array exotic can enroll. */
export function acceptsPropertyContract<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  allowCallable: boolean = false,
): boolean {
  return (
    (object.internalMethods === undefined || object.internalArrayData) &&
    object.internalDataAliases === undefined &&
    (allowCallable ||
      (object.internalCall === undefined &&
        object.internalConstruct === undefined)) &&
    !object.internalArgumentsData
  );
}
/** Publish a previously validated contract and invalidate any direct cell. */
export function attachPropertyContract<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  contract: PropertyWriteContract<Key, Value>,
  allowCallable: boolean = false,
): void {
  if (!acceptsPropertyContract<Key, Value>(object, allowCallable))
    throw "PROPERTY_CONTRACT_OBJECT_INVARIANT";
  // Contracted array writes use the existing descriptor guard. Transfer the
  // packed elements without invoking any user code or changing their keys.
  const elements = object.internalArrayElements;
  if (elements !== undefined) unpackArrayElements<Key, Value>(object, elements);
  object.internalPropertyContract = contract;
  object.internalPropertyEpoch++;
}
export function createAliasedObject<Key, Value>(
  prototype: OrdinaryObject<Key, Value> | undefined,
): OrdinaryObject<Key, Value> {
  return allocateObject<Key, Value>(
    prototype,
    undefined,
    undefined,
    new Map<Key, DataAlias<Value>>(),
    undefined,
  );
}
/** Attach only to an existing writable data property. This is an internal
 * construction operation; source property redefinition uses defineOwnProperty. */
export function aliasDataProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
  alias: DataAlias<Value>,
): void {
  const aliases = object.internalDataAliases;
  const descriptor = object.properties.get(key);
  if (
    aliases === undefined ||
    descriptor === undefined ||
    descriptor.accessor ||
    !descriptor.writable
  )
    throw "DATA_ALIAS_PROPERTY_INVARIANT";
  aliases.set(key, alias);
}
/** One ordinary identity with call behavior; this factory does not grant [[Construct]]. */
export function createCallableObject<Key, Value>(
  prototype: OrdinaryObject<Key, Value> | undefined,
  implementation: ObjectCall<Value>,
  context: ObjectExecutionContext<Value> | undefined = prototype === undefined
    ? undefined
    : prototype.internalExecutionContext,
): OrdinaryObject<Key, Value> {
  return allocateObject<Key, Value>(
    prototype,
    implementation,
    undefined,
    undefined,
    undefined,
    context,
  );
}
/** Call and construct capabilities are independent; neither is inferred from properties. */
export function createConstructorObject<Key, Value>(
  prototype: OrdinaryObject<Key, Value> | undefined,
  call: ObjectCall<Value> | undefined,
  construct: ObjectConstruct<Value>,
  context: ObjectExecutionContext<Value> | undefined = prototype === undefined
    ? undefined
    : prototype.internalExecutionContext,
): OrdinaryObject<Key, Value> {
  return allocateObject<Key, Value>(
    prototype,
    call,
    construct,
    undefined,
    undefined,
    context,
  );
}
export function createExoticObject<Key, Value>(
  prototype: OrdinaryObject<Key, Value> | undefined,
  methods: ObjectInternalMethods<Key, Value>,
  call?: ObjectCall<Value>,
  construct?: ObjectConstruct<Value>,
  context?: ObjectExecutionContext<Value>,
): OrdinaryObject<Key, Value> {
  return allocateObject<Key, Value>(
    prototype,
    call,
    construct,
    undefined,
    methods,
    context,
  );
}
function allocateObject<Key, Value>(
  prototype: OrdinaryObject<Key, Value> | undefined,
  internalCall: ObjectCall<Value> | undefined,
  internalConstruct: ObjectConstruct<Value> | undefined,
  internalDataAliases: Map<Key, DataAlias<Value>> | undefined,
  internalMethods: ObjectInternalMethods<Key, Value> | undefined,
  internalExecutionContext?: ObjectExecutionContext<Value>,
): OrdinaryObject<Key, Value> {
  return {
    prototype,
    extensible: true,
    internalImmutablePrototype: false,
    properties: new Map<Key, Descriptor<Value>>(),
    internalPropertyEpoch: 0,
    internalPropertyContract: undefined,
    internalCall,
    internalTailDispatch: undefined,
    internalInitialName: undefined,
    internalSourceText: undefined,
    internalRawJSON: undefined,
    internalModuleSourceClassName: undefined,
    internalShadowRealm: undefined,
    internalConstruct,
    internalExecutionContext,
    internalErrorData: false,
    internalErrorStack: undefined,
    internalTypedErrorAccess: undefined,
    internalDisposableStack: undefined,
    internalAsyncDisposableStack: undefined,
    internalTemporalPlainYearMonth: undefined,
    internalTemporalPlainMonthDay: undefined,
    internalTemporalPlainDate: undefined,
    internalTemporalDuration: undefined,
    internalTemporalPlainTime: undefined,
    internalTemporalPlainDateTime: undefined,
    internalTemporalZonedDateTime: undefined,
    internalTemporalCalendar: undefined,
    internalTemporalInstant: undefined,
    internalLocaleData: undefined,
    internalListFormatData: undefined,
    internalSegmenterData: undefined,
    internalCollatorData: undefined,
    internalPluralRulesData: undefined,
    internalIntlFormatData: undefined,
    internalRelativeTimeData: undefined,
    internalNumberFormatData: undefined,
    internalDateValue: undefined,
    internalIsHTMLDDA: false,
    internalRegExpData: undefined,
    internalArgumentsData: false,
    internalArrayData: false,
    internalArrayElements: undefined,
    internalArrayBufferData: undefined,
    internalSharedArrayBufferData: undefined,
    internalArrayBufferView: false,
    internalDataViewData: undefined,
    internalTypedArrayData: undefined,
    internalProxyData: undefined,
    internalSetData: undefined,
    internalSetIteratorData: undefined,
    internalMapData: undefined,
    internalWeakData: undefined,
    internalIdentity: 0,
    internalMapIteratorData: undefined,
    internalGeneratorData: undefined,
    internalSyncIteratorData: undefined,
    internalWrappedIteratorData: undefined,
    internalIteratorHelperData: undefined,
    internalAsyncGeneratorData: undefined,
    internalPromiseData: undefined,
    internalAwaitOperation: undefined,
    internalRegExpIteratorData: undefined,
    internalArrayIteratorData: undefined,
    internalStringIteratorData: undefined,
    internalPrimitiveData: undefined,
    internalBoundTarget: undefined,
    internalHomeObject: undefined,
    internalPrivateElements: undefined,
    internalMethods,
    internalDataAliases,
  };
}
export function getOwnProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
): Descriptor<Value> | undefined {
  const method = object.internalMethods?.getOwnProperty;
  if (method !== undefined) return method(object, key);
  return ordinaryGetOwnProperty<Key, Value>(object, key);
}
export function ordinaryGetOwnProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
): Descriptor<Value> | undefined {
  const elements = object.internalArrayElements;
  if (elements !== undefined) {
    const index = elements.keys.index(key);
    // Packed storage owns every array index; the property map holds none.
    if (index >= 0)
      return index < arrayElementCount<Key, Value>(elements)
        ? arrayElementDescriptor<Key, Value>(elements, index)
        : undefined;
  }
  const descriptor = object.properties.get(key);
  if (descriptor === undefined) return undefined;
  const aliases = object.internalDataAliases;
  const alias = aliases === undefined ? undefined : aliases.get(key);
  if (alias === undefined) return descriptor;
  return {
    accessor: descriptor.accessor,
    value: alias.get(),
    writable: descriptor.writable,
    get: descriptor.get,
    set: descriptor.set,
    enumerable: descriptor.enumerable,
    configurable: descriptor.configurable,
  };
}
/** Descriptors have already passed ToPropertyDescriptor, including accessor callability checks. */
export function defineOwnProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
  update: DescriptorUpdate<Value>,
  hooks: ObjectHooks<Value>,
): "accepted" | "rejected" | "invalid" {
  const define = object.internalMethods?.defineOwnProperty;
  return define === undefined
    ? ordinaryDefineOwnProperty<Key, Value>(object, key, update, hooks)
    : define(object, key, update, hooks);
}
/** Descriptor storage operation; bypasses exotic dispatch for internal algorithms. */
export function ordinaryDefineOwnProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
  update: DescriptorUpdate<Value>,
  hooks: ObjectHooks<Value>,
): PropertyDefinitionResult {
  const elements = object.internalArrayElements;
  if (elements !== undefined) {
    const index = elements.keys.index(key);
    if (index >= 0) {
      const count = arrayElementCount<Key, Value>(elements);
      if (index < count && packedElementUpdate<Value>(update, false)) {
        if ((update.fields & valueField) !== 0)
          writeArrayElement<Key, Value>(elements, index, update.value);
        return "accepted";
      }
      if (
        index === count &&
        object.extensible &&
        packedElementUpdate<Value>(update, true)
      ) {
        writeArrayElement<Key, Value>(
          elements,
          index,
          (update.fields & valueField) !== 0
            ? update.value
            : hooks.undefinedValue,
        );
        return "accepted";
      }
      unpackArrayElements<Key, Value>(object, elements);
    }
  }
  const aliases = object.internalDataAliases;
  const alias = aliases === undefined ? undefined : aliases.get(key);
  let applied = update;
  if (
    alias !== undefined &&
    (update.fields & valueField) === 0 &&
    (update.fields & writableField) !== 0 &&
    !update.writable
  )
    applied = {
      ...update,
      fields: update.fields | valueField,
      value: alias.get(),
    };
  const current = ordinaryGetOwnProperty<Key, Value>(object, key);
  const result = applyDescriptor<Value>(
    current,
    object.extensible,
    applied,
    hooks.undefinedValue,
    hooks.sameValue,
  );
  const descriptor = result.descriptor;
  if (result.status === "accepted") {
    if (descriptor === undefined) throw "ACCEPTED_DESCRIPTOR_INVARIANT";
    const contract = object.internalPropertyContract;
    if (contract !== undefined)
      contract.beforeDefine(
        key,
        descriptor,
        current === undefined || (update.fields & valueField) !== 0,
      );
    object.properties.set(key, descriptor);
    object.internalPropertyEpoch++;
    if (aliases !== undefined && alias !== undefined) {
      if (descriptor.accessor) aliases.delete(key);
      else {
        if ((update.fields & valueField) !== 0) alias.set(update.value);
        if (!descriptor.writable) aliases.delete(key);
      }
    }
  }
  return result.status;
}
/** Move packed elements to ordinary descriptors permanently. Index keys are
 * absent from the map while packed, so ordering comes from key classification. */
function unpackArrayElements<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  elements: ArrayElements<Key, Value>,
): void {
  const count = arrayElementCount<Key, Value>(elements);
  for (let index = 0; index < count; index++)
    object.properties.set(
      elements.keys.indexKey(index),
      arrayElementDescriptor<Key, Value>(elements, index),
    );
  object.internalPropertyEpoch++;
  object.internalArrayElements = undefined;
}
/** Create or replace an own data property, without invoking setters. */
export function createDataProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
  value: Value,
  hooks: ObjectHooks<Value>,
): boolean {
  return (
    defineOwnProperty<Key, Value>(
      object,
      key,
      {
        ...emptyUpdate<Value>(hooks.undefinedValue),
        fields:
          valueField | writableField | enumerableField | configurableField,
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      },
      hooks,
    ) === "accepted"
  );
}
/** Define one literal accessor half; the other half survives repeated definitions. */
export function createAccessorProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
  value: Value,
  setter: boolean,
  hooks: ObjectHooks<Value>,
): boolean {
  return (
    defineOwnProperty<Key, Value>(
      object,
      key,
      {
        fields: (setter ? 8 : 4) | 16 | 32,
        value: hooks.undefinedValue,
        writable: false,
        get: setter ? hooks.undefinedValue : value,
        set: setter ? value : hooks.undefinedValue,
        enumerable: true,
        configurable: true,
      },
      hooks,
    ) === "accepted"
  );
}
export function deleteProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
): boolean {
  const method = object.internalMethods?.deleteProperty;
  if (method !== undefined) return method(object, key);
  return ordinaryDeleteProperty<Key, Value>(object, key);
}
export function ordinaryDeleteProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
): boolean {
  const elements = object.internalArrayElements;
  if (elements !== undefined) {
    const index = elements.keys.index(key);
    if (index >= 0) {
      const count = arrayElementCount<Key, Value>(elements);
      if (index >= count) return true;
      if (index === count - 1) {
        truncateArrayElements<Key, Value>(elements, index);
        return true;
      }
      unpackArrayElements<Key, Value>(object, elements);
    }
  }
  const descriptor = object.properties.get(key);
  if (descriptor === undefined) return true;
  if (!descriptor.configurable) return false;
  const contract = object.internalPropertyContract;
  if (contract !== undefined && !contract.canDelete(key)) return false;
  object.properties.delete(key);
  object.internalPropertyEpoch++;
  const aliases = object.internalDataAliases;
  if (aliases !== undefined) aliases.delete(key);
  return true;
}
export function preventExtensions<Key, Value>(
  object: OrdinaryObject<Key, Value>,
): boolean {
  const method = object.internalMethods?.preventExtensions;
  if (method !== undefined) return method(object);
  object.extensible = false;
  return true;
}
export function isExtensible<Key, Value>(
  object: OrdinaryObject<Key, Value>,
): boolean {
  const method = object.internalMethods?.isExtensible;
  return method === undefined ? object.extensible : method(object);
}
export function getPrototype<Key, Value>(
  object: OrdinaryObject<Key, Value>,
): OrdinaryObject<Key, Value> | undefined {
  const method = object.internalMethods?.getPrototype;
  return method === undefined ? object.prototype : method(object);
}
export function setPrototype<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  prototype: OrdinaryObject<Key, Value> | undefined,
): boolean {
  const method = object.internalMethods?.setPrototype;
  if (method !== undefined) return method(object, prototype);
  if (object.prototype === prototype) return true;
  if (object.internalImmutablePrototype || !object.extensible) return false;
  let cursor = prototype;
  while (cursor !== undefined) {
    if (cursor === object) return false;
    // OrdinarySetPrototypeOf stops at a non-ordinary [[GetPrototypeOf]].
    if (cursor.internalMethods?.getPrototype !== undefined) break;
    cursor = cursor.prototype;
  }
  object.prototype = prototype;
  return true;
}
/** Freeze only the prototype identity; own properties can remain extensible. */
export function makePrototypeImmutable<Key, Value>(
  object: OrdinaryObject<Key, Value>,
): void {
  object.internalImmutablePrototype = true;
}
/** Ordinary prototype membership excludes the receiver itself. */
export function hasPrototype<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  prototype: OrdinaryObject<Key, Value>,
): boolean {
  let cursor = getPrototype<Key, Value>(object);
  while (cursor !== undefined) {
    if (cursor === prototype) return true;
    cursor = getPrototype<Key, Value>(cursor);
  }
  return false;
}
export function hasProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
): boolean {
  let cursor: OrdinaryObject<Key, Value> | undefined = object;
  while (cursor !== undefined) {
    const method = cursor.internalMethods?.hasProperty;
    if (method !== undefined) return method(cursor, key);
    if (getOwnProperty<Key, Value>(cursor, key) !== undefined) return true;
    cursor = getPrototype<Key, Value>(cursor);
  }
  return false;
}
/** A per-site cache of one object's own data property cell. Valid while the
 * object's property epoch is unchanged; the cell's [[Value]] is read live. */
export interface PropertyCellCache<Key, Value> {
  object: OrdinaryObject<Key, Value> | undefined;
  epoch: number;
  cell: Descriptor<Value> | undefined;
}
export function createPropertyCellCache<Key, Value>(): PropertyCellCache<
  Key,
  Value
> {
  return { object: undefined, epoch: 0, cell: undefined };
}
/** The cached cell when it is still the live own data descriptor of object. */
export function cachedPropertyCell<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  cache: PropertyCellCache<Key, Value>,
): Descriptor<Value> | undefined {
  return cache.object === object && cache.epoch === object.internalPropertyEpoch
    ? cache.cell
    : undefined;
}
/** Look up and cache an own data property of an entirely ordinary object
 * without arguments aliases; undefined (and nothing cached) otherwise. */
export function refreshPropertyCell<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
  cache: PropertyCellCache<Key, Value>,
): Descriptor<Value> | undefined {
  if (
    object.internalMethods !== undefined ||
    object.internalDataAliases !== undefined ||
    object.internalPropertyContract !== undefined
  )
    return undefined;
  const descriptor = object.properties.get(key);
  if (descriptor === undefined || descriptor.accessor) return undefined;
  cache.object = object;
  cache.epoch = object.internalPropertyEpoch;
  cache.cell = descriptor;
  return descriptor;
}
/** Replace [[Value]] of a stored writable data descriptor in place. */
export function writePropertyCell<Value>(
  cell: Descriptor<Value>,
  value: Value,
): void {
  cell.value = value;
}
/** True when no object on the prototype chain overrides an internal method,
 * so HasProperty and Get are unobservable lookups until a getter runs. */
export function isOrdinaryPrototypeChain<Key, Value>(
  object: OrdinaryObject<Key, Value>,
): boolean {
  let cursor: OrdinaryObject<Key, Value> | undefined = object;
  while (cursor !== undefined) {
    if (cursor.internalMethods !== undefined) return false;
    cursor = cursor.prototype;
  }
  return true;
}
/** The first own property along a chain that isOrdinaryPrototypeChain accepted. */
export function findOrdinaryProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
): Descriptor<Value> | undefined {
  let cursor: OrdinaryObject<Key, Value> | undefined = object;
  while (cursor !== undefined) {
    const descriptor = ordinaryGetOwnProperty<Key, Value>(cursor, key);
    if (descriptor !== undefined) return descriptor;
    cursor = cursor.prototype;
  }
  return undefined;
}
export function getProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
  receiver: Value,
  hooks: ObjectHooks<Value>,
): Value {
  let cursor: OrdinaryObject<Key, Value> | undefined = object;
  while (cursor !== undefined) {
    const method = cursor.internalMethods?.get;
    if (method !== undefined) return method(cursor, key, receiver, hooks);
    const elements = cursor.internalArrayElements;
    if (
      elements !== undefined &&
      cursor.internalMethods?.getOwnProperty === undefined
    ) {
      const index = elements.keys.index(key);
      if (index >= 0) {
        if (index < arrayElementCount<Key, Value>(elements))
          return readArrayElement<Key, Value>(elements, index);
        cursor = getPrototype<Key, Value>(cursor);
        continue;
      }
    }
    const descriptor = getOwnProperty<Key, Value>(cursor, key);
    if (descriptor !== undefined) {
      if (!descriptor.accessor) return descriptor.value;
      if (hooks.sameValue(descriptor.get, hooks.undefinedValue))
        return hooks.undefinedValue;
      return hooks.call(descriptor.get, receiver, []);
    }
    cursor = getPrototype<Key, Value>(cursor);
  }
  return hooks.undefinedValue;
}
export function setProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
  value: Value,
  receiver: Receiver<Key, Value>,
  hooks: ObjectHooks<Value>,
): boolean {
  let cursor: OrdinaryObject<Key, Value> | undefined = object;
  while (cursor !== undefined) {
    const method = cursor.internalMethods?.set;
    if (method !== undefined)
      return method(cursor, key, value, receiver, hooks);
    const elements = cursor.internalArrayElements;
    if (
      elements !== undefined &&
      cursor.internalMethods?.getOwnProperty === undefined
    ) {
      const index = elements.keys.index(key);
      if (index >= 0) {
        if (index >= arrayElementCount<Key, Value>(elements)) {
          cursor = getPrototype<Key, Value>(cursor);
          continue;
        }
        // A present packed element is a writable data property below length,
        // so the receiver's own redefinition only replaces its value. Another
        // receiver gets its own property through the ordinary path.
        if (receiver.object !== cursor) break;
        writeArrayElement<Key, Value>(elements, index, value);
        return true;
      }
    }
    const descriptor = getOwnProperty<Key, Value>(cursor, key);
    if (descriptor !== undefined) {
      if (descriptor.accessor) {
        if (hooks.sameValue(descriptor.set, hooks.undefinedValue)) return false;
        hooks.call(descriptor.set, receiver.value, [value]);
        return true;
      }
      if (!descriptor.writable) return false;
      // OrdinarySetWithOwnDescriptor on the receiver itself redefines only
      // [[Value]]. An entirely ordinary object without an arguments alias for
      // the key cannot observe that define, so store the result directly.
      const aliases = object.internalDataAliases;
      if (
        cursor === object &&
        receiver.object === object &&
        object.internalMethods === undefined &&
        object.internalPropertyContract === undefined &&
        (aliases === undefined || !aliases.has(key))
      ) {
        // The stored descriptor is this object's own cell (no alias built a
        // copy), so the value is replaced in place and caches stay valid.
        writePropertyCell<Value>(descriptor, value);
        return true;
      }
      break;
    }
    cursor = getPrototype<Key, Value>(cursor);
  }
  return writeReceiverProperty<Key, Value>(key, value, receiver, hooks);
}
function writeReceiverProperty<Key, Value>(
  key: Key,
  value: Value,
  receiver: Receiver<Key, Value>,
  hooks: ObjectHooks<Value>,
): boolean {
  const target = receiver.object;
  if (target === undefined) return false;
  const existing = getOwnProperty<Key, Value>(target, key);
  if (existing !== undefined && (existing.accessor || !existing.writable))
    return false;
  const update: DescriptorUpdate<Value> = {
    ...emptyUpdate<Value>(hooks.undefinedValue),
    fields: existing === undefined ? 51 : 1,
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  };
  return (
    defineOwnProperty<Key, Value>(target, key, update, hooks) === "accepted"
  );
}
/** keyOrder is a pure internal classifier: array index 0..2^32-2, -1 for other
 * strings, -2 for symbols. Stable sorting retains insertion order within the latter groups. */
export function ownKeys<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  keyOrder: (key: Key) => number,
): Key[] {
  const method = object.internalMethods?.ownKeys;
  if (method !== undefined) return method(object);
  return ordinaryOwnKeys<Key, Value>(object, keyOrder);
}
export function ordinaryOwnKeys<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  keyOrder: (key: Key) => number,
): Key[] {
  const keys: Key[] = [];
  for (const [key, descriptor] of object.properties) keys.push(key);
  const elements = object.internalArrayElements;
  if (elements !== undefined) {
    // Packed indices precede every map key, which holds no array index.
    const ordered: Key[] = [];
    const count = arrayElementCount<Key, Value>(elements);
    for (let index = 0; index < count; index++)
      ordered.push(elements.keys.indexKey(index));
    const sorted = sortPropertyKeys<Key>(keys, keyOrder);
    for (let position = 0; position < sorted.length; position++) {
      const key = sorted[position];
      if (key === undefined) throw "PROPERTY_KEY_INVARIANT";
      ordered.push(key);
    }
    return ordered;
  }
  return sortPropertyKeys<Key>(keys, keyOrder);
}
function sortPropertyKeys<Key>(
  keys: Key[],
  keyOrder: (key: Key) => number,
): Key[] {
  keys.sort((left, right): number => {
    if (left === undefined || right === undefined)
      throw "PROPERTY_KEY_INVARIANT";
    const a = keyOrder(left),
      b = keyOrder(right);
    const groupA = a >= 0 ? 0 : a === -1 ? 1 : 2,
      groupB = b >= 0 ? 0 : b === -1 ? 1 : 2;
    return groupA !== groupB ? groupA - groupB : groupA === 0 ? a - b : 0;
  });
  return keys;
}

/** Ordinary fallbacks skip only this object's override. Prototype and descriptor
 * operations still dispatch normally, including through other exotic objects. */
export function ordinaryHasProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
): boolean {
  if (getOwnProperty<Key, Value>(object, key) !== undefined) return true;
  const parent = getPrototype<Key, Value>(object);
  return parent !== undefined && hasProperty<Key, Value>(parent, key);
}
export function ordinaryGetProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
  receiver: Value,
  hooks: ObjectHooks<Value>,
): Value {
  const descriptor = getOwnProperty<Key, Value>(object, key);
  if (descriptor !== undefined) {
    if (!descriptor.accessor) return descriptor.value;
    if (hooks.sameValue(descriptor.get, hooks.undefinedValue))
      return hooks.undefinedValue;
    return hooks.call(descriptor.get, receiver, []);
  }
  const parent = getPrototype<Key, Value>(object);
  return parent === undefined
    ? hooks.undefinedValue
    : getProperty<Key, Value>(parent, key, receiver, hooks);
}
export function ordinarySetProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
  value: Value,
  receiver: Receiver<Key, Value>,
  hooks: ObjectHooks<Value>,
): boolean {
  const descriptor = getOwnProperty<Key, Value>(object, key);
  if (descriptor === undefined) {
    const parent = getPrototype<Key, Value>(object);
    if (parent !== undefined)
      return setProperty<Key, Value>(parent, key, value, receiver, hooks);
  } else {
    if (descriptor.accessor) {
      if (hooks.sameValue(descriptor.set, hooks.undefinedValue)) return false;
      hooks.call(descriptor.set, receiver.value, [value]);
      return true;
    }
    if (!descriptor.writable) return false;
  }
  return writeReceiverProperty<Key, Value>(key, value, receiver, hooks);
}

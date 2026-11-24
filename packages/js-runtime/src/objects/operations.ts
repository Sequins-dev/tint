import type { WeakData } from "./weak-storage.ts";
import { hashString } from "@tint/foundation/collections/key-index";
import { canonicalNumericIndex } from "./integer-index.ts";
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
import type { ScriptPropertyKey } from "./symbols.ts";
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
  /** Fast mode (internalDictionary false): the shared shape of the own
   * properties, whose values are internalValue0..7 and internalValues in
   * key order; undefined while the object has none and its prototype has no
   * root shape yet. Dictionary mode: undefined. It is the first field, so a
   * generated cache compares the first word of any object record: no other
   * record a JavaScript value can hold has a shape in that word. */
  internalShape: OrdinaryPropertyShape<Key, Value> | undefined;
  prototype: OrdinaryObject<Key, Value> | undefined;
  extensible: boolean;
  /** Dictionary-mode own properties. In fast mode, allocated lazily only for
   * accessor keys' descriptors (data values live in the shape's slots). */
  properties: Map<Key, Descriptor<Value>> | undefined;
  /** Bumped whenever a key is added or deleted or a stored descriptor is
   * replaced. Only an in-place [[Value]] write to a writable data descriptor
   * leaves it unchanged, so a cached descriptor of a dictionary-mode object
   * stays the live cell. Generated transitions of fast-mode objects, which
   * hold no descriptors to cache, do not bump it. */
  internalPropertyEpoch: number;
  /** Root of the shared shapes of objects whose [[Prototype]] is this
   * object, so equal shapes also imply the same prototype. */
  internalChildShape: OrdinaryPropertyShape<Key, Value> | undefined;
  /** Own properties live in `properties` with full descriptors: exotic,
   * aliased and contracted objects, the global object, and objects that
   * deleted a property, defined a canonical numeric key or more than
   * maxFastKeys keys, or prevented extensions. Permanent. */
  internalDictionary: boolean;
  /** Set once the object is some object's [[Prototype]]: its structural
   * changes then invalidate cached transitions (propertyEpoch), and its
   * shapes are private, so no cached transition starts at one. */
  internalUsedAsPrototype: boolean;
  /** Fast-mode values of the shape's keys from propertySlots on. */
  internalValues: Value[] | undefined;
  /** Internal [[Call]], never a named/inherited JavaScript property. */
  readonly internalCall: ObjectCall<Value> | undefined;
  internalRegisterCall: ObjectRegisterEntry<Value> | undefined;
  readonly internalConstruct: ObjectConstruct<Value> | undefined;
  readonly internalExecutionContext: ObjectExecutionContext<Value> | undefined;
  internalArrayData: boolean;
  /** Packed own elements; present only on array exotic objects until a
   * property operation requires ordinary descriptors for their indices. */
  internalArrayElements: ArrayElements<Key, Value> | undefined;
  readonly internalMethods: ObjectInternalMethods<Key, Value> | undefined;
  /** Lazily allocated side record for rarely-present generic ordinary-object
   * internal slots (bound targets, super homes, tail dispatchers, private
   * elements, arguments aliases, contracts, immutable prototypes, indexed
   * dictionary layouts). Undefined on ordinary objects. */
  internalRareSlots: OrdinaryRareSlots<Key, Value> | undefined;
  /** Lazily allocated side record for rarely-present builtin and exotic
   * internal slots. Undefined on ordinary objects; read via exoticSlots and
   * initialized via ensureExoticSlots. */
  internalExoticSlots: ExoticObjectSlots | undefined;
  /** Fast-mode values of the shape's first propertySlots keys, in place so
   * generated caches load and store them at a computed offset. Undefined
   * (no value) past the shape's keys; a present JavaScript undefined is
   * the shape's undefinedValue. */
  internalValue0: Value | undefined;
  internalValue1: Value | undefined;
  internalValue2: Value | undefined;
  internalValue3: Value | undefined;
  internalValue4: Value | undefined;
  internalValue5: Value | undefined;
  internalValue6: Value | undefined;
  internalValue7: Value | undefined;
}
/** Generic internal slots present only on specialized ordinary objects.
 * Allocated lazily via ensureRareSlots so plain instances stay compact. */
export interface OrdinaryRareSlots<Key, Value> {
  internalImmutablePrototype: boolean;
  /** Presence of [[ParameterMap]], including unmapped arguments objects. */
  internalArgumentsData: boolean;
  /** Lazy numeric-key view of own descriptor storage. Null is an empty view. */
  internalIndexedProperties: IndexedPropertyLayout<Value> | null | undefined;
  internalPropertyContract: PropertyWriteContract<Key, Value> | undefined;
  internalPrivateElements: PrivateElement<Value>[] | undefined;
  /** Compiler/runtime-owned call steps. Each step owns and restores its context
   * before returning a transfer; JavaScript return values never select a step. */
  internalTailDispatch: ObjectTailDispatch<Key, Value> | undefined;
  internalBoundTarget: OrdinaryObject<Key, Value> | undefined;
  /** Definition-time [[HomeObject]] for super; independent of call receiver. */
  internalHomeObject: OrdinaryObject<Key, Value> | undefined;
  internalDataAliases: Map<Key, DataAlias<Value>> | undefined;
}
/** Internal slots present only on specific builtin, exotic, error or host
 * objects. Kept out of OrdinaryObject so ordinary instances stay compact. */
export interface ExoticObjectSlots {
  /** Built-in [[InitialName]], independent of the mutable public name property. */
  internalInitialName: string | undefined;
  internalSourceText: string | undefined;
  internalPromiseData: PromiseRecord<unknown> | undefined;
  internalAwaitOperation: NativeAwaitOperation<unknown> | undefined;
  /** Agent-unique identity for weak-collection indexing, 0 until first needed.
   * A number, so indexes keyed by it never retain the object. */
  internalIdentity: number;
  internalGeneratorData: GeneratorRecord<unknown> | undefined;
  internalAsyncGeneratorData:
    | {
        readonly record: AsyncGeneratorRecord<unknown>;
        readonly hooks: AsyncGeneratorHooks<unknown>;
        readonly context: ScriptExecutionContext;
      }
    | undefined;
  internalArrayIteratorData:
    | {
        iterated: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
        index: number;
        readonly kind: "key" | "value" | "entry";
      }
    | undefined;
  /** Frozen primitive JSON text; presence is the non-proxy-forwarding raw JSON brand. */
  internalRawJSON: string | undefined;
  internalModuleSourceClassName: string | undefined;
  internalShadowRealm: ShadowRealmHost | undefined;
  /** Presence of [[ErrorData]], independent of the object's prototype chain. */
  internalErrorData: boolean;
  /** Creation-time logical stack, independent of the public stack property. */
  internalErrorStack: string | undefined;
  /** Typed error operations supplied by a mixed-program boundary adapter. */
  internalTypedErrorAccess: ((operation: string) => unknown) | undefined;
  internalDisposableStack: DisposalStack<unknown> | undefined;
  internalAsyncDisposableStack: DisposalStack<unknown> | undefined;
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
  internalArrayBufferData: ByteStorage | undefined;
  internalSharedArrayBufferData: SharedBlockStorage | undefined;
  internalArrayBufferView: boolean;
  internalDataViewData: DataViewData | undefined;
  internalTypedArrayData: TypedArrayData | undefined;
  internalProxyData: ProxyState<ScriptPropertyKey, unknown> | undefined;
  internalSetData: LinkedMap<unknown, unknown> | undefined;
  internalSetIteratorData:
    | {
        readonly cursor: MapCursor<unknown, unknown>;
        readonly entries: boolean;
      }
    | undefined;
  internalMapData: LinkedMap<unknown, unknown> | undefined;
  internalWeakData: WeakData | undefined;
  internalMapIteratorData:
    | {
        readonly cursor: MapCursor<unknown, unknown>;
        readonly kind: "key" | "value" | "entry";
      }
    | undefined;
  internalSyncIteratorData: IteratorRecord<unknown> | undefined;
  /** Separate [[Iterated]] brand from async-from-sync wrappers. */
  internalWrappedIteratorData: IteratorRecord<unknown> | undefined;
  internalIteratorHelperData:
    | {
        readonly generator: GeneratorRecord<unknown>;
        readonly close: () => void;
      }
    | undefined;
  internalRegExpIteratorData: RegExpIteratorData | undefined;
  internalStringIteratorData:
    { text: string | undefined; index: number } | undefined;
  internalPrimitiveData:
    | {
        readonly kind: "number" | "boolean" | "string" | "symbol" | "bigint";
        readonly value: unknown;
      }
    | undefined;
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
export type ObjectScriptCall<Value> = (
  callee: Value,
  receiver: Value,
  newTarget: Value,
  arguments_: readonly Value[] | undefined,
) => Value;
export type ObjectRegisterCall<Value> = (
  callee: Value,
  receiver: Value,
  newTarget: Value,
  count: number,
  first: Value,
  second: Value,
) => Value;
export type ObjectWideRegisterCall<Value> = (
  callee: Value,
  receiver: Value,
  newTarget: Value,
  count: number,
  first: Value,
  second: Value,
  third: Value,
  fourth: Value,
  fifth: Value,
  sixth: Value,
) => Value;
export interface ObjectRegisterEntry<Value> {
  readonly context: ScriptExecutionContext;
  /** Stack-trace name and caller policy (SourceCallerPolicy) of the source
   * function, for native activation records naming it as their callee. */
  readonly traceName: string;
  readonly callerPolicy: string;
  /** Whether its [[Construct]] is the ordinary one of a base source
   * function (OrdinaryCreateFromConstructor, then the body). */
  readonly constructible: boolean;
  readonly invoke: ObjectRegisterCall<Value> | undefined;
  readonly invokeWide: ObjectWideRegisterCall<Value> | undefined;
  readonly scriptInvoke?: ObjectScriptCall<Value>;
}
/** The ordered keys of a fast-mode object's own data properties and the
 * attributes of each (propertyWritable | propertyEnumerable |
 * propertyConfigurable). Shapes reached by the same keys and attributes from
 * the same prototype's root are one shared object, so caches compare
 * identities, and a matching shape proves a cached slot's attributes. */
export interface OrdinaryPropertyShape<Key, Value> {
  readonly keys: readonly Key[];
  readonly kinds: readonly number[];
  readonly hash: number;
  /** Whether successors are shared (false for a null prototype's shapes
   * and past the key and successor limits). Shared successors form a list
   * (firstSuccessor, nextSibling) keyed by their last key and kind; records
   * instead of a map keep the runtime's collection instantiations
   * unchanged. */
  readonly shared: boolean;
  firstSuccessor: OrdinaryPropertyShape<Key, Value> | undefined;
  readonly nextSibling: OrdinaryPropertyShape<Key, Value> | undefined;
  successors: number;
  /** The realm's undefined: a value slot holding no value reads as it. */
  readonly undefinedValue: Value;
  /** String key positions, built on first lookup for shapes past
   * indexedShapeKeys keys (shapes never change their keys). A map with
   * string keys reuses the runtime's existing collection instantiation;
   * symbol keys are scanned. */
  index: Map<string, number> | undefined;
}
type ScriptObject = OrdinaryObject<ScriptPropertyKey, unknown>;
type ScriptShape = OrdinaryPropertyShape<ScriptPropertyKey, unknown>;
interface IndexedPropertyLayout<Value> {
  readonly keys: Float64Array;
  readonly cells: readonly Descriptor<Value>[];
}
interface ScriptPropertyCacheEntry {
  name: string;
  receiver: ScriptShape | undefined;
  parent: ScriptShape | undefined;
  ancestor: ScriptShape | undefined;
  holder: ScriptShape | undefined;
  offset: number;
}
/** Bumped by every structural change of an object used as a prototype
 * outside generated caches, so cached transitions (which add writable data
 * properties only) know no setter or read-only property appeared on a
 * receiver's chain. */
export interface PropertyEpoch {
  value: number;
}
export const propertyEpoch: PropertyEpoch = { value: 0 };
/** Inline entries per site for reads (IR property-load `entries`): own and
 * inherited entries each, filled in order and then kept. */
export const propertyCacheEntries = 4;
export interface ScriptPropertyCache {
  /** The own entries as generated code reads them (IR property-load), each
   * the receiver shape and the value's raw-bit word index (inlineSlotBits).
   * The inherited entries follow, read by method sites (`method`), each the
   * receiver shape, the word index and the holder (undefined for a property
   * of the receiver itself), then the
   * propertyEpoch value they were found under and the epoch record itself. A receiver shape implies
   * its prototype (prototypes have private shapes, and changing an
   * object's prototype reshapes it), and every structural change of a
   * prototype advances the epoch, so an unchanged epoch keeps the whole
   * chain down to each holder. Then the newest store: the receiver shape,
   * the value's word index, the shape a transition reaches (undefined for
   * a store to an existing property) and the propertyEpoch value the
   * transition was found under. The fields are first and consecutive; an
   * empty shape is unusedPropertyShape. Values past the in-place slots
   * take the miss path. */
  ownShape: ScriptShape;
  ownSlot: number;
  ownShape1: ScriptShape;
  ownSlot1: number;
  ownShape2: ScriptShape;
  ownSlot2: number;
  ownShape3: ScriptShape;
  ownSlot3: number;
  inheritedShape: ScriptShape;
  inheritedSlot: number;
  inheritedObject: ScriptObject | undefined;
  inheritedShape1: ScriptShape;
  inheritedSlot1: number;
  inheritedObject1: ScriptObject | undefined;
  inheritedShape2: ScriptShape;
  inheritedSlot2: number;
  inheritedObject2: ScriptObject | undefined;
  inheritedShape3: ScriptShape;
  inheritedSlot3: number;
  inheritedObject3: ScriptObject | undefined;
  inheritedEpoch: number;
  readonly inheritedEpochs: PropertyEpoch;
  storeShape: ScriptShape;
  storeSlot: number;
  storeTransition: ScriptShape | undefined;
  storeEpoch: number;
  readonly epoch: PropertyEpoch;
  /** The shape index of the property the last lookup found. */
  foundIndex: number;
  readonly first: ScriptPropertyCacheEntry;
  readonly entries: readonly ScriptPropertyCacheEntry[];
  readonly nameHash: number;
  used: number;
  megamorphic: boolean;
  /** A method site (`o.m()`) reads only its inherited entries, so it keeps
   * the receiver's own properties there too, with no holder. */
  readonly method: boolean;
}
function propertyCacheEntry(): ScriptPropertyCacheEntry {
  return {
    name: "",
    receiver: undefined,
    parent: undefined,
    ancestor: undefined,
    holder: undefined,
    offset: 0,
  };
}
export function createScriptPropertyCache(
  name: string = "",
  method: boolean = false,
): ScriptPropertyCache {
  const first = propertyCacheEntry();
  return {
    ownShape: unusedPropertyShape,
    ownSlot: 0,
    ownShape1: unusedPropertyShape,
    ownSlot1: 0,
    ownShape2: unusedPropertyShape,
    ownSlot2: 0,
    ownShape3: unusedPropertyShape,
    ownSlot3: 0,
    inheritedShape: unusedPropertyShape,
    inheritedSlot: 0,
    inheritedObject: undefined,
    inheritedShape1: unusedPropertyShape,
    inheritedSlot1: 0,
    inheritedObject1: undefined,
    inheritedShape2: unusedPropertyShape,
    inheritedSlot2: 0,
    inheritedObject2: undefined,
    inheritedShape3: unusedPropertyShape,
    inheritedSlot3: 0,
    inheritedObject3: undefined,
    inheritedEpoch: 0,
    inheritedEpochs: propertyEpoch,
    storeShape: unusedPropertyShape,
    storeSlot: 0,
    storeTransition: undefined,
    storeEpoch: 0,
    epoch: propertyEpoch,
    foundIndex: -1,
    first,
    entries: [
      first,
      propertyCacheEntry(),
      propertyCacheEntry(),
      propertyCacheEntry(),
    ],
    nameHash: hashString(name),
    used: 0,
    megamorphic: false,
    method,
  };
}
export interface ScriptPropertyStubCache {
  readonly buckets: readonly ScriptPropertyCacheEntry[];
}
export function createScriptPropertyStubCache(): ScriptPropertyStubCache {
  const buckets: ScriptPropertyCacheEntry[] = [];
  for (let i = 0; i < 256; i++) buckets.push(propertyCacheEntry());
  return { buckets };
}
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
function createExoticSlots(): ExoticObjectSlots {
  return {
    internalInitialName: undefined,
    internalSourceText: undefined,
    internalPromiseData: undefined,
    internalAwaitOperation: undefined,
    internalIdentity: 0,
    internalGeneratorData: undefined,
    internalAsyncGeneratorData: undefined,
    internalArrayIteratorData: undefined,
    internalRawJSON: undefined,
    internalModuleSourceClassName: undefined,
    internalShadowRealm: undefined,
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
    internalMapIteratorData: undefined,
    internalSyncIteratorData: undefined,
    internalWrappedIteratorData: undefined,
    internalIteratorHelperData: undefined,
    internalRegExpIteratorData: undefined,
    internalStringIteratorData: undefined,
    internalPrimitiveData: undefined,
  };
}
/** Shared read-only defaults for objects without exotic slots; never mutate. */
const emptyExoticSlots: ExoticObjectSlots = createExoticSlots();
/** The internal slots few objects have: a builtin kind's data ([[DateValue]],
 * [[RegExpMatcher]], [[MapData]], ...) and rarely read function and error
 * details. Every read goes through exoticSlots (an object without any reads
 * the defaults: undefined or false) and every write through
 * ensureExoticSlots. */
export function exoticSlots(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
): ExoticObjectSlots {
  const slots = object.internalExoticSlots;
  return slots === undefined ? emptyExoticSlots : slots;
}
/** The exotic slots of `object` for a write. Neither function is generic:
 * every object with such slots is a script object. */
export function ensureExoticSlots(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
): ExoticObjectSlots {
  const existing = object.internalExoticSlots;
  if (existing !== undefined) return existing;
  const created = createExoticSlots();
  object.internalExoticSlots = created;
  return created;
}
export function ensureRareSlots<Key, Value>(
  object: OrdinaryObject<Key, Value>,
): OrdinaryRareSlots<Key, Value> {
  const existing = object.internalRareSlots;
  if (existing !== undefined) return existing;
  const created: OrdinaryRareSlots<Key, Value> = {
    internalImmutablePrototype: false,
    internalArgumentsData: false,
    internalIndexedProperties: undefined,
    internalPropertyContract: undefined,
    internalPrivateElements: undefined,
    internalTailDispatch: undefined,
    internalBoundTarget: undefined,
    internalHomeObject: undefined,
    internalDataAliases: undefined,
  };
  object.internalRareSlots = created;
  return created;
}
export function createObject<Key, Value>(
  prototype: OrdinaryObject<Key, Value> | undefined,
): OrdinaryObject<Key, Value> {
  if (prototype !== undefined && !prototype.internalUsedAsPrototype)
    markPrototype<Key, Value>(prototype);
  return {
    internalShape:
      prototype === undefined ? undefined : prototype.internalChildShape,
    prototype,
    extensible: true,
    properties: undefined,
    internalPropertyEpoch: 0,
    internalChildShape: undefined,
    internalDictionary: false,
    internalUsedAsPrototype: false,
    internalValues: undefined,
    internalCall: undefined,
    internalRegisterCall: undefined,
    internalConstruct: undefined,
    internalExecutionContext: undefined,
    internalArrayData: false,
    internalArrayElements: undefined,
    internalMethods: undefined,
    internalRareSlots: undefined,
    internalExoticSlots: undefined,
    internalValue0: undefined,
    internalValue1: undefined,
    internalValue2: undefined,
    internalValue3: undefined,
    internalValue4: undefined,
    internalValue5: undefined,
    internalValue6: undefined,
    internalValue7: undefined,
  };
}
/** Only ordinary data storage and the standard Array exotic can enroll. */
export function acceptsPropertyContract<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  allowCallable: boolean = false,
): boolean {
  const rare = object.internalRareSlots;
  return (
    (object.internalMethods === undefined || object.internalArrayData) &&
    (rare === undefined ||
      (rare.internalDataAliases === undefined &&
        !rare.internalArgumentsData)) &&
    (allowCallable ||
      (object.internalCall === undefined &&
        object.internalConstruct === undefined))
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
  // Contract checks run on descriptor storage.
  useDictionaryProperties<Key, Value>(object);
  // Contracted array writes use the existing descriptor guard. Transfer the
  // packed elements without invoking any user code or changing their keys.
  const elements = object.internalArrayElements;
  if (elements !== undefined) unpackArrayElements<Key, Value>(object, elements);
  ensureRareSlots<Key, Value>(object).internalPropertyContract = contract;
  noteStructureChange<Key, Value>(object);
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
function ensureProperties<Key, Value>(
  object: OrdinaryObject<Key, Value>,
): Map<Key, Descriptor<Value>> {
  const existing = object.properties;
  if (existing !== undefined) return existing;
  const created = new Map<Key, Descriptor<Value>>();
  object.properties = created;
  return created;
}
/** Attach only to an existing writable data property. This is an internal
 * construction operation; source property redefinition uses defineOwnProperty. */
export function aliasDataProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
  alias: DataAlias<Value>,
): void {
  const rare = object.internalRareSlots;
  const aliases = rare === undefined ? undefined : rare.internalDataAliases;
  const properties = object.properties;
  const descriptor = properties === undefined ? undefined : properties.get(key);
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
  const dictionary =
    internalMethods !== undefined || internalDataAliases !== undefined;
  if (prototype !== undefined && !prototype.internalUsedAsPrototype)
    markPrototype<Key, Value>(prototype);
  const internalRareSlots: OrdinaryRareSlots<Key, Value> | undefined =
    internalDataAliases === undefined
      ? undefined
      : {
          internalImmutablePrototype: false,
          internalArgumentsData: false,
          internalIndexedProperties: undefined,
          internalPropertyContract: undefined,
          internalPrivateElements: undefined,
          internalTailDispatch: undefined,
          internalBoundTarget: undefined,
          internalHomeObject: undefined,
          internalDataAliases,
        };
  return {
    // A fast object starts at its prototype's root shape once one exists.
    internalShape:
      dictionary || prototype === undefined
        ? undefined
        : prototype.internalChildShape,
    prototype,
    extensible: true,
    properties: dictionary ? new Map<Key, Descriptor<Value>>() : undefined,
    internalPropertyEpoch: 0,
    internalChildShape: undefined,
    internalDictionary: dictionary,
    internalUsedAsPrototype: false,
    internalValues: undefined,
    internalCall,
    internalRegisterCall: undefined,
    internalConstruct,
    internalExecutionContext,
    internalArrayData: false,
    internalArrayElements: undefined,
    internalMethods,
    internalRareSlots,
    internalExoticSlots: undefined,
    internalValue0: undefined,
    internalValue1: undefined,
    internalValue2: undefined,
    internalValue3: undefined,
    internalValue4: undefined,
    internalValue5: undefined,
    internalValue6: undefined,
    internalValue7: undefined,
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
  if (!object.internalDictionary) {
    const shape = object.internalShape;
    const index =
      shape === undefined ? -1 : shapeKeyIndex<Key, Value>(shape, key);
    return shape === undefined || index < 0
      ? undefined
      : fastDescriptor<Key, Value>(object, shape, index);
  }
  const properties = object.properties;
  const descriptor = properties === undefined ? undefined : properties.get(key);
  if (descriptor === undefined) return undefined;
  const rare = object.internalRareSlots;
  const aliases = rare === undefined ? undefined : rare.internalDataAliases;
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
  if (!object.internalDictionary) {
    const shape = object.internalShape;
    const index =
      shape === undefined ? -1 : shapeKeyIndex<Key, Value>(shape, key);
    const current =
      shape === undefined || index < 0
        ? undefined
        : fastDescriptor<Key, Value>(object, shape, index);
    const result = applyDescriptor<Value>(
      current,
      object.extensible,
      update,
      hooks.undefinedValue,
      hooks.sameValue,
    );
    const descriptor = result.descriptor;
    if (result.status !== "accepted") return result.status;
    if (descriptor === undefined) throw "ACCEPTED_DESCRIPTOR_INVARIANT";
    if (fastKey<Key>(key)) {
      const kind = descriptorKind<Value>(descriptor);
      const value = descriptor.accessor
        ? hooks.undefinedValue
        : descriptor.value;
      if (shape !== undefined && index >= 0) {
        const previous = shape.kinds[index] ?? 0;
        if (descriptor.accessor)
          ensureProperties<Key, Value>(object).set(key, descriptor);
        else if ((previous & propertyAccessor) !== 0) {
          const properties = object.properties;
          if (properties !== undefined) properties.delete(key);
        }
        if (previous !== kind)
          reshapeFastProperty<Key, Value>(object, shape, index, kind);
        setFastValue<Key, Value>(object, index, value);
        return "accepted";
      }
      const base =
        shape === undefined
          ? rootPropertyShape<Key, Value>(object, hooks.undefinedValue)
          : shape;
      if (base.keys.length < maxFastKeys) {
        if (descriptor.accessor)
          ensureProperties<Key, Value>(object).set(key, descriptor);
        addFastProperty<Key, Value>(object, base, key, kind, value);
        return "accepted";
      }
    }
    useDictionaryProperties<Key, Value>(object);
    ensureProperties<Key, Value>(object).set(key, descriptor);
    noteStructureChange<Key, Value>(object);
    return "accepted";
  }
  const rare = object.internalRareSlots;
  const aliases = rare === undefined ? undefined : rare.internalDataAliases;
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
    const contract =
      rare === undefined ? undefined : rare.internalPropertyContract;
    if (contract !== undefined)
      contract.beforeDefine(
        key,
        descriptor,
        current === undefined || (update.fields & valueField) !== 0,
      );
    ensureProperties<Key, Value>(object).set(key, descriptor);
    noteStructureChange<Key, Value>(object);
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
  const properties = ensureProperties<Key, Value>(object);
  const count = arrayElementCount<Key, Value>(elements);
  for (let index = 0; index < count; index++)
    properties.set(
      elements.keys.indexKey(index),
      arrayElementDescriptor<Key, Value>(elements, index),
    );
  noteStructureChange<Key, Value>(object);
  object.internalArrayElements = undefined;
}
/** Create or replace an own data property, without invoking setters. */
export function createDataProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
  value: Value,
  hooks: ObjectHooks<Value>,
): boolean {
  // A new property on an ordinary extensible object already has a complete,
  // valid descriptor. Existing properties and exotic objects still use
  // DefineOwnProperty for redefinitions, aliases and length constraints.
  if (!object.internalDictionary) {
    const shape = object.internalShape;
    if (
      object.extensible &&
      fastKey<Key>(key) &&
      (shape === undefined || shapeKeyIndex<Key, Value>(shape, key) < 0)
    ) {
      const base =
        shape === undefined
          ? rootPropertyShape<Key, Value>(object, hooks.undefinedValue)
          : shape;
      if (base.keys.length < maxFastKeys) {
        addFastProperty<Key, Value>(
          object,
          base,
          key,
          propertyWritable | propertyEnumerable | propertyConfigurable,
          value,
        );
        return true;
      }
    }
  } else if (
    object.internalMethods === undefined &&
    object.internalArrayElements === undefined &&
    object.extensible
  ) {
    const rare = object.internalRareSlots;
    const existing = object.properties;
    if (
      (rare === undefined ||
        (rare.internalDataAliases === undefined &&
          rare.internalPropertyContract === undefined)) &&
      (existing === undefined || !existing.has(key))
    ) {
      const descriptor: Descriptor<Value> = {
        accessor: false,
        value,
        writable: true,
        get: hooks.undefinedValue,
        set: hooks.undefinedValue,
        enumerable: true,
        configurable: true,
      };
      const target =
        existing === undefined
          ? ensureProperties<Key, Value>(object)
          : existing;
      target.set(key, descriptor);
      noteStructureChange<Key, Value>(object);
      return true;
    }
  }
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
  if (!object.internalDictionary) {
    const shape = object.internalShape;
    const index =
      shape === undefined ? -1 : shapeKeyIndex<Key, Value>(shape, key);
    if (shape === undefined || index < 0) return true;
    if (((shape.kinds[index] ?? 0) & propertyConfigurable) === 0) return false;
    useDictionaryProperties<Key, Value>(object);
  }
  const properties = object.properties;
  const descriptor = properties === undefined ? undefined : properties.get(key);
  if (descriptor === undefined) return true;
  if (!descriptor.configurable) return false;
  const rare = object.internalRareSlots;
  const contract =
    rare === undefined ? undefined : rare.internalPropertyContract;
  if (contract !== undefined && !contract.canDelete(key)) return false;
  if (properties !== undefined) properties.delete(key);
  noteStructureChange<Key, Value>(object);
  const aliases = rare === undefined ? undefined : rare.internalDataAliases;
  if (aliases !== undefined) aliases.delete(key);
  return true;
}
export function preventExtensions<Key, Value>(
  object: OrdinaryObject<Key, Value>,
): boolean {
  const method = object.internalMethods?.preventExtensions;
  if (method !== undefined) return method(object);
  // Cached transitions rely on fast-mode objects being extensible.
  useDictionaryProperties<Key, Value>(object);
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
  const rare = object.internalRareSlots;
  if (
    (rare !== undefined && rare.internalImmutablePrototype) ||
    !object.extensible
  )
    return false;
  let cursor = prototype;
  while (cursor !== undefined) {
    if (cursor === object) return false;
    // OrdinarySetPrototypeOf stops at a non-ordinary [[GetPrototypeOf]].
    if (cursor.internalMethods?.getPrototype !== undefined) break;
    cursor = cursor.prototype;
  }
  object.prototype = prototype;
  if (prototype !== undefined && !prototype.internalUsedAsPrototype)
    markPrototype<Key, Value>(prototype);
  // Shapes grow from the prototype's root: replay the keys from the new one.
  const shape = object.internalShape;
  if (!object.internalDictionary && shape !== undefined)
    object.internalShape = replayPropertyShape<Key, Value>(
      object,
      shape,
      -1,
      0,
    );
  else if (!object.internalDictionary)
    // An empty prototype grows a private shape when it gets a property.
    object.internalShape =
      prototype === undefined || object.internalUsedAsPrototype
        ? undefined
        : prototype.internalChildShape;
  noteStructureChange<Key, Value>(object);
  return true;
}
/** Freeze only the prototype identity; own properties can remain extensible. */
export function makePrototypeImmutable<Key, Value>(
  object: OrdinaryObject<Key, Value>,
): void {
  ensureRareSlots<Key, Value>(object).internalImmutablePrototype = true;
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
    if (!cursor.internalDictionary) {
      const shape = cursor.internalShape;
      if (shape !== undefined && shapeKeyIndex<Key, Value>(shape, key) >= 0)
        return true;
      cursor = cursor.prototype;
      continue;
    }
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
/** Look up and cache an own data property of an entirely ordinary
 * dictionary-mode object without arguments aliases; undefined (and nothing
 * cached) otherwise. */
export function refreshPropertyCell<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
  cache: PropertyCellCache<Key, Value>,
): Descriptor<Value> | undefined {
  const rare = object.internalRareSlots;
  if (
    !object.internalDictionary ||
    object.internalMethods !== undefined ||
    (rare !== undefined &&
      (rare.internalDataAliases !== undefined ||
        rare.internalPropertyContract !== undefined))
  )
    return undefined;
  const properties = object.properties;
  const descriptor = properties === undefined ? undefined : properties.get(key);
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

/** Attributes a shape records for a fast-mode key: an open bit set, and
 * transitions key on the exact kind, so a new bit gives new shapes. */
const propertyWritable = 1,
  propertyEnumerable = 2,
  propertyConfigurable = 4,
  /** An accessor: its descriptor stays in `properties` and its value slot
   * holds no value. */
  propertyAccessor = 8;
/** Kinds whose value is not a plain general value in the object's own value
 * slots, so site caches, cached stores and cached transitions leave them to
 * the ordinary lookup. Kinds added later for values held elsewhere or for
 * checked stores (docs/design-typed-classes.md, record-backed views) belong
 * in this mask until generated code learns their hit sequences. */
const propertyNotInlineData = propertyAccessor;
/** Whether a key of this kind holds a writable plain data value in place,
 * which cached stores may overwrite and cached transitions may shadow. */
function inlineWritableData(kind: number): boolean {
  return (
    (kind & propertyWritable) !== 0 && (kind & propertyNotInlineData) === 0
  );
}
/** Fast-mode objects past this many keys move to dictionary mode, so a key
 * lookup stays a bounded scan of the shape. */
const maxFastKeys = 128;
/** Keys fast mode holds: symbols and strings other than canonical numeric
 * strings (numeric keys use the dictionary's indexed view). */
function fastKey<Key>(key: Key): boolean {
  const candidate: unknown = key;
  return (
    typeof candidate !== "string" ||
    canonicalNumericIndex(candidate) === undefined
  );
}
/** The shape kind of a complete descriptor. */
function descriptorKind<Value>(descriptor: Descriptor<Value>): number {
  return (
    (descriptor.accessor
      ? propertyAccessor
      : descriptor.writable
        ? propertyWritable
        : 0) |
    (descriptor.enumerable ? propertyEnumerable : 0) |
    (descriptor.configurable ? propertyConfigurable : 0)
  );
}
/** Shapes past this many keys find a key through a hashed index; smaller
 * ones scan their keys. */
const indexedShapeKeys = 8;
/** The position of `key` in the shape, or -1. */
function shapeKeyIndex<Key, Value>(
  shape: OrdinaryPropertyShape<Key, Value>,
  key: Key,
): number {
  const keys = shape.keys;
  if (keys.length <= indexedShapeKeys) return keys.indexOf(key);
  const candidate: unknown = key;
  if (typeof candidate === "string") {
    const existing = shape.index;
    const index =
      existing === undefined ? indexShapeKeys<Key, Value>(shape) : existing;
    const position = index.get(candidate);
    return position === undefined ? -1 : position;
  }
  return keys.indexOf(key);
}
function indexShapeKeys<Key, Value>(
  shape: OrdinaryPropertyShape<Key, Value>,
): Map<string, number> {
  const index = new Map<string, number>();
  for (let position = 0; position < shape.keys.length; position++) {
    const candidate: unknown = shape.keys[position];
    if (typeof candidate === "string") index.set(candidate, position);
  }
  shape.index = index;
  return index;
}
/** Records a structural change of the object's own properties. */
function noteStructureChange<Key, Value>(
  object: OrdinaryObject<Key, Value>,
): void {
  object.internalPropertyEpoch++;
  const rare = object.internalRareSlots;
  if (rare !== undefined) rare.internalIndexedProperties = undefined;
  if (object.internalUsedAsPrototype) propertyEpoch.value++;
}
/** In-place value slots per object (internalValue0..7). storedValue and
 * setFastValue are the only places that locate a key's value from its
 * shape position, the extension point for values held outside the
 * object's own slots. */
export const propertySlots = 8;
function storedValue<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  index: number,
): Value | undefined {
  switch (index) {
    case 0:
      return object.internalValue0;
    case 1:
      return object.internalValue1;
    case 2:
      return object.internalValue2;
    case 3:
      return object.internalValue3;
    case 4:
      return object.internalValue4;
    case 5:
      return object.internalValue5;
    case 6:
      return object.internalValue6;
    case 7:
      return object.internalValue7;
  }
  const values = object.internalValues;
  return values === undefined ? undefined : values[index - propertySlots];
}
/** The value of the shape's key at index of a fast-mode object. */
function fastValue<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  shape: OrdinaryPropertyShape<Key, Value>,
  index: number,
): Value {
  const value = storedValue<Key, Value>(object, index);
  return value === undefined ? shape.undefinedValue : value;
}
/** Store the value of the shape's key at index. Indices past the in-place
 * slots extend internalValues in order. */
function setFastValue<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  index: number,
  value: Value,
): void {
  switch (index) {
    case 0:
      object.internalValue0 = value;
      return;
    case 1:
      object.internalValue1 = value;
      return;
    case 2:
      object.internalValue2 = value;
      return;
    case 3:
      object.internalValue3 = value;
      return;
    case 4:
      object.internalValue4 = value;
      return;
    case 5:
      object.internalValue5 = value;
      return;
    case 6:
      object.internalValue6 = value;
      return;
    case 7:
      object.internalValue7 = value;
      return;
  }
  const spill = index - propertySlots;
  const values = object.internalValues;
  if (values === undefined) {
    if (spill !== 0) throw "PROPERTY_VALUE_INDEX_INVARIANT";
    object.internalValues = [value];
  } else if (spill === values.length) values.push(value);
  else if (spill < values.length) values[spill] = value;
  else throw "PROPERTY_VALUE_INDEX_INVARIANT";
}
/** A fast-mode property as a (fresh) data descriptor. */
function fastDescriptor<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  shape: OrdinaryPropertyShape<Key, Value>,
  index: number,
): Descriptor<Value> {
  const kind = shape.kinds[index] ?? 0;
  if ((kind & propertyAccessor) !== 0)
    return fastAccessor<Key, Value>(object, shape, index);
  return {
    accessor: false,
    value: fastValue<Key, Value>(object, shape, index),
    writable: (kind & propertyWritable) !== 0,
    get: shape.undefinedValue,
    set: shape.undefinedValue,
    enumerable: (kind & propertyEnumerable) !== 0,
    configurable: (kind & propertyConfigurable) !== 0,
  };
}
/** The stored descriptor of a fast-mode accessor. */
function fastAccessor<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  shape: OrdinaryPropertyShape<Key, Value>,
  index: number,
): Descriptor<Value> {
  const key = shape.keys[index];
  const properties = object.properties;
  const descriptor =
    key === undefined || properties === undefined
      ? undefined
      : properties.get(key);
  if (descriptor === undefined || !descriptor.accessor)
    throw "FAST_ACCESSOR_INVARIANT";
  return descriptor;
}
function addFastProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  shape: OrdinaryPropertyShape<Key, Value>,
  key: Key,
  kind: number,
  value: Value,
): void {
  setFastValue<Key, Value>(object, shape.keys.length, value);
  object.internalShape = transitionPropertyShape<Key, Value>(shape, key, kind);
  noteStructureChange<Key, Value>(object);
}
/** The object's keys grown again from its prototype's root, with key
 * `index` given `kind` (index -1 keeps every kind). Values keep their
 * slots. */
function replayPropertyShape<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  shape: OrdinaryPropertyShape<Key, Value>,
  index: number,
  kind: number,
): OrdinaryPropertyShape<Key, Value> {
  let next = rootPropertyShape<Key, Value>(object, shape.undefinedValue);
  for (let position = 0; position < shape.keys.length; position++) {
    const key = shape.keys[position];
    if (key === undefined) throw "PROPERTY_KEY_INVARIANT";
    const keyKind = position === index ? kind : (shape.kinds[position] ?? 0);
    next = transitionPropertyShape<Key, Value>(next, key, keyKind);
  }
  return next;
}
function reshapeFastProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  shape: OrdinaryPropertyShape<Key, Value>,
  index: number,
  kind: number,
): void {
  object.internalShape = replayPropertyShape<Key, Value>(
    object,
    shape,
    index,
    kind,
  );
  noteStructureChange<Key, Value>(object);
}
/** Note that object is a [[Prototype]]: from now on it grows private shapes,
 * which cached transitions never start at, and its structural changes bump
 * propertyEpoch. */
function markPrototype<Key, Value>(object: OrdinaryObject<Key, Value>): void {
  if (object.internalUsedAsPrototype) return;
  object.internalUsedAsPrototype = true;
  const shape = object.internalShape;
  if (!object.internalDictionary && shape !== undefined)
    object.internalShape = replayPropertyShape<Key, Value>(
      object,
      shape,
      -1,
      0,
    );
}
/** Move the object's own properties to descriptor storage, permanently. */
export function useDictionaryProperties<Key, Value>(
  object: OrdinaryObject<Key, Value>,
): void {
  if (object.internalDictionary) return;
  const shape = object.internalShape;
  const properties = ensureProperties<Key, Value>(object);
  if (shape !== undefined) {
    // Accessors are already stored; insert every key in shape order.
    const descriptors: Descriptor<Value>[] = [];
    for (let index = 0; index < shape.keys.length; index++)
      descriptors.push(fastDescriptor<Key, Value>(object, shape, index));
    properties.clear();
    for (let index = 0; index < shape.keys.length; index++) {
      const key = shape.keys[index],
        descriptor = descriptors[index];
      if (key === undefined || descriptor === undefined)
        throw "PROPERTY_KEY_INVARIANT";
      properties.set(key, descriptor);
    }
  }
  object.internalDictionary = true;
  object.internalShape = undefined;
  object.internalValues = undefined;
  object.internalValue0 = undefined;
  object.internalValue1 = undefined;
  object.internalValue2 = undefined;
  object.internalValue3 = undefined;
  object.internalValue4 = undefined;
  object.internalValue5 = undefined;
  object.internalValue6 = undefined;
  object.internalValue7 = undefined;
  noteStructureChange<Key, Value>(object);
}
/** Whether an ordinary object has an own property `key`, without exotic
 * dispatch and without building a descriptor. */
export function ordinaryHasOwnProperty<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  key: Key,
): boolean {
  if (!object.internalDictionary) {
    const shape = object.internalShape;
    return shape !== undefined && shapeKeyIndex<Key, Value>(shape, key) >= 0;
  }
  return ordinaryGetOwnProperty<Key, Value>(object, key) !== undefined;
}

const emptyPropertyShapeHash = 2166136261;
/** Shared shapes start at the prototype's root. Shapes of objects with a
 * null prototype, and of prototypes, stay private to the object. */
function rootPropertyShape<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  undefinedValue: Value,
): OrdinaryPropertyShape<Key, Value> {
  const prototype = object.internalUsedAsPrototype
    ? undefined
    : object.prototype;
  const shared =
    prototype === undefined ? undefined : prototype.internalChildShape;
  if (shared !== undefined) return shared;
  const root: OrdinaryPropertyShape<Key, Value> = {
    keys: [],
    kinds: [],
    hash: emptyPropertyShapeHash,
    shared: prototype !== undefined,
    firstSuccessor: undefined,
    nextSibling: undefined,
    successors: 0,
    undefinedValue,
    index: undefined,
  };
  if (prototype !== undefined) prototype.internalChildShape = root;
  return root;
}
/** Never the shape of an object: an empty cache entry holds it, so an object
 * without a shape cannot match one. */
export const unusedPropertyShape: ScriptShape = {
  keys: [],
  kinds: [],
  hash: emptyPropertyShapeHash,
  shared: false,
  firstSuccessor: undefined,
  nextSibling: undefined,
  successors: 0,
  undefinedValue: undefined,
  index: undefined,
};
/** Shapes past this many keys, or past this many successors of one shape,
 * stay private to their object so dictionary-like use cannot grow the
 * shared trees without bound. */
const maxSharedPropertyKeys = 64,
  maxPropertyTransitions = 32;
function transitionPropertyShape<Key, Value>(
  shape: OrdinaryPropertyShape<Key, Value>,
  key: Key,
  kind: number,
): OrdinaryPropertyShape<Key, Value> {
  let successor = shape.firstSuccessor;
  while (successor !== undefined) {
    const last = successor.keys.length - 1;
    if (successor.keys[last] === key && successor.kinds[last] === kind)
      return successor;
    successor = successor.nextSibling;
  }
  const keys = shape.keys.slice();
  keys.push(key);
  const kinds = shape.kinds.slice();
  kinds.push(kind);
  const linked = shape.shared && shape.successors < maxPropertyTransitions;
  const candidate: unknown = key;
  const keyHash = typeof candidate === "string" ? hashString(candidate) : 0;
  const next: OrdinaryPropertyShape<Key, Value> = {
    keys,
    kinds,
    hash: Math.imul(shape.hash ^ keyHash ^ kind, 16777619) >>> 0,
    shared: linked && keys.length < maxSharedPropertyKeys,
    firstSuccessor: undefined,
    nextSibling: linked ? shape.firstSuccessor : undefined,
    successors: 0,
    undefinedValue: shape.undefinedValue,
    index: undefined,
  };
  if (linked) {
    shape.firstSuccessor = next;
    shape.successors++;
  }
  return next;
}

function indexedPropertyBucket(index: number, mask: number): number {
  const folded = index ^ Math.floor(index / 4294967296);
  const mixed = Math.imul(folded ^ (folded >>> 16), 0x85ebca6b);
  return (mixed ^ (mixed >>> 13)) & mask;
}

function buildIndexedPropertyLayout<Key, Value>(
  object: OrdinaryObject<Key, Value>,
): IndexedPropertyLayout<Value> | null {
  let keys: number[] | undefined = undefined;
  let cells: Descriptor<Value>[] | undefined = undefined;
  const properties = object.properties;
  if (properties === undefined) return null;
  for (const [key, descriptor] of properties) {
    const candidate: unknown = key;
    if (typeof candidate !== "string") continue;
    const numeric = canonicalNumericIndex(candidate);
    if (
      numeric === undefined ||
      !Number.isSafeInteger(numeric) ||
      (numeric === 0 && 1 / numeric < 0)
    )
      continue;
    const indexedKeys: number[] = keys ?? [];
    const indexedCells: Descriptor<Value>[] = cells ?? [];
    indexedKeys.push(numeric);
    indexedCells.push(descriptor);
    keys = indexedKeys;
    cells = indexedCells;
  }
  const indexedKeys = keys,
    indexedCells = cells;
  if (indexedKeys === undefined || indexedCells === undefined) return null;
  const count = indexedKeys.length;
  let capacity = 4;
  while (capacity < count * 2) capacity *= 2;
  const table = new Float64Array(capacity);
  const descriptors: Descriptor<Value>[] = [];
  table.fill(NaN);
  // The view is rebuilt on shape changes. Half occupancy leaves an empty
  // bucket for every failed lookup, with no tombstones.
  const mask = capacity - 1;
  for (let index = 0; index < count; index++) {
    const key = indexedKeys[index],
      descriptor = indexedCells[index];
    if (key === undefined || descriptor === undefined)
      throw "INDEXED_PROPERTY_CELL_INVARIANT";
    let position = indexedPropertyBucket(key, mask);
    while (!Number.isNaN(table[position])) position = (position + 1) & mask;
    table[position] = key;
    descriptors[position] = descriptor;
  }
  return { keys: table, cells: descriptors };
}

/** Look up an integer already in Number representation. The numeric view
 * and the named layout share the original descriptor cells. */
export function indexedPropertyCell<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  index: number,
): Descriptor<Value> | undefined {
  if (object.properties === undefined) return undefined;
  const rare = object.internalRareSlots;
  let layout = rare === undefined ? undefined : rare.internalIndexedProperties;
  if (layout === undefined) {
    layout = buildIndexedPropertyLayout<Key, Value>(object);
    if (layout !== null || rare !== undefined)
      ensureRareSlots<Key, Value>(object).internalIndexedProperties = layout;
  }
  if (layout === undefined || layout === null) return undefined;
  const keys = layout.keys,
    cells = layout.cells;
  const mask = keys.length - 1;
  let position = indexedPropertyBucket(index, mask);
  for (;;) {
    const key = keys[position];
    if (key === undefined || key !== key) return undefined;
    if (key === index) return cells[position];
    position = (position + 1) & mask;
  }
}

/** A fast-mode object's shape, which the per-site caches key on. The cache
 * owns only shapes and slot numbers; the receiver and prototype objects own
 * their values, so the cache keeps no JavaScript object or symbol alive. */
function cacheableShape(object: ScriptObject): ScriptShape | undefined {
  if (object.internalDictionary) return undefined;
  const shape = object.internalShape;
  if (shape !== undefined) return shape;
  // An object without own properties takes its (empty) root shape so its
  // inherited properties cache too.
  const root = rootPropertyShape<ScriptPropertyKey, unknown>(object, undefined);
  object.internalShape = root;
  return root;
}
/** The holder an entry names for an object of the entry's receiver shape. */
function cachedScriptPropertyHolder(
  object: ScriptObject,
  entry: ScriptPropertyCacheEntry,
  own: boolean,
): ScriptObject | undefined {
  if (entry.receiver !== object.internalShape) return undefined;
  if (entry.holder === undefined) return object;
  if (own) return undefined;
  let prototype = object.prototype;
  const parent = entry.parent,
    ancestor = entry.ancestor;
  if (parent !== undefined) {
    const checked = prototype;
    if (checked === undefined || checked.internalShape !== parent)
      return undefined;
    prototype = checked.prototype;
  }
  if (ancestor !== undefined) {
    const checked = prototype;
    if (checked === undefined || checked.internalShape !== ancestor)
      return undefined;
    prototype = checked.prototype;
  }
  if (prototype === undefined || prototype.internalShape !== entry.holder)
    return undefined;
  return prototype;
}
/** A cached value's word index as generated code reads it: the binary64
 * whose bits are the integer (exact as a subnormal multiple of the least
 * positive value, with flush-to-zero off as native code runs). */
export function inlineSlotBits(word: number): number {
  return word * Number.MIN_VALUE;
}
/** The receiver shape of a site's inline own (or inherited) entry. */
export function inlineEntryShape(
  cache: ScriptPropertyCache,
  inherited: boolean,
  index: number,
): ScriptShape {
  switch (index) {
    case 0:
      return inherited ? cache.inheritedShape : cache.ownShape;
    case 1:
      return inherited ? cache.inheritedShape1 : cache.ownShape1;
    case 2:
      return inherited ? cache.inheritedShape2 : cache.ownShape2;
    case 3:
      return inherited ? cache.inheritedShape3 : cache.ownShape3;
  }
  throw "PROPERTY_CACHE_ENTRY_INVARIANT";
}
/** The raw-bit word index of a site's inline own (or inherited) entry. */
export function inlineEntrySlot(
  cache: ScriptPropertyCache,
  inherited: boolean,
  index: number,
): number {
  switch (index) {
    case 0:
      return inherited ? cache.inheritedSlot : cache.ownSlot;
    case 1:
      return inherited ? cache.inheritedSlot1 : cache.ownSlot1;
    case 2:
      return inherited ? cache.inheritedSlot2 : cache.ownSlot2;
    case 3:
      return inherited ? cache.inheritedSlot3 : cache.ownSlot3;
  }
  throw "PROPERTY_CACHE_ENTRY_INVARIANT";
}
/** The holder of a site's inline inherited entry. */
export function inlineEntryHolder(
  cache: ScriptPropertyCache,
  index: number,
): ScriptObject | undefined {
  switch (index) {
    case 0:
      return cache.inheritedObject;
    case 1:
      return cache.inheritedObject1;
    case 2:
      return cache.inheritedObject2;
    case 3:
      return cache.inheritedObject3;
  }
  throw "PROPERTY_CACHE_ENTRY_INVARIANT";
}
function setOwnEntry(
  cache: ScriptPropertyCache,
  index: number,
  shape: ScriptShape,
  slot: number,
): void {
  switch (index) {
    case 0:
      cache.ownShape = shape;
      cache.ownSlot = slot;
      return;
    case 1:
      cache.ownShape1 = shape;
      cache.ownSlot1 = slot;
      return;
    case 2:
      cache.ownShape2 = shape;
      cache.ownSlot2 = slot;
      return;
    case 3:
      cache.ownShape3 = shape;
      cache.ownSlot3 = slot;
      return;
  }
  throw "PROPERTY_CACHE_ENTRY_INVARIANT";
}
function setInheritedEntry(
  cache: ScriptPropertyCache,
  index: number,
  shape: ScriptShape,
  slot: number,
  holder: ScriptObject | undefined,
): void {
  switch (index) {
    case 0:
      cache.inheritedShape = shape;
      cache.inheritedSlot = slot;
      cache.inheritedObject = holder;
      return;
    case 1:
      cache.inheritedShape1 = shape;
      cache.inheritedSlot1 = slot;
      cache.inheritedObject1 = holder;
      return;
    case 2:
      cache.inheritedShape2 = shape;
      cache.inheritedSlot2 = slot;
      cache.inheritedObject2 = holder;
      return;
    case 3:
      cache.inheritedShape3 = shape;
      cache.inheritedSlot3 = slot;
      cache.inheritedObject3 = holder;
      return;
  }
  throw "PROPERTY_CACHE_ENTRY_INVARIANT";
}
/** The inline entry to (re)fill for a receiver shape: its own entry, else
 * the first empty one, else -1. Entries therefore fill in order, and the
 * last one is used only once all are. Full entries stay: a site with more
 * shapes is megamorphic, and rotating entries through a cycle of more
 * shapes than they hold would miss on every read. */
function inlineEntryIndex(
  cache: ScriptPropertyCache,
  inherited: boolean,
  shape: ScriptShape,
): number {
  let empty = -1;
  for (let index = 0; index < propertyCacheEntries; index++) {
    const current = inlineEntryShape(cache, inherited, index);
    if (current === shape) return index;
    if (empty < 0 && current === unusedPropertyShape) empty = index;
  }
  return empty;
}
/** Make a found property an inline entry: own when the object holds it,
 * except at a method site, else inherited (with no holder for the object's
 * own property, as an object literal's methods). Each value is a two-word
 * general slot; values past the in-place slots stay off the inline
 * entries. A megamorphic site misses here on every read of a shape past
 * its entries, so a full site returns before any other work (its last
 * entry, propertyCacheEntries - 1, is in use). */
function addInlineEntry(
  cache: ScriptPropertyCache,
  object: ScriptObject,
  shape: ScriptShape,
  holder: ScriptObject,
  offset: number,
  slotWord: number,
): void {
  if (offset >= propertySlots) return;
  if (holder === object && !cache.method) {
    if (cache.ownShape3 !== unusedPropertyShape) return;
    const index = inlineEntryIndex(cache, false, shape);
    if (index >= 0)
      setOwnEntry(cache, index, shape, inlineSlotBits(slotWord + offset * 2));
    return;
  }
  // Inherited entries share one epoch: entries found under an older one
  // are stale, so they are cleared before a newer entry is added.
  const epoch = propertyEpoch.value;
  if (cache.inheritedEpoch !== epoch) {
    for (let index = 0; index < propertyCacheEntries; index++)
      setInheritedEntry(cache, index, unusedPropertyShape, 0, undefined);
    cache.inheritedEpoch = epoch;
  } else if (cache.inheritedShape3 !== unusedPropertyShape) return;
  const index = inlineEntryIndex(cache, true, shape);
  if (index >= 0)
    setInheritedEntry(
      cache,
      index,
      shape,
      inlineSlotBits(slotWord + offset * 2),
      holder === object ? undefined : holder,
    );
}
/** Find `key` on a fast-mode object or its first prototypes and cache where
 * it was found. Returns the holder of the data property, with its shape
 * index in cache.foundIndex, or undefined to take the ordinary lookup.
 * `slotWord` is the word index of internalValue0 in the object record. */
export function lookupCachedScriptProperty(
  object: ScriptObject,
  key: string,
  cache: ScriptPropertyCache,
  own: boolean,
  global: ScriptPropertyStubCache,
  slotWord: number,
): ScriptObject | undefined {
  const shape = cacheableShape(object);
  if (shape === undefined) return undefined;
  // Generated code missed every inline entry: an entry found below goes
  // back inline.
  for (let index = 0; index < cache.used; index++) {
    const entry = cache.entries[index];
    if (entry === undefined) throw "PROPERTY_CACHE_ENTRY_INVARIANT";
    const holder = cachedScriptPropertyHolder(object, entry, own);
    if (holder !== undefined) {
      cache.foundIndex = entry.offset;
      addInlineEntry(cache, object, shape, holder, entry.offset, slotWord);
      return holder;
    }
  }
  const index = ((shape.hash ^ cache.nameHash) >>> 0) & 255;
  const stub = global.buckets[index];
  if (stub === undefined) throw "PROPERTY_STUB_ENTRY_INVARIANT";
  if (cache.megamorphic && stub.name === key) {
    const holder = cachedScriptPropertyHolder(object, stub, own);
    if (holder !== undefined) {
      cache.foundIndex = stub.offset;
      addInlineEntry(cache, object, shape, holder, stub.offset, slotWord);
      return holder;
    }
  }
  let holder = object,
    holderShape = shape;
  let offset = shapeKeyIndex<ScriptPropertyKey, unknown>(shape, key);
  let parent: ScriptShape | undefined = undefined;
  let ancestor: ScriptShape | undefined = undefined;
  if (offset < 0 && !own) {
    let prototype = object.prototype;
    // Keep the intermediate guards in the cache entry itself. Longer
    // prototype chains retain the ordinary lookup.
    for (let depth = 0; depth < 3 && offset < 0; depth++) {
      const current = prototype;
      if (current === undefined || current.internalMethods !== undefined)
        return undefined;
      const inherited = cacheableShape(current);
      if (inherited === undefined) return undefined;
      holder = current;
      holderShape = inherited;
      offset = shapeKeyIndex<ScriptPropertyKey, unknown>(inherited, key);
      if (offset >= 0) break;
      if (depth === 0) parent = inherited;
      else if (depth === 1) ancestor = inherited;
      prototype = current.prototype;
    }
  }
  // Accessors (and other kinds without a plain in-place value) keep the
  // ordinary lookup.
  if (
    offset < 0 ||
    ((holderShape.kinds[offset] ?? 0) & propertyNotInlineData) !== 0
  )
    return undefined;
  let entry = cache.entries[cache.used];
  if (entry === undefined) {
    cache.megamorphic = true;
    stub.name = key;
    entry = stub;
  } else cache.used++;
  entry.receiver = shape;
  entry.parent = parent;
  entry.ancestor = ancestor;
  entry.holder = holder === object ? undefined : holderShape;
  entry.offset = offset;
  addInlineEntry(cache, object, shape, holder, offset, slotWord);
  cache.foundIndex = offset;
  return holder;
}
/** The value of the property a cached lookup found on holder. */
export function cachedScriptPropertyValue(
  holder: ScriptObject,
  cache: ScriptPropertyCache,
): unknown {
  return storedValue<ScriptPropertyKey, unknown>(holder, cache.foundIndex);
}
/** Whether [[Set]] of `key` on the object, which lacks it, adds a writable
 * data property to the object itself: every object on the prototype chain
 * is ordinary, and the first one holding `key`, if any, holds it as a
 * writable data property (OrdinarySet then defines the receiver's own). */
function chainAddsOwnProperty(object: ScriptObject, key: string): boolean {
  let cursor = object.prototype;
  while (cursor !== undefined) {
    if (cursor.internalMethods !== undefined) return false;
    if (!cursor.internalDictionary) {
      const shape = cursor.internalShape;
      const index =
        shape === undefined
          ? -1
          : shapeKeyIndex<ScriptPropertyKey, unknown>(shape, key);
      if (shape !== undefined && index >= 0)
        return inlineWritableData(shape.kinds[index] ?? 0);
    } else {
      const descriptor = ordinaryGetOwnProperty<ScriptPropertyKey, unknown>(
        cursor,
        key,
      );
      if (descriptor !== undefined)
        return !descriptor.accessor && descriptor.writable;
    }
    cursor = cursor.prototype;
  }
  return true;
}
/** Store a property of a fast-mode object the way generated code repeats
 * it: to an existing writable own data property, or by adding a writable
 * data property when the prototype chain lets [[Set]] add one. Caches the store at the site
 * and returns true; false leaves the store to the ordinary path. */
export function storeCachedScriptProperty(
  object: ScriptObject,
  key: string,
  value: unknown,
  cache: ScriptPropertyCache,
  slotWord: number,
): boolean {
  if (object.internalDictionary) return false;
  const shape = object.internalShape;
  const index =
    shape === undefined
      ? -1
      : shapeKeyIndex<ScriptPropertyKey, unknown>(shape, key);
  if (shape !== undefined && index >= 0) {
    if (!inlineWritableData(shape.kinds[index] ?? 0)) return false;
    setFastValue<ScriptPropertyKey, unknown>(object, index, value);
    if (index < propertySlots) {
      cache.storeShape = shape;
      cache.storeSlot = inlineSlotBits(slotWord + index * 2);
      cache.storeTransition = undefined;
    }
    return true;
  }
  if (!object.extensible || !fastKey<string>(key)) return false;
  const epoch = propertyEpoch.value;
  if (!chainAddsOwnProperty(object, key)) return false;
  const base =
    shape === undefined
      ? rootPropertyShape<ScriptPropertyKey, unknown>(object, undefined)
      : shape;
  const added = base.keys.length;
  if (added >= maxFastKeys) return false;
  addFastProperty<ScriptPropertyKey, unknown>(
    object,
    base,
    key,
    propertyWritable | propertyEnumerable | propertyConfigurable,
    value,
  );
  const next = object.internalShape;
  if (
    added < propertySlots &&
    next !== undefined &&
    !object.internalUsedAsPrototype
  ) {
    cache.storeShape = base;
    cache.storeSlot = inlineSlotBits(slotWord + added * 2);
    cache.storeTransition = next;
    cache.storeEpoch = epoch;
  }
  return true;
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
    if (!cursor.internalDictionary) {
      const shape = cursor.internalShape;
      const index =
        shape === undefined ? -1 : shapeKeyIndex<Key, Value>(shape, key);
      if (shape !== undefined && index >= 0)
        return fastDescriptor<Key, Value>(cursor, shape, index);
      cursor = cursor.prototype;
      continue;
    }
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
    if (!cursor.internalDictionary) {
      const shape = cursor.internalShape;
      const index =
        shape === undefined ? -1 : shapeKeyIndex<Key, Value>(shape, key);
      if (shape !== undefined && index >= 0) {
        if (((shape.kinds[index] ?? 0) & propertyAccessor) === 0)
          return fastValue<Key, Value>(cursor, shape, index);
        const getter = fastAccessor<Key, Value>(cursor, shape, index).get;
        return hooks.sameValue(getter, hooks.undefinedValue)
          ? hooks.undefinedValue
          : hooks.call(getter, receiver, []);
      }
      cursor = cursor.prototype;
      continue;
    }
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
    if (!cursor.internalDictionary) {
      const shape = cursor.internalShape;
      const index =
        shape === undefined ? -1 : shapeKeyIndex<Key, Value>(shape, key);
      if (shape === undefined || index < 0) {
        cursor = cursor.prototype;
        continue;
      }
      const kind = shape.kinds[index] ?? 0;
      if ((kind & propertyAccessor) !== 0) {
        const setter = fastAccessor<Key, Value>(cursor, shape, index).set;
        if (hooks.sameValue(setter, hooks.undefinedValue)) return false;
        hooks.call(setter, receiver.value, [value]);
        return true;
      }
      if ((kind & propertyWritable) === 0) return false;
      // OrdinarySetWithOwnDescriptor on the receiver redefines only [[Value]].
      if (cursor !== object || receiver.object !== object) break;
      setFastValue<Key, Value>(object, index, value);
      return true;
    }
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
      const rare = object.internalRareSlots;
      const aliases = rare === undefined ? undefined : rare.internalDataAliases;
      if (
        cursor === object &&
        receiver.object === object &&
        object.internalMethods === undefined &&
        (rare === undefined || rare.internalPropertyContract === undefined) &&
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
  const shape = object.internalShape;
  if (!object.internalDictionary) {
    // Fast mode: `properties` holds only the accessors' descriptors.
    if (shape !== undefined)
      for (const key of shape.keys) {
        if (key === undefined) throw "PROPERTY_KEY_INVARIANT";
        keys.push(key);
      }
  } else {
    const properties = object.properties;
    if (properties !== undefined)
      for (const [key, descriptor] of properties) keys.push(key);
  }
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

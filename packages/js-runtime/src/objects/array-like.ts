import { viewObjectValue } from "./values.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  getProperty,
  objectFlagsPackedArray,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createArrayWithElements } from "./arrays.ts";
import {
  allocGeneralRefs,
  createArrayElementsFromList,
  firstCapacity,
  noGeneralRefs,
  noGeneralTags,
  noNumbers,
  writeGeneralSlot,
} from "./array-elements.ts";
import { numberValue } from "./coercion.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";

/** Direct fixed-arity dense array literal constructors (0..4 elements) that
 * read the realm's pre-initialized array shape and exotic methods directly,
 * avoiding temporary argument lists, loops, and nested helper dispatch. */
export function createArray0(
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  return {
    internalShape: realm.arrayChildShape,
    prototype: realm.arrayPrototype,
    internalFlags: objectFlagsPackedArray,
    internalPropertyEpoch: 0,
    internalValues: undefined,
    internalRegisterCall: undefined,
    internalArrayElements: {
      keys: realm.arrayHooks,
      undefinedValue: undefined,
      numberCount: 0,
      numbers: noNumbers,
      generalCount: 0,
      generalTags: noGeneralTags,
      generalRefs: noGeneralRefs,
      length: 0,
      lengthWritable: true,
    },
    internalMethods: realm.arrayMethods,
    internalRareSlots: undefined,
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

function createGeneralArray1(
  v0: unknown,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const generalTags = new Uint8Array(firstCapacity);
  const generalRefs = allocGeneralRefs(firstCapacity);
  let numbers = noNumbers;
  if (!writeGeneralSlot(generalTags, generalRefs, numbers, 0, v0)) {
    numbers = new Float64Array(firstCapacity);
    writeGeneralSlot(generalTags, generalRefs, numbers, 0, v0);
  }
  return {
    internalShape: realm.arrayChildShape,
    prototype: realm.arrayPrototype,
    internalFlags: objectFlagsPackedArray,
    internalPropertyEpoch: 0,
    internalValues: undefined,
    internalRegisterCall: undefined,
    internalArrayElements: {
      keys: realm.arrayHooks,
      undefinedValue: undefined,
      numberCount: 0,
      numbers,
      generalCount: 1,
      generalTags,
      generalRefs,
      length: 1,
      lengthWritable: true,
    },
    internalMethods: realm.arrayMethods,
    internalRareSlots: undefined,
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

function createGeneralArray2(
  v0: unknown,
  v1: unknown,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const generalTags = new Uint8Array(firstCapacity);
  const generalRefs = allocGeneralRefs(firstCapacity);
  let numbers = noNumbers;
  if (!writeGeneralSlot(generalTags, generalRefs, numbers, 0, v0)) {
    numbers = new Float64Array(firstCapacity);
    writeGeneralSlot(generalTags, generalRefs, numbers, 0, v0);
  }
  if (!writeGeneralSlot(generalTags, generalRefs, numbers, 1, v1)) {
    numbers = new Float64Array(firstCapacity);
    writeGeneralSlot(generalTags, generalRefs, numbers, 1, v1);
  }
  return {
    internalShape: realm.arrayChildShape,
    prototype: realm.arrayPrototype,
    internalFlags: objectFlagsPackedArray,
    internalPropertyEpoch: 0,
    internalValues: undefined,
    internalRegisterCall: undefined,
    internalArrayElements: {
      keys: realm.arrayHooks,
      undefinedValue: undefined,
      numberCount: 0,
      numbers,
      generalCount: 2,
      generalTags,
      generalRefs,
      length: 2,
      lengthWritable: true,
    },
    internalMethods: realm.arrayMethods,
    internalRareSlots: undefined,
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

function createGeneralArray3(
  v0: unknown,
  v1: unknown,
  v2: unknown,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const generalTags = new Uint8Array(firstCapacity);
  const generalRefs = allocGeneralRefs(firstCapacity);
  let numbers = noNumbers;
  if (!writeGeneralSlot(generalTags, generalRefs, numbers, 0, v0)) {
    numbers = new Float64Array(firstCapacity);
    writeGeneralSlot(generalTags, generalRefs, numbers, 0, v0);
  }
  if (!writeGeneralSlot(generalTags, generalRefs, numbers, 1, v1)) {
    numbers = new Float64Array(firstCapacity);
    writeGeneralSlot(generalTags, generalRefs, numbers, 1, v1);
  }
  if (!writeGeneralSlot(generalTags, generalRefs, numbers, 2, v2)) {
    numbers = new Float64Array(firstCapacity);
    writeGeneralSlot(generalTags, generalRefs, numbers, 2, v2);
  }
  return {
    internalShape: realm.arrayChildShape,
    prototype: realm.arrayPrototype,
    internalFlags: objectFlagsPackedArray,
    internalPropertyEpoch: 0,
    internalValues: undefined,
    internalRegisterCall: undefined,
    internalArrayElements: {
      keys: realm.arrayHooks,
      undefinedValue: undefined,
      numberCount: 0,
      numbers,
      generalCount: 3,
      generalTags,
      generalRefs,
      length: 3,
      lengthWritable: true,
    },
    internalMethods: realm.arrayMethods,
    internalRareSlots: undefined,
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

function createGeneralArray4(
  v0: unknown,
  v1: unknown,
  v2: unknown,
  v3: unknown,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const generalTags = new Uint8Array(firstCapacity);
  const generalRefs = allocGeneralRefs(firstCapacity);
  let numbers = noNumbers;
  if (!writeGeneralSlot(generalTags, generalRefs, numbers, 0, v0)) {
    numbers = new Float64Array(firstCapacity);
    writeGeneralSlot(generalTags, generalRefs, numbers, 0, v0);
  }
  if (!writeGeneralSlot(generalTags, generalRefs, numbers, 1, v1)) {
    numbers = new Float64Array(firstCapacity);
    writeGeneralSlot(generalTags, generalRefs, numbers, 1, v1);
  }
  if (!writeGeneralSlot(generalTags, generalRefs, numbers, 2, v2)) {
    numbers = new Float64Array(firstCapacity);
    writeGeneralSlot(generalTags, generalRefs, numbers, 2, v2);
  }
  if (!writeGeneralSlot(generalTags, generalRefs, numbers, 3, v3)) {
    numbers = new Float64Array(firstCapacity);
    writeGeneralSlot(generalTags, generalRefs, numbers, 3, v3);
  }
  return {
    internalShape: realm.arrayChildShape,
    prototype: realm.arrayPrototype,
    internalFlags: objectFlagsPackedArray,
    internalPropertyEpoch: 0,
    internalValues: undefined,
    internalRegisterCall: undefined,
    internalArrayElements: {
      keys: realm.arrayHooks,
      undefinedValue: undefined,
      numberCount: 0,
      numbers,
      generalCount: 4,
      generalTags,
      generalRefs,
      length: 4,
      lengthWritable: true,
    },
    internalMethods: realm.arrayMethods,
    internalRareSlots: undefined,
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

export function createArray1(
  v0: unknown,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  if (typeof v0 === "number") {
    const numbers = new Float64Array(firstCapacity);
    numbers[0] = v0;
    return {
      internalShape: realm.arrayChildShape,
      prototype: realm.arrayPrototype,
      internalFlags: objectFlagsPackedArray,
      internalPropertyEpoch: 0,
      internalValues: undefined,
      internalRegisterCall: undefined,
      internalArrayElements: {
        keys: realm.arrayHooks,
        undefinedValue: undefined,
        numberCount: 1,
        numbers,
        generalCount: 0,
        generalTags: noGeneralTags,
        generalRefs: noGeneralRefs,
        length: 1,
        lengthWritable: true,
      },
      internalMethods: realm.arrayMethods,
      internalRareSlots: undefined,
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
  return createGeneralArray1(v0, realm);
}

export function createArray2(
  v0: unknown,
  v1: unknown,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  if (typeof v0 === "number" && typeof v1 === "number") {
    const numbers = new Float64Array(firstCapacity);
    numbers[0] = v0;
    numbers[1] = v1;
    return {
      internalShape: realm.arrayChildShape,
      prototype: realm.arrayPrototype,
      internalFlags: objectFlagsPackedArray,
      internalPropertyEpoch: 0,
      internalValues: undefined,
      internalRegisterCall: undefined,
      internalArrayElements: {
        keys: realm.arrayHooks,
        undefinedValue: undefined,
        numberCount: 2,
        numbers,
        generalCount: 0,
        generalTags: noGeneralTags,
        generalRefs: noGeneralRefs,
        length: 2,
        lengthWritable: true,
      },
      internalMethods: realm.arrayMethods,
      internalRareSlots: undefined,
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
  return createGeneralArray2(v0, v1, realm);
}

export function createArray3(
  v0: unknown,
  v1: unknown,
  v2: unknown,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  if (
    typeof v0 === "number" &&
    typeof v1 === "number" &&
    typeof v2 === "number"
  ) {
    const numbers = new Float64Array(firstCapacity);
    numbers[0] = v0;
    numbers[1] = v1;
    numbers[2] = v2;
    return {
      internalShape: realm.arrayChildShape,
      prototype: realm.arrayPrototype,
      internalFlags: objectFlagsPackedArray,
      internalPropertyEpoch: 0,
      internalValues: undefined,
      internalRegisterCall: undefined,
      internalArrayElements: {
        keys: realm.arrayHooks,
        undefinedValue: undefined,
        numberCount: 3,
        numbers,
        generalCount: 0,
        generalTags: noGeneralTags,
        generalRefs: noGeneralRefs,
        length: 3,
        lengthWritable: true,
      },
      internalMethods: realm.arrayMethods,
      internalRareSlots: undefined,
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
  return createGeneralArray3(v0, v1, v2, realm);
}

export function createArray4(
  v0: unknown,
  v1: unknown,
  v2: unknown,
  v3: unknown,
  realm: ErrorRealm,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  if (
    typeof v0 === "number" &&
    typeof v1 === "number" &&
    typeof v2 === "number" &&
    typeof v3 === "number"
  ) {
    const numbers = new Float64Array(firstCapacity);
    numbers[0] = v0;
    numbers[1] = v1;
    numbers[2] = v2;
    numbers[3] = v3;
    return {
      internalShape: realm.arrayChildShape,
      prototype: realm.arrayPrototype,
      internalFlags: objectFlagsPackedArray,
      internalPropertyEpoch: 0,
      internalValues: undefined,
      internalRegisterCall: undefined,
      internalArrayElements: {
        keys: realm.arrayHooks,
        undefinedValue: undefined,
        numberCount: 4,
        numbers,
        generalCount: 0,
        generalTags: noGeneralTags,
        generalRefs: noGeneralRefs,
        length: 4,
        lengthWritable: true,
      },
      internalMethods: realm.arrayMethods,
      internalRareSlots: undefined,
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
  return createGeneralArray4(v0, v1, v2, v3, realm);
}

export function lengthOfArrayLike(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): number {
  const converted = numberValue(
    getProperty<ScriptPropertyKey, unknown>(object, "length", object, hooks),
    hooks,
    realm,
  );
  if (converted.error === "unsupported")
    return rejectUnsupportedExecution(realm);
  if (converted.error !== "none") throw createRuntimeError(realm, "type");
  const number = converted.value;
  return number > 0 ? Math.min(Math.floor(number), 9007199254740991) : 0;
}

/** Create a dense array from an internal argument list without observable
 * iteration or the Array constructor's single-number length interpretation. */
export function createArrayFromList(
  args: readonly unknown[],
  start: number,
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const length = Math.max(0, args.length - start);
  const elements = createArrayElementsFromList(
    realm.arrayHooks,
    hooks.undefinedValue,
    args,
    start,
    length,
  );
  return createArrayWithElements<ScriptPropertyKey, unknown>(
    prototype,
    realm.arrayHooks,
    elements,
  );
}

/** Copy a typed internal string list into an independently mutable Script Array. */
export function createStringArrayFromList(
  values: readonly string[],
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const result: unknown[] = [];
  for (const value of values) {
    if (value === undefined) throw "STRING_ARRAY_LIST_INVARIANT";
    result.push(value);
  }
  return createArrayFromList(result, 0, realm.arrayPrototype, realm, hooks);
}

/** CreateListFromArrayLike reads every indexed value, including absent entries. */
export function arrayLikeValues(
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown[] {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) throw createRuntimeError(realm, "type");
  const length = lengthOfArrayLike(object, realm, hooks),
    result: unknown[] = [];
  for (let index = 0; index < length; index++)
    result.push(
      getProperty<ScriptPropertyKey, unknown>(
        object,
        String(index),
        value,
        hooks,
      ),
    );
  return result;
}

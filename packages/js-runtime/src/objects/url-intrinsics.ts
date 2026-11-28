import {
  encodeUTF8,
  createUTF8Decoder,
  decodeUTF8,
} from "@tint/foundation/text/text-encoding";
import { createArrayFromList } from "./array-like.ts";
import { isCallableObject } from "./call.ts";
import {
  createCodedRuntimeError,
  createRuntimeError,
  type ErrorRealm,
} from "./errors.ts";
import { callObjectValueOrThrow, stringValueOrThrow } from "./fused-results.ts";
import {
  builtinAccessor,
  builtinFunction,
  builtinFunctionMetadata,
  builtinProperty,
} from "./intrinsics.ts";
import {
  closeScriptIterator,
  getScriptIterator,
  stepScriptIterator,
} from "./iteration.ts";
import {
  createConstructorObject,
  createDataProperty,
  createObject,
  ensureExoticSlots,
  exoticSlots,
  getOwnProperty,
  getProperty,
  ownKeys,
  type ObjectCall,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import {
  scriptPropertyKeyOrder,
  wellKnownSymbol,
  type ScriptPropertyKey,
} from "./symbols.ts";
import { viewObjectValue } from "./values.ts";
import {
  normalizePath,
  origin,
  parseURL,
  readParameters,
  serializeParameters,
  serializeURL,
  setHash,
  setPort,
  setProtocol,
  setSearch,
  specialPort,
  stripURLTabs,
  updateHost,
  urlEncode,
  userInfoEncodeSet,
  type URLData,
  type URLParameter,
} from "./url-data.ts";

type RealmObject = OrdinaryObject<ScriptPropertyKey, unknown>;
export interface URLState {
  data: URLData;
  parameters: RealmObject | undefined;
}
export interface ParametersState {
  pairs: URLParameter[];
  readonly url: URLState | undefined;
}

export interface ParametersIteratorState {
  readonly parameters: ParametersState;
  readonly mode: string;
  index: number;
}

export function installURLIntrinsics(
  global: RealmObject,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const urlPrototype = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const paramsPrototype = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const iteratorPrototype = createObject<ScriptPropertyKey, unknown>(
    realm.iteratorPrototype,
  );
  const iteratorKey = wellKnownSymbol(realm.symbolRegistry, "iterator");
  const tagKey = wellKnownSymbol(realm.symbolRegistry, "toStringTag");
  builtinProperty(
    iteratorPrototype,
    tagKey,
    "URLSearchParams Iterator",
    false,
    true,
    hooks,
  );

  function typeError(): never {
    throw createRuntimeError(realm, "type");
  }
  function objectOf(value: unknown): RealmObject {
    const object = viewObjectValue(value, global);
    if (object === undefined) return typeError();
    return object;
  }
  function property(object: RealmObject, key: ScriptPropertyKey): unknown {
    return getProperty<ScriptPropertyKey, unknown>(object, key, object, hooks);
  }
  function string(value: unknown): string {
    const text = stringValueOrThrow(value, hooks, realm);
    return decodeUTF8(createUTF8Decoder(false, true), encodeUTF8(text)) ?? "";
  }
  function requireCount(
    args: readonly unknown[],
    count: number,
    name: string,
  ): void {
    if (args.length >= count) return;
    const message =
      count === 2
        ? 'The "name" and "value" arguments must be specified'
        : 'The "' + name + '" argument must be specified';
    throw createCodedRuntimeError(
      realm,
      hooks,
      "type",
      message,
      "ERR_MISSING_ARGS",
      undefined,
      false,
    );
  }
  function method(
    object: RealmObject,
    key: ScriptPropertyKey,
    name: string,
    length: number,
    call: ObjectCall<unknown>,
  ): RealmObject {
    const fn = builtinFunction(
      realm.functionPrototype,
      name,
      length,
      call,
      hooks,
    );
    builtinProperty(object, key, fn, true, true, hooks);
    return fn;
  }
  function accessor(
    object: RealmObject,
    name: string,
    get: ObjectCall<unknown>,
    set?: ObjectCall<unknown>,
  ): void {
    builtinAccessor(
      object,
      name,
      builtinFunction(realm.functionPrototype, "get " + name, 0, get, hooks),
      set === undefined
        ? undefined
        : builtinFunction(
            realm.functionPrototype,
            "set " + name,
            1,
            set,
            hooks,
          ),
      hooks,
    );
  }
  function makeConstructor(
    name: string,
    length: number,
    prototype: RealmObject,
    init: (object: RealmObject, args: readonly unknown[]) => void,
  ): RealmObject {
    const ctor = createConstructorObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (_receiver, _args): unknown => typeError(),
      (args, newTarget): unknown => {
        const parent = viewObjectValue(
          property(objectOf(newTarget), "prototype"),
          global,
        );
        const object = createObject<ScriptPropertyKey, unknown>(
          parent ?? prototype,
        );
        init(object, args);
        return object;
      },
    );
    builtinFunctionMetadata(ctor, name, length, hooks);
    builtinProperty(ctor, "prototype", prototype, false, false, hooks);
    builtinProperty(prototype, "constructor", ctor, true, true, hooks);
    builtinProperty(prototype, tagKey, name, false, true, hooks);
    builtinProperty(global, name, ctor, true, true, hooks);
    return ctor;
  }
  function invalidURL(input: string, base: string | undefined): never {
    const error = createCodedRuntimeError(
      realm,
      hooks,
      "type",
      "Invalid URL",
      "ERR_INVALID_URL",
      undefined,
      false,
    );
    createDataProperty<ScriptPropertyKey, unknown>(
      error,
      "input",
      input,
      hooks,
    );
    if (base !== undefined)
      createDataProperty<ScriptPropertyKey, unknown>(
        error,
        "base",
        base,
        hooks,
      );
    throw error;
  }
  function parsed(
    input: string,
    base: string | undefined,
  ): URLData | undefined {
    const parent = base === undefined ? undefined : parseURL(base, undefined);
    if (base !== undefined && parent === undefined) return undefined;
    return parseURL(input, parent);
  }
  function urlState(value: unknown): URLState {
    const state = exoticSlots(objectOf(value)).internalURL;
    if (state === undefined) return typeError();
    return state;
  }
  function paramsState(value: unknown): ParametersState {
    const state = exoticSlots(objectOf(value)).internalURLParameters;
    if (state === undefined) return typeError();
    return state;
  }
  function initURL(object: RealmObject, data: URLData): void {
    ensureExoticSlots(object).internalURL = { data, parameters: undefined };
  }
  function refresh(state: URLState): void {
    const parameters = state.parameters;
    if (parameters !== undefined)
      paramsState(parameters).pairs = readParameters(state.data.query);
  }
  function sync(state: ParametersState): void {
    const url = state.url;
    if (url === undefined) return;
    const serialized = serializeParameters(state.pairs);
    url.data.query = serialized === "" ? undefined : serialized;
  }
  function initParameters(value: unknown): URLParameter[] {
    if (value === undefined) return [];
    const object = viewObjectValue(value, global);
    if (object === undefined) {
      const input = string(value);
      return readParameters(input.startsWith("?") ? input.slice(1) : input);
    }
    const result: URLParameter[] = [];
    const iterate = property(object, iteratorKey);
    if (iterate === undefined || iterate === null) {
      for (const key of ownKeys<ScriptPropertyKey, unknown>(
        object,
        (key): number => scriptPropertyKeyOrder(key),
      )) {
        if (typeof key !== "string") continue;
        const descriptor = getOwnProperty<ScriptPropertyKey, unknown>(
          object,
          key,
        );
        if (descriptor !== undefined && descriptor.enumerable)
          result.push({
            name: string(key),
            value: string(property(object, key)),
          });
      }
    } else {
      const outer = getScriptIterator(object, realm, hooks);
      try {
        while (true) {
          const entry = stepScriptIterator(outer);
          if (entry.done) break;
          const inner = getScriptIterator(objectOf(entry.value), realm, hooks);
          const key = stepScriptIterator(inner);
          const value = stepScriptIterator(inner);
          if (key.done || value.done || !stepScriptIterator(inner).done) {
            closeScriptIterator(inner, true);
            return typeError();
          }
          result.push({ name: string(key.value), value: string(value.value) });
        }
      } catch (error) {
        closeScriptIterator(outer, true);
        throw error;
      }
    }
    return result;
  }
  makeConstructor(
    "URLSearchParams",
    0,
    paramsPrototype,
    (object, args): void => {
      ensureExoticSlots(object).internalURLParameters = {
        pairs: initParameters(args[0]),
        url: undefined,
      };
    },
  );
  const urlConstructor = makeConstructor(
    "URL",
    1,
    urlPrototype,
    (object, args): void => {
      requireCount(args, 1, "url");
      const input = string(args[0]),
        base = args[1] === undefined ? undefined : string(args[1]);
      const data = parsed(input, base);
      if (data === undefined) return invalidURL(input, base);
      initURL(object, data);
    },
  );
  method(urlConstructor, "canParse", "canParse", 1, (_r, args): unknown => {
    requireCount(args, 1, "url");
    return (
      parsed(
        string(args[0]),
        args[1] === undefined ? undefined : string(args[1]),
      ) !== undefined
    );
  });
  method(urlConstructor, "parse", "parse", 1, (_r, args): unknown => {
    requireCount(args, 1, "url");
    const data = parsed(
      string(args[0]),
      args[1] === undefined ? undefined : string(args[1]),
    );
    if (data === undefined) return null;
    const object = createObject<ScriptPropertyKey, unknown>(urlPrototype);
    initURL(object, data);
    return object;
  });

  function credentials(data: URLData): boolean {
    return (
      data.hostname !== undefined &&
      data.hostname !== "" &&
      data.scheme !== "file"
    );
  }
  function hostInput(value: string, special: boolean): string {
    const input = stripURLTabs(value);
    for (let i = 0; i < input.length; i++) {
      const c = input.charAt(i);
      if (c === "/" || c === "?" || c === "#" || (special && c === "\\"))
        return input.slice(0, i);
    }
    return input;
  }
  accessor(
    urlPrototype,
    "href",
    (r, _a): unknown => serializeURL(urlState(r).data),
    (r, a): unknown => {
      const state = urlState(r);
      const input = string(a[0]);
      const data = parseURL(input, undefined);
      if (data === undefined) return invalidURL(input, undefined);
      state.data = data;
      refresh(state);
      return undefined;
    },
  );
  accessor(urlPrototype, "origin", (r, _a): unknown =>
    origin(urlState(r).data),
  );
  accessor(
    urlPrototype,
    "protocol",
    (r, _a): unknown => urlState(r).data.scheme + ":",
    (r, a): unknown => {
      setProtocol(urlState(r).data, string(a[0]));
      return undefined;
    },
  );
  accessor(
    urlPrototype,
    "username",
    (r, _a): unknown => urlState(r).data.username,
    (r, a): unknown => {
      const data = urlState(r).data,
        value = string(a[0]);
      if (credentials(data))
        data.username = urlEncode(value, userInfoEncodeSet);
      return undefined;
    },
  );
  accessor(
    urlPrototype,
    "password",
    (r, _a): unknown => urlState(r).data.password,
    (r, a): unknown => {
      const data = urlState(r).data,
        value = string(a[0]);
      if (credentials(data))
        data.password = urlEncode(value, userInfoEncodeSet);
      return undefined;
    },
  );
  accessor(
    urlPrototype,
    "hostname",
    (r, _a): unknown => urlState(r).data.hostname ?? "",
    (r, a): unknown => {
      const data = urlState(r).data,
        value = string(a[0]);
      if (!data.opaque)
        updateHost(
          data,
          hostInput(value, specialPort(data.scheme) !== undefined),
          true,
        );
      return undefined;
    },
  );
  accessor(
    urlPrototype,
    "host",
    (r, _a): unknown => {
      const data = urlState(r).data;
      return (data.hostname ?? "") + (data.port === "" ? "" : ":" + data.port);
    },
    (r, a): unknown => {
      const data = urlState(r).data,
        value = string(a[0]);
      if (!data.opaque)
        updateHost(
          data,
          hostInput(value, specialPort(data.scheme) !== undefined),
          false,
          true,
        );
      return undefined;
    },
  );
  accessor(
    urlPrototype,
    "port",
    (r, _a): unknown => urlState(r).data.port,
    (r, a): unknown => {
      const data = urlState(r).data,
        value = stripURLTabs(string(a[0]));
      if (credentials(data)) setPort(data, value);
      return undefined;
    },
  );
  accessor(
    urlPrototype,
    "pathname",
    (r, _a): unknown => urlState(r).data.path,
    (r, a): unknown => {
      const data = urlState(r).data;
      let value = stripURLTabs(string(a[0]));
      if (!data.opaque) {
        const special = specialPort(data.scheme) !== undefined;
        if (special) value = value.split("\\").join("/");
        data.path =
          value === "" && !special && data.hostname !== undefined
            ? ""
            : normalizePath(
                value.startsWith("/") ? value : "/" + value,
                data.scheme === "file",
              );
      }
      return undefined;
    },
  );
  accessor(
    urlPrototype,
    "search",
    (r, _a): unknown => {
      const query = urlState(r).data.query;
      return query === undefined || query === "" ? "" : "?" + query;
    },
    (r, a): unknown => {
      const state = urlState(r);
      setSearch(state.data, string(a[0]));
      refresh(state);
      return undefined;
    },
  );
  accessor(
    urlPrototype,
    "hash",
    (r, _a): unknown => {
      const fragment = urlState(r).data.fragment;
      return fragment === undefined || fragment === "" ? "" : "#" + fragment;
    },
    (r, a): unknown => {
      setHash(urlState(r).data, string(a[0]));
      return undefined;
    },
  );
  accessor(urlPrototype, "searchParams", (r, _a): unknown => {
    const state = urlState(r);
    const existing = state.parameters;
    if (existing !== undefined) return existing;
    const object = createObject<ScriptPropertyKey, unknown>(paramsPrototype);
    ensureExoticSlots(object).internalURLParameters = {
      pairs: readParameters(state.data.query),
      url: state,
    };
    state.parameters = object;
    return object;
  });
  method(urlPrototype, "toString", "toString", 0, (r, _a): unknown =>
    serializeURL(urlState(r).data),
  );
  method(urlPrototype, "toJSON", "toJSON", 0, (r, _a): unknown =>
    serializeURL(urlState(r).data),
  );

  accessor(
    paramsPrototype,
    "size",
    (r, _a): unknown => paramsState(r).pairs.length,
  );
  method(paramsPrototype, "append", "append", 2, (r, a): unknown => {
    const state = paramsState(r);
    requireCount(a, 2, "name");
    state.pairs.push({ name: string(a[0]), value: string(a[1]) });
    sync(state);
    return undefined;
  });
  function matches(
    pair: URLParameter,
    name: string,
    value: string | undefined,
  ): boolean {
    return pair.name === name && (value === undefined || pair.value === value);
  }
  method(paramsPrototype, "delete", "delete", 1, (r, a): unknown => {
    const state = paramsState(r);
    requireCount(a, 1, "name");
    const name = string(a[0]),
      value = a[1] === undefined ? undefined : string(a[1]);
    for (let i = state.pairs.length - 1; i >= 0; i--) {
      const pair = state.pairs[i];
      if (pair !== undefined && matches(pair, name, value))
        state.pairs.splice(i, 1);
    }
    sync(state);
    return undefined;
  });
  method(paramsPrototype, "get", "get", 1, (r, a): unknown => {
    const state = paramsState(r);
    requireCount(a, 1, "name");
    const name = string(a[0]);
    for (const pair of state.pairs)
      if (pair !== undefined && pair.name === name) return pair.value;
    return null;
  });
  method(paramsPrototype, "getAll", "getAll", 1, (r, a): unknown => {
    const state = paramsState(r);
    requireCount(a, 1, "name");
    const name = string(a[0]);
    const values: unknown[] = [];
    for (const pair of state.pairs)
      if (pair !== undefined && pair.name === name) values.push(pair.value);
    return createArrayFromList(values, 0, realm.arrayPrototype, realm, hooks);
  });
  method(paramsPrototype, "has", "has", 1, (r, a): unknown => {
    const state = paramsState(r);
    requireCount(a, 1, "name");
    const name = string(a[0]),
      value = a[1] === undefined ? undefined : string(a[1]);
    for (const pair of state.pairs)
      if (pair !== undefined && matches(pair, name, value)) return true;
    return false;
  });
  method(paramsPrototype, "set", "set", 2, (r, a): unknown => {
    const state = paramsState(r);
    requireCount(a, 2, "name");
    const name = string(a[0]),
      value = string(a[1]);
    let found = false;
    for (let i = 0; i < state.pairs.length; i++) {
      const pair = state.pairs[i];
      if (pair === undefined || pair.name !== name) continue;
      if (!found) {
        found = true;
        pair.value = value;
      } else {
        state.pairs.splice(i, 1);
        i--;
      }
    }
    if (!found) state.pairs.push({ name, value });
    sync(state);
    return undefined;
  });
  method(paramsPrototype, "sort", "sort", 0, (r, _a): unknown => {
    const state = paramsState(r);
    const pairs = state.pairs;
    for (let i = 1; i < pairs.length; i++) {
      const item = pairs[i];
      if (item === undefined) continue;
      let j = i;
      while (j > 0) {
        const previous = pairs[j - 1];
        if (previous === undefined || previous.name <= item.name) break;
        pairs[j] = previous;
        j--;
      }
      pairs[j] = item;
    }
    sync(state);
    return undefined;
  });
  method(paramsPrototype, "forEach", "forEach", 1, (r, a): unknown => {
    const state = paramsState(r);
    const callback = viewObjectValue(a[0], global);
    if (
      callback === undefined ||
      !isCallableObject<ScriptPropertyKey, unknown>(callback)
    )
      throw createCodedRuntimeError(
        realm,
        hooks,
        "type",
        'The "callback" argument must be of type function',
        "ERR_INVALID_ARG_TYPE",
        undefined,
        false,
      );
    for (let i = 0; i < state.pairs.length; i++) {
      const pair = state.pairs[i];
      if (pair !== undefined)
        callObjectValueOrThrow(
          callback,
          a[1],
          [pair.value, pair.name, r],
          global,
          realm,
        );
    }
    return undefined;
  });
  method(paramsPrototype, "toString", "toString", 0, (r, _a): unknown =>
    serializeParameters(paramsState(r).pairs),
  );
  function iterator(receiver: unknown, mode: string): RealmObject {
    const parameters = paramsState(receiver);
    const object = createObject<ScriptPropertyKey, unknown>(iteratorPrototype);
    ensureExoticSlots(object).internalURLParametersIterator = {
      parameters,
      mode,
      index: 0,
    };
    return object;
  }
  method(iteratorPrototype, "next", "next", 0, (r, _a): unknown => {
    const state = exoticSlots(objectOf(r)).internalURLParametersIterator;
    if (state === undefined) return typeError();
    const pair = state.parameters.pairs[state.index];
    let value: unknown = undefined;
    if (pair !== undefined) {
      state.index++;
      value =
        state.mode === "keys"
          ? pair.name
          : state.mode === "values"
            ? pair.value
            : createArrayFromList(
                [pair.name, pair.value],
                0,
                realm.arrayPrototype,
                realm,
                hooks,
              );
    }
    const result = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    createDataProperty<ScriptPropertyKey, unknown>(
      result,
      "value",
      value,
      hooks,
    );
    createDataProperty<ScriptPropertyKey, unknown>(
      result,
      "done",
      pair === undefined,
      hooks,
    );
    return result;
  });
  const entries = method(
    paramsPrototype,
    "entries",
    "entries",
    0,
    (r, _a): unknown => iterator(r, "entries"),
  );
  builtinProperty(paramsPrototype, iteratorKey, entries, true, true, hooks);
  method(paramsPrototype, "keys", "keys", 0, (r, _a): unknown =>
    iterator(r, "keys"),
  );
  method(paramsPrototype, "values", "values", 0, (r, _a): unknown =>
    iterator(r, "values"),
  );
}

import { createArrayFromList } from "./array-like.ts";
import { isCallableObject } from "./call.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
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
import { enqueueScriptJob } from "./jobs.ts";
import {
  createConstructorObject,
  createObject,
  ensureExoticSlots,
  exoticSlots,
  getProperty,
  type ObjectCall,
  type ObjectHooks,
  type OrdinaryObject,
} from "./operations.ts";
import {
  registeredSymbol,
  wellKnownSymbol,
  type ScriptPropertyKey,
} from "./symbols.ts";
import { scriptBoolean, viewObjectValue } from "./values.ts";

type RealmObject = OrdinaryObject<ScriptPropertyKey, unknown>;
interface ListenerEntry {
  readonly type: string;
  readonly callback: RealmObject;
  readonly capture: boolean;
  readonly once: boolean;
  readonly passive: boolean;
  readonly resistStop: boolean;
  unsubscribe: (() => void) | undefined;
  removed: boolean;
}
interface TargetState {
  readonly listeners: ListenerEntry[];
}
interface EventState {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  readonly composed: boolean;
  readonly detail: unknown;
  readonly custom: boolean;
  readonly timeStamp: number;
  readonly trusted: boolean;
  target: RealmObject | null;
  currentTarget: RealmObject | null;
  dispatching: boolean;
  stopped: boolean;
  immediate: boolean;
  passive: boolean;
  canceled: boolean;
}
interface SignalState {
  aborted: boolean;
  reason: unknown;
  readonly algorithms: Set<() => void>;
  readonly dependents: Set<RealmObject>;
  readonly sources: RealmObject[];
  onabort: RealmObject | undefined;
}
export interface WebEventSlots {
  event: EventState | undefined;
  target: TargetState | undefined;
  signal: SignalState | undefined;
  controllerSignal: RealmObject | undefined;
  exception: { readonly name: string; readonly message: string } | undefined;
}

const legacyExceptions = [
  "IndexSizeError",
  "DOMStringSizeError",
  "HierarchyRequestError",
  "WrongDocumentError",
  "InvalidCharacterError",
  "NoDataAllowedError",
  "NoModificationAllowedError",
  "NotFoundError",
  "NotSupportedError",
  "InUseAttributeError",
  "InvalidStateError",
  "SyntaxError",
  "InvalidModificationError",
  "NamespaceError",
  "InvalidAccessError",
  "ValidationError",
  "TypeMismatchError",
  "SecurityError",
  "NetworkError",
  "AbortError",
  "URLMismatchError",
  "QuotaExceededError",
  "TimeoutError",
  "InvalidNodeTypeError",
  "DataCloneError",
];
const exceptionConstants = [
  "INDEX_SIZE_ERR",
  "DOMSTRING_SIZE_ERR",
  "HIERARCHY_REQUEST_ERR",
  "WRONG_DOCUMENT_ERR",
  "INVALID_CHARACTER_ERR",
  "NO_DATA_ALLOWED_ERR",
  "NO_MODIFICATION_ALLOWED_ERR",
  "NOT_FOUND_ERR",
  "NOT_SUPPORTED_ERR",
  "INUSE_ATTRIBUTE_ERR",
  "INVALID_STATE_ERR",
  "SYNTAX_ERR",
  "INVALID_MODIFICATION_ERR",
  "NAMESPACE_ERR",
  "INVALID_ACCESS_ERR",
  "VALIDATION_ERR",
  "TYPE_MISMATCH_ERR",
  "SECURITY_ERR",
  "NETWORK_ERR",
  "ABORT_ERR",
  "URL_MISMATCH_ERR",
  "QUOTA_EXCEEDED_ERR",
  "TIMEOUT_ERR",
  "INVALID_NODE_TYPE_ERR",
  "DATA_CLONE_ERR",
];

function eventSlots(object: RealmObject): WebEventSlots {
  const slots = ensureExoticSlots(object);
  const existing = slots.internalWebEvents;
  if (existing !== undefined) return existing;
  const state: WebEventSlots = {
    event: undefined,
    target: undefined,
    signal: undefined,
    controllerSignal: undefined,
    exception: undefined,
  };
  slots.internalWebEvents = state;
  return state;
}

export function installWebEventIntrinsics(
  global: RealmObject,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  function typeError(): never {
    throw createRuntimeError(realm, "type");
  }
  function property(object: RealmObject, name: ScriptPropertyKey): unknown {
    return getProperty<ScriptPropertyKey, unknown>(object, name, object, hooks);
  }
  function objectOf(value: unknown): RealmObject {
    const result = viewObjectValue(value, global);
    if (result === undefined) return typeError();
    return result;
  }
  function text(value: unknown): string {
    return stringValueOrThrow(value, hooks, realm);
  }
  function truth(value: unknown): boolean {
    return scriptBoolean(value, global);
  }
  function member(value: unknown, key: string): unknown {
    if (value === undefined || value === null) return undefined;
    return property(objectOf(value), key);
  }
  function method(
    prototype: RealmObject,
    key: ScriptPropertyKey,
    name: string,
    length: number,
    call: ObjectCall<unknown>,
  ): void {
    builtinProperty(
      prototype,
      key,
      builtinFunction(realm.functionPrototype, name, length, call, hooks),
      true,
      true,
      hooks,
    );
  }
  function getter(
    prototype: RealmObject,
    name: string,
    get: ObjectCall<unknown>,
    set?: ObjectCall<unknown>,
  ): void {
    builtinAccessor(
      prototype,
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
  function constructor(
    name: string,
    length: number,
    prototype: RealmObject,
    init: (object: RealmObject, args: readonly unknown[]) => void,
  ): RealmObject {
    const result = createConstructorObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (_receiver, _args): unknown => typeError(),
      (args, newTarget): unknown => {
        const parent = viewObjectValue(
          property(objectOf(newTarget), "prototype"),
          global,
        );
        const instance = createObject<ScriptPropertyKey, unknown>(
          parent ?? prototype,
        );
        init(instance, args);
        return instance;
      },
    );
    builtinFunctionMetadata(result, name, length, hooks);
    builtinProperty(result, "prototype", prototype, false, false, hooks);
    builtinProperty(prototype, "constructor", result, true, true, hooks);
    builtinProperty(
      prototype,
      wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
      name,
      false,
      true,
      hooks,
    );
    builtinProperty(global, name, result, true, true, hooks);
    return result;
  }

  const exceptionPrototype = createObject<ScriptPropertyKey, unknown>(
    realm.prototypes.get("error") ?? realm.objectPrototype,
  );
  function exception(receiver: unknown): {
    readonly name: string;
    readonly message: string;
  } {
    const state = exoticSlots(objectOf(receiver)).internalWebEvents?.exception;
    if (state === undefined) return typeError();
    return state;
  }
  function domException(message: string, name: string): RealmObject {
    const object = createObject<ScriptPropertyKey, unknown>(exceptionPrototype);
    eventSlots(object).exception = { name, message };
    return object;
  }
  const domConstructor = constructor(
    "DOMException",
    0,
    exceptionPrototype,
    (object, args): void => {
      eventSlots(object).exception = {
        message: args[0] === undefined ? "" : text(args[0]),
        name: args[1] === undefined ? "Error" : text(args[1]),
      };
    },
  );
  getter(
    exceptionPrototype,
    "name",
    (receiver, _args): unknown => exception(receiver).name,
  );
  getter(
    exceptionPrototype,
    "message",
    (receiver, _args): unknown => exception(receiver).message,
  );
  getter(exceptionPrototype, "code", (receiver, _args): unknown => {
    const name = exception(receiver).name;
    if (
      name === "DOMStringSizeError" ||
      name === "NoDataAllowedError" ||
      name === "ValidationError"
    )
      return 0;
    return legacyExceptions.indexOf(name) + 1;
  });
  for (let index = 0; index < exceptionConstants.length; index++) {
    const key = exceptionConstants[index];
    if (key === undefined) continue;
    builtinProperty(domConstructor, key, index + 1, false, false, hooks);
    builtinProperty(exceptionPrototype, key, index + 1, false, false, hooks);
  }

  const eventPrototype = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const customPrototype = createObject<ScriptPropertyKey, unknown>(
    eventPrototype,
  );
  const timeOrigin = realm.wallClockMilliseconds?.() ?? 0;
  function eventRecord(
    type: string,
    options: unknown,
    custom: boolean,
    trusted: boolean,
  ): EventState {
    const detail = custom ? member(options, "detail") : undefined;
    return {
      type,
      bubbles: truth(member(options, "bubbles")),
      cancelable: truth(member(options, "cancelable")),
      composed: truth(member(options, "composed")),
      detail: detail === undefined ? null : detail,
      custom,
      trusted,
      timeStamp: Math.max(
        0,
        (realm.wallClockMilliseconds?.() ?? timeOrigin) - timeOrigin,
      ),
      target: null,
      currentTarget: null,
      dispatching: false,
      stopped: false,
      immediate: false,
      passive: false,
      canceled: false,
    };
  }
  const eventConstructor = constructor(
    "Event",
    1,
    eventPrototype,
    (object, args): void => {
      if (args.length === 0) return typeError();
      eventSlots(object).event = eventRecord(
        text(args[0]),
        args[1],
        false,
        false,
      );
    },
  );
  constructor("CustomEvent", 1, customPrototype, (object, args): void => {
    if (args.length === 0) return typeError();
    eventSlots(object).event = eventRecord(text(args[0]), args[1], true, false);
  });
  function event(receiver: unknown): EventState {
    const state = exoticSlots(objectOf(receiver)).internalWebEvents?.event;
    if (state === undefined) return typeError();
    return state;
  }
  getter(eventPrototype, "type", (r, _a): unknown => event(r).type);
  getter(eventPrototype, "target", (r, _a): unknown => event(r).target);
  getter(eventPrototype, "srcElement", (r, _a): unknown => event(r).target);
  getter(
    eventPrototype,
    "currentTarget",
    (r, _a): unknown => event(r).currentTarget,
  );
  getter(eventPrototype, "bubbles", (r, _a): unknown => event(r).bubbles);
  getter(eventPrototype, "cancelable", (r, _a): unknown => event(r).cancelable);
  getter(eventPrototype, "composed", (r, _a): unknown => event(r).composed);
  getter(
    eventPrototype,
    "defaultPrevented",
    (r, _a): unknown => event(r).canceled,
  );
  getter(eventPrototype, "isTrusted", (r, _a): unknown => event(r).trusted);
  getter(eventPrototype, "timeStamp", (r, _a): unknown => event(r).timeStamp);
  getter(eventPrototype, "eventPhase", (r, _a): unknown =>
    event(r).dispatching ? 2 : 0,
  );
  getter(customPrototype, "detail", (r, _a): unknown => {
    const state = event(r);
    if (!state.custom) return typeError();
    return state.detail;
  });
  const phases = ["NONE", "CAPTURING_PHASE", "AT_TARGET", "BUBBLING_PHASE"];
  for (let phase = 0; phase < phases.length; phase++) {
    const key = phases[phase];
    if (key === undefined) continue;
    builtinProperty(eventConstructor, key, phase, false, false, hooks);
    builtinProperty(eventPrototype, key, phase, false, false, hooks);
  }
  function cancel(state: EventState): void {
    if (state.cancelable && !state.passive) state.canceled = true;
  }
  getter(
    eventPrototype,
    "cancelBubble",
    (r, _a): unknown => event(r).stopped,
    (r, a): unknown => {
      if (truth(a[0])) event(r).stopped = true;
      return undefined;
    },
  );
  getter(
    eventPrototype,
    "returnValue",
    (r, _a): unknown => !event(r).canceled,
    (r, a): unknown => {
      if (!truth(a[0])) cancel(event(r));
      return undefined;
    },
  );
  method(
    eventPrototype,
    "stopPropagation",
    "stopPropagation",
    0,
    (r, _a): unknown => {
      event(r).stopped = true;
      return undefined;
    },
  );
  method(
    eventPrototype,
    "stopImmediatePropagation",
    "stopImmediatePropagation",
    0,
    (r, _a): unknown => {
      const state = event(r);
      state.stopped = true;
      state.immediate = true;
      return undefined;
    },
  );
  method(
    eventPrototype,
    "preventDefault",
    "preventDefault",
    0,
    (r, _a): unknown => {
      cancel(event(r));
      return undefined;
    },
  );
  method(
    eventPrototype,
    "composedPath",
    "composedPath",
    0,
    (r, _a): unknown => {
      const target = event(r).currentTarget;
      return createArrayFromList(
        target === null ? [] : [target],
        0,
        realm.arrayPrototype,
        realm,
        hooks,
      );
    },
  );
  method(eventPrototype, "initEvent", "initEvent", 1, (r, a): unknown => {
    if (a.length === 0) return typeError();
    const state = event(r);
    const type = text(a[0]);
    if (!state.dispatching) {
      state.type = type;
      state.bubbles = truth(a[1]);
      state.cancelable = truth(a[2]);
      state.canceled = false;
      state.stopped = false;
      state.immediate = false;
      state.target = null;
    }
    return undefined;
  });

  const targetPrototype = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  const signalPrototype = createObject<ScriptPropertyKey, unknown>(
    targetPrototype,
  );
  function target(receiver: unknown): TargetState {
    const state = exoticSlots(objectOf(receiver)).internalWebEvents?.target;
    if (state === undefined) return typeError();
    return state;
  }
  function signal(receiver: unknown): SignalState {
    const state = exoticSlots(objectOf(receiver)).internalWebEvents?.signal;
    if (state === undefined) return typeError();
    return state;
  }
  function drop(state: TargetState, entry: ListenerEntry): void {
    if (entry.removed) return;
    entry.removed = true;
    entry.unsubscribe?.();
    const index = state.listeners.indexOf(entry);
    if (index >= 0) state.listeners.splice(index, 1);
  }
  function find(
    state: TargetState,
    type: string,
    callback: RealmObject,
    capture: boolean,
  ): ListenerEntry | undefined {
    for (const entry of state.listeners) {
      if (
        entry !== undefined &&
        entry.type === type &&
        entry.callback === callback &&
        entry.capture === capture
      )
        return entry;
    }
    return undefined;
  }
  function add(
    state: TargetState,
    type: string,
    callback: RealmObject,
    capture: boolean,
    once: boolean,
    passive: boolean,
    cancellation: SignalState | undefined,
    resistStop: boolean = false,
  ): ListenerEntry | undefined {
    if (
      cancellation?.aborted === true ||
      find(state, type, callback, capture) !== undefined
    )
      return undefined;
    const entry: ListenerEntry = {
      type,
      callback,
      capture,
      once,
      passive,
      resistStop,
      removed: false,
      unsubscribe: undefined,
    };
    state.listeners.push(entry);
    if (cancellation !== undefined) {
      const algorithms = cancellation.algorithms;
      const remove = (): void => drop(state, entry);
      algorithms.add(remove);
      entry.unsubscribe = (): void => {
        algorithms.delete(remove);
      };
    }
    return entry;
  }
  function captureOption(value: unknown): boolean {
    return typeof value === "boolean" ? value : truth(member(value, "capture"));
  }
  function reportListenerError(error: unknown): void {
    enqueueScriptJob(
      realm.agent,
      (): void => {
        throw error;
      },
      realm.executionContext,
    );
  }
  function dispatch(receiver: RealmObject, value: unknown): boolean {
    const state = event(value);
    const destination = target(receiver);
    if (state.dispatching)
      throw domException(
        "The event is already being dispatched",
        "InvalidStateError",
      );
    state.target = receiver;
    state.currentTarget = receiver;
    state.dispatching = true;
    // A target with no parent still has an at-target capture and bubble pass.
    const listeners = destination.listeners.slice();
    try {
      for (let pass = 0; pass < 2; pass++) {
        for (const entry of listeners) {
          if (
            entry === undefined ||
            (state.immediate && !entry.resistStop) ||
            entry.removed ||
            entry.type !== state.type ||
            entry.capture !== (pass === 0)
          )
            continue;
          if (entry.once) drop(destination, entry);
          state.passive = entry.passive;
          try {
            if (isCallableObject<ScriptPropertyKey, unknown>(entry.callback))
              callObjectValueOrThrow(
                entry.callback,
                receiver,
                [value],
                global,
                realm,
              );
            else {
              const callback = property(entry.callback, "handleEvent");
              if (callback !== undefined)
                callObjectValueOrThrow(
                  callback,
                  entry.callback,
                  [value],
                  global,
                  realm,
                );
            }
          } catch (error) {
            reportListenerError(error);
          }
          state.passive = false;
        }
      }
    } finally {
      state.dispatching = false;
      state.currentTarget = null;
      state.stopped = false;
      state.immediate = false;
      state.passive = false;
    }
    return !state.canceled;
  }
  constructor("EventTarget", 0, targetPrototype, (object, _args): void => {
    eventSlots(object).target = { listeners: [] };
  });
  method(
    targetPrototype,
    "addEventListener",
    "addEventListener",
    2,
    (r, a): unknown => {
      const state = target(r);
      if (a.length < 2) return typeError();
      const type = text(a[0]);
      const callback =
        a[1] === null || a[1] === undefined ? undefined : objectOf(a[1]);
      const options = a[2];
      const capture = captureOption(options);
      const once =
        typeof options === "boolean" ? false : truth(member(options, "once"));
      const passive =
        typeof options === "boolean"
          ? false
          : truth(member(options, "passive"));
      const cancel =
        typeof options === "boolean" ? undefined : member(options, "signal");
      const cancellation = cancel === undefined ? undefined : signal(cancel);
      if (callback !== undefined)
        add(state, type, callback, capture, once, passive, cancellation);
      return undefined;
    },
  );
  method(
    targetPrototype,
    "removeEventListener",
    "removeEventListener",
    2,
    (r, a): unknown => {
      const state = target(r);
      if (a.length < 2) return typeError();
      const type = text(a[0]);
      const callback =
        a[1] === null || a[1] === undefined ? undefined : objectOf(a[1]);
      const capture = captureOption(a[2]);
      if (callback !== undefined) {
        const entry = find(state, type, callback, capture);
        if (entry !== undefined) drop(state, entry);
      }
      return undefined;
    },
  );
  method(
    targetPrototype,
    "dispatchEvent",
    "dispatchEvent",
    1,
    (r, a): unknown => dispatch(objectOf(r), a[0]),
  );
  const listSymbol = registeredSymbol(
    realm.symbolRegistry,
    "tint.web.eventTargetListeners",
  );
  method(
    targetPrototype,
    listSymbol,
    "getEventListeners",
    1,
    (r, a): unknown => {
      const type = text(a[0]);
      const callbacks: unknown[] = [];
      for (const entry of target(r).listeners)
        if (entry !== undefined && entry.type === type)
          callbacks.push(entry.callback);
      return createArrayFromList(
        callbacks,
        0,
        realm.arrayPrototype,
        realm,
        hooks,
      );
    },
  );

  function newSignal(): RealmObject {
    const object = createObject<ScriptPropertyKey, unknown>(signalPrototype);
    const slots = eventSlots(object);
    slots.target = { listeners: [] };
    slots.signal = {
      aborted: false,
      reason: undefined,
      algorithms: new Set<() => void>(),
      dependents: new Set<RealmObject>(),
      sources: [],
      onabort: undefined,
    };
    return object;
  }
  function markAborted(state: SignalState, reason: unknown): void {
    state.aborted = true;
    state.reason = reason;
  }
  function runAbortSteps(object: RealmObject, state: SignalState): void {
    for (const algorithm of state.algorithms) algorithm();
    state.algorithms.clear();
    for (const source of state.sources)
      if (source !== undefined) signal(source).dependents.delete(object);
    state.sources.length = 0;
    const abortEvent = createObject<ScriptPropertyKey, unknown>(eventPrototype);
    eventSlots(abortEvent).event = eventRecord("abort", undefined, false, true);
    dispatch(object, abortEvent);
  }
  function abort(
    object: RealmObject,
    reason: unknown,
    dispatchEvent: boolean,
  ): void {
    const state = signal(object);
    if (state.aborted) return;
    const value =
      reason === undefined
        ? domException("This operation was aborted", "AbortError")
        : reason;
    markAborted(state, value);
    if (!dispatchEvent) return;
    const pending: RealmObject[] = [];
    for (const dependent of state.dependents) {
      if (dependent === undefined) continue;
      const linked = signal(dependent);
      if (!linked.aborted) {
        markAborted(linked, value);
        pending.push(dependent);
      }
    }
    state.dependents.clear();
    runAbortSteps(object, state);
    for (const dependent of pending)
      if (dependent !== undefined) runAbortSteps(dependent, signal(dependent));
  }
  const signalConstructor = constructor(
    "AbortSignal",
    0,
    signalPrototype,
    (_object, _args): void => typeError(),
  );
  const subscribe = registeredSymbol(
    realm.symbolRegistry,
    "tint.web.subscribeAbort",
  );
  method(
    signalPrototype,
    subscribe,
    "subscribeAbort",
    1,
    (receiver, args): unknown => {
      const state = signal(receiver);
      const callback = objectOf(args[0]);
      if (!isCallableObject<ScriptPropertyKey, unknown>(callback))
        return typeError();
      const destination = target(receiver);
      const entry = state.aborted
        ? undefined
        : add(
            destination,
            "abort",
            callback,
            false,
            true,
            false,
            undefined,
            true,
          );
      if (state.aborted)
        enqueueScriptJob(
          realm.agent,
          (): void => {
            callObjectValueOrThrow(callback, undefined, [], global, realm);
          },
          realm.executionContext,
        );
      return builtinFunction(
        realm.functionPrototype,
        "dispose",
        0,
        (_r, _a): unknown => {
          if (entry !== undefined) drop(destination, entry);
          return undefined;
        },
        hooks,
      );
    },
  );
  getter(signalPrototype, "aborted", (r, _a): unknown => signal(r).aborted);
  getter(signalPrototype, "reason", (r, _a): unknown => signal(r).reason);
  getter(
    signalPrototype,
    "onabort",
    (r, _a): unknown => signal(r).onabort ?? null,
    (r, a): unknown => {
      const state = signal(r);
      const destination = target(r);
      const previous = state.onabort;
      if (previous !== undefined) {
        const old = find(destination, "abort", previous, false);
        if (old !== undefined) drop(destination, old);
      }
      const handler = viewObjectValue(a[0], global);
      state.onabort = undefined;
      if (
        handler !== undefined &&
        isCallableObject<ScriptPropertyKey, unknown>(handler)
      ) {
        state.onabort = handler;
        add(destination, "abort", handler, false, false, false, undefined);
      }
      return undefined;
    },
  );
  method(
    signalPrototype,
    "throwIfAborted",
    "throwIfAborted",
    0,
    (r, _a): unknown => {
      const state = signal(r);
      if (state.aborted) throw state.reason;
      return undefined;
    },
  );
  method(signalConstructor, "abort", "abort", 0, (_r, a): unknown => {
    const object = newSignal();
    abort(object, a[0], false);
    return object;
  });
  method(signalConstructor, "any", "any", 1, (_r, a): unknown => {
    const iterator = getScriptIterator(a[0], realm, hooks);
    const inputs: RealmObject[] = [];
    try {
      while (true) {
        const step = stepScriptIterator(iterator);
        if (step.done) break;
        const input = objectOf(step.value);
        signal(input);
        inputs.push(input);
      }
    } catch (error) {
      closeScriptIterator(iterator, true);
      throw error;
    }
    const object = newSignal();
    const state = signal(object);
    for (const input of inputs) {
      if (input === undefined) continue;
      const source = signal(input);
      if (source.aborted) {
        markAborted(state, source.reason);
        return object;
      }
    }
    function link(source: RealmObject): void {
      const data = signal(source);
      if (data.dependents.has(object)) return;
      data.dependents.add(object);
      state.sources.push(source);
    }
    for (const input of inputs) {
      if (input === undefined) continue;
      const source = signal(input);
      for (const underlying of source.sources)
        if (underlying !== undefined) link(underlying);
      if (source.sources.length === 0) link(input);
    }
    return object;
  });

  const controllerPrototype = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  constructor(
    "AbortController",
    0,
    controllerPrototype,
    (object, _args): void => {
      eventSlots(object).controllerSignal = newSignal();
    },
  );
  function controlled(receiver: unknown): RealmObject {
    const object = exoticSlots(objectOf(receiver)).internalWebEvents
      ?.controllerSignal;
    if (object === undefined) return typeError();
    return object;
  }
  getter(controllerPrototype, "signal", (r, _a): unknown => controlled(r));
  method(controllerPrototype, "abort", "abort", 0, (r, a): unknown => {
    abort(controlled(r), a[0], true);
    return undefined;
  });
}

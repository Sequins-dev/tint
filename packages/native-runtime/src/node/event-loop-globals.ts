import {
  callObjectValue,
  createCallableObject,
  createDataProperty,
  createRuntimeError,
  createObject,
  enqueueScriptJob,
  ensureExoticSlots,
  exoticSlots,
  isCallableObject,
  numberValue,
  rejectUnsupportedExecution,
  viewObjectValue,
  wellKnownSymbol,
  type ErrorRealm,
  type ObjectHooks,
  type OrdinaryObject,
  type ScriptPropertyKey,
} from "@tint/js-runtime/objects";
import type { EventLoop, EventLoopHandle } from "../event-loop.ts";
import { installNodeScheduling } from "./scheduling.ts";

type ScriptObject = OrdinaryObject<ScriptPropertyKey, unknown>;
type ScriptCall = (receiver: unknown, args: readonly unknown[]) => unknown;
type TimerKind = "timeout" | "interval" | "immediate";
interface ScheduledTask {
  readonly immediate: boolean;
  readonly close: () => void;
}

/** Install the Node scheduling surface in the owning realm. Managed timer
 * wrappers never leave the isolate, even when the loop has an inbox. */
export function installNodeEventLoopGlobals(
  loop: EventLoop,
  global: ScriptObject,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const active = new Map<number, ScheduledTask>();

  function property(
    target: ScriptObject,
    key: ScriptPropertyKey,
    value: unknown,
  ): void {
    if (
      !createDataProperty<ScriptPropertyKey, unknown>(target, key, value, hooks)
    )
      throw "NODE_EVENT_LOOP_GLOBAL";
  }
  function callable(call: ScriptCall): ScriptObject {
    return createCallableObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      call,
      realm.executionContext,
    );
  }
  function method(
    target: ScriptObject,
    name: ScriptPropertyKey,
    call: ScriptCall,
  ): void {
    property(target, name, callable(call));
  }
  function checkedCallback(value: unknown): ScriptObject {
    const fn = viewObjectValue(value, global);
    if (fn === undefined || !isCallableObject<ScriptPropertyKey, unknown>(fn)) {
      const error = createRuntimeError(realm, "type");
      property(
        error,
        "message",
        "The callback argument must be of type function",
      );
      property(error, "code", "ERR_INVALID_ARG_TYPE");
      throw error;
    }
    return fn;
  }
  function invoke(
    fn: ScriptObject,
    receiver: unknown,
    args: readonly unknown[],
  ): void {
    const result = callObjectValue(fn, receiver, args, global);
    if (result.error !== "none") throw result.value;
  }
  function delayOf(value: unknown): number {
    const result = numberValue(value, hooks, realm);
    if (result.error === "unsupported")
      return rejectUnsupportedExecution(realm);
    if (result.error !== "none") throw createRuntimeError(realm, "type");
    return result.value;
  }

  function timer(kind: TimerKind, args: readonly unknown[]): unknown {
    const fn = checkedCallback(args[0]);
    const immediate = kind === "immediate";
    const delay = immediate ? 0 : delayOf(args[1]);
    const parameters = args.slice(immediate ? 1 : 2);
    const handle = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    const id = realm.agent.nextObjectIdentity++;
    ensureExoticSlots(handle).internalIdentity = id;
    let task: EventLoopHandle | undefined = undefined;
    let referenced = true;
    let closed = false;
    function close(): void {
      closed = true;
      task?.close();
      task = undefined;
      active.delete(id);
    }
    const entry: ScheduledTask = { immediate, close };
    function arm(): void {
      task?.close();
      const callback = (): void => {
        const scheduled = task;
        try {
          invoke(fn, handle, parameters);
        } finally {
          if (kind !== "interval" && task === scheduled) {
            active.delete(id);
            task = undefined;
            if (immediate) closed = true;
          }
        }
      };
      const scheduled =
        kind === "immediate"
          ? loop.setImmediate(callback)
          : kind === "interval"
            ? loop.setInterval(callback, delay)
            : loop.setTimeout(callback, delay);
      task = scheduled;
      if (!referenced) scheduled.unref();
      active.set(id, entry);
    }
    arm();
    method(handle, "ref", (_receiver, _args): unknown => {
      referenced = true;
      task?.ref();
      return handle;
    });
    method(handle, "unref", (_receiver, _args): unknown => {
      referenced = false;
      task?.unref();
      return handle;
    });
    method(handle, "hasRef", (_receiver, _args): unknown =>
      immediate ? task?.hasRef() === true : referenced,
    );
    method(
      handle,
      wellKnownSymbol(realm.symbolRegistry, "dispose"),
      (_receiver, _args): unknown => {
        close();
        return undefined;
      },
    );
    if (!immediate) {
      method(handle, "refresh", (_receiver, _args): unknown => {
        if (!closed) arm();
        return handle;
      });
      method(handle, "close", (_receiver, _args): unknown => {
        close();
        return handle;
      });
      method(
        handle,
        wellKnownSymbol(realm.symbolRegistry, "toPrimitive"),
        (_receiver, _args): unknown => id,
      );
    }
    return handle;
  }
  function clear(value: unknown, immediate: boolean): void {
    const object = viewObjectValue(value, global);
    let id = 0;
    if (object !== undefined) id = exoticSlots(object).internalIdentity;
    else if (!immediate && typeof value === "number") id = value;
    else if (!immediate && typeof value === "string") id = Number(value);
    if (!Number.isInteger(id) || id <= 0) return;
    const task = active.get(id);
    if (task === undefined || task.immediate !== immediate) return;
    task.close();
  }

  installNodeScheduling({
    nextTick: callable((_receiver, args): unknown => {
      const fn = checkedCallback(args[0]);
      const parameters = args.slice(1);
      loop.nextTick((): void => invoke(fn, undefined, parameters));
      return undefined;
    }),
    setImmediate: callable((_receiver, args): unknown =>
      timer("immediate", args),
    ),
    clearImmediate: callable((_receiver, args): unknown => {
      clear(args[0], true);
      return undefined;
    }),
  });
  method(global, "setTimeout", (_receiver, args): unknown =>
    timer("timeout", args),
  );
  method(global, "setInterval", (_receiver, args): unknown =>
    timer("interval", args),
  );
  const clearTimer: ScriptCall = (_receiver, args): unknown => {
    clear(args[0], false);
    return undefined;
  };
  method(global, "clearTimeout", clearTimer);
  method(global, "clearInterval", clearTimer);
  method(global, "queueMicrotask", (_receiver, args): unknown => {
    const fn = checkedCallback(args[0]);
    enqueueScriptJob(
      realm.agent,
      (): void => invoke(fn, undefined, []),
      realm.executionContext,
    );
    return undefined;
  });
}

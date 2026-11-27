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

type ScriptObject = OrdinaryObject<ScriptPropertyKey, unknown>;
type ScriptCall = (receiver: unknown, args: readonly unknown[]) => unknown;
type TimerKind = "timeout" | "interval";

/** Install the Node scheduling surface in the owning realm. Managed timer
 * wrappers never leave the isolate, even when the loop has an inbox. */
export function installNodeEventLoopGlobals(
  loop: EventLoop,
  global: ScriptObject,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const active = new Map<number, EventLoopHandle>();

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
  function method(
    target: ScriptObject,
    name: ScriptPropertyKey,
    call: ScriptCall,
  ): void {
    property(
      target,
      name,
      createCallableObject<ScriptPropertyKey, unknown>(
        realm.functionPrototype,
        call,
        realm.executionContext,
      ),
    );
  }
  function checkedCallback(value: unknown): ScriptObject {
    const fn = viewObjectValue(value, global);
    if (fn === undefined || !isCallableObject<ScriptPropertyKey, unknown>(fn))
      throw createRuntimeError(realm, "type");
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
    const delay = delayOf(args[1]);
    const parameters = args.slice(2);
    const handle = createObject<ScriptPropertyKey, unknown>(
      realm.objectPrototype,
    );
    const id = realm.agent.nextObjectIdentity++;
    ensureExoticSlots(handle).internalIdentity = id;
    const callback = (): void => {
      try {
        invoke(fn, handle, parameters);
      } finally {
        if (kind !== "interval") active.delete(id);
      }
    };
    const task =
      kind === "interval"
        ? loop.setInterval(callback, delay)
        : loop.setTimeout(callback, delay);
    active.set(id, task);
    method(handle, "ref", (_receiver, _args): unknown => {
      task.ref();
      return handle;
    });
    method(handle, "unref", (_receiver, _args): unknown => {
      task.unref();
      return handle;
    });
    method(handle, "hasRef", (_receiver, _args): unknown => task.hasRef());
    method(
      handle,
      wellKnownSymbol(realm.symbolRegistry, "toPrimitive"),
      (_receiver, _args): unknown => id,
    );
    return handle;
  }
  function clear(value: unknown): void {
    const object = viewObjectValue(value, global);
    let id = 0;
    if (object !== undefined) id = exoticSlots(object).internalIdentity;
    else if (typeof value === "number") id = value;
    else if (typeof value === "string") id = Number(value);
    if (!Number.isInteger(id) || id <= 0) return;
    const task = active.get(id);
    if (task === undefined) return;
    task.close();
    active.delete(id);
  }

  method(global, "setTimeout", (_receiver, args): unknown =>
    timer("timeout", args),
  );
  method(global, "setInterval", (_receiver, args): unknown =>
    timer("interval", args),
  );
  const clearTimer: ScriptCall = (_receiver, args): unknown => {
    clear(args[0]);
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

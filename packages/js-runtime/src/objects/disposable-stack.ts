import {
  createDisposalStack,
  pushDisposalResource,
  moveDisposalStack,
  type DisposalStack,
} from "../disposal/index.ts";
import {
  createObject,
  createConstructorObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import {
  builtinProperty,
  builtinFunction,
  builtinFunctionMetadata,
  builtinAccessor,
} from "./intrinsics.ts";
import { isCallableObject } from "./call.ts";
import { constructorPrototype } from "./functions.ts";
import { viewObjectValue } from "./values.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import {
  resolveDisposalMethod,
  disposeSyncResources,
  disposeAsyncResources,
} from "./disposal-resources.ts";
function requireStack(
  value: unknown,
  asynchronous: boolean,
  realm: ErrorRealm,
): DisposalStack<unknown> {
  const object = viewObjectValue(value, realm.objectPrototype),
    data =
      object === undefined
        ? undefined
        : asynchronous
          ? object.internalAsyncDisposableStack
          : object.internalDisposableStack;
  if (data === undefined) throw createRuntimeError(realm, "type");
  return data;
}
export function installDisposableStackIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  installDisposalStackIntrinsics(global, realm, hooks, false);
}
/** The two intrinsic families share policy, while retaining distinct brands and
 * prototypes. Their executors implement the different completion/suspension rules. */
export function installDisposalStackIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  asynchronous: boolean,
): void {
  const prototype = asynchronous
    ? realm.asyncDisposableStackPrototype
    : realm.disposableStackPrototype;
  const name = asynchronous ? "AsyncDisposableStack" : "DisposableStack",
    hint: "async" | "sync" = asynchronous ? "async" : "sync";
  function make(
    data: DisposalStack<unknown>,
    parent: OrdinaryObject<ScriptPropertyKey, unknown>,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = createObject<ScriptPropertyKey, unknown>(parent);
    if (asynchronous) object.internalAsyncDisposableStack = data;
    else object.internalDisposableStack = data;
    return object;
  }
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, target): unknown =>
      make(
        createDisposalStack<unknown>(),
        constructorPrototype(
          target,
          asynchronous ? "async-disposable-stack" : "disposable-stack",
          realm,
          hooks,
        ),
      ),
  );
  builtinFunctionMetadata(constructor, name, 0, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
  builtinProperty(
    prototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    name,
    false,
    true,
    hooks,
  );
  builtinAccessor(
    prototype,
    "disposed",
    builtinFunction(
      realm.functionPrototype,
      "get disposed",
      0,
      (receiver, args): unknown =>
        requireStack(receiver, asynchronous, realm).state === "disposed",
      hooks,
    ),
    undefined,
    hooks,
  );
  for (const methodName of [
    "use",
    "adopt",
    "defer",
    "move",
    asynchronous ? "disposeAsync" : "dispose",
  ]) {
    if (methodName === undefined) throw "DISPOSAL_METHOD_NAME_INVARIANT";
    const method = builtinFunction(
      realm.functionPrototype,
      methodName,
      methodName === "adopt"
        ? 2
        : methodName === "use" || methodName === "defer"
          ? 1
          : 0,
      (receiver, args): unknown => {
        if (methodName === "disposeAsync")
          return disposeAsyncResources(
            (): DisposalStack<unknown> => requireStack(receiver, true, realm),
            realm,
            hooks,
            false,
            undefined,
          );
        if (methodName === "dispose") {
          disposeSyncResources(
            requireStack(receiver, false, realm),
            realm,
            hooks,
            false,
            undefined,
          );
          return undefined;
        }
        const stack = requireStack(receiver, asynchronous, realm);
        if (stack.state !== "pending")
          throw createRuntimeError(realm, "reference");
        if (methodName === "move") {
          const data = moveDisposalStack<unknown>(stack);
          if (data === undefined) throw "DISPOSAL_MOVE_INVARIANT";
          return make(data, prototype);
        }
        if (methodName === "use") {
          const resources = stack.resources,
            value = args[0];
          if (value === undefined || value === null) {
            if (asynchronous)
              resources.push({
                value: undefined,
                method: undefined,
                hint: "async",
              });
            return value;
          }
          const dispose = resolveDisposalMethod(
            value,
            asynchronous,
            realm,
            hooks,
          );
          if (dispose === undefined) throw createRuntimeError(realm, "type");
          // AddDisposableResource receives its list before invoking the resource getter.
          resources.push({ value, method: dispose, hint });
          return value;
        }
        const callback = args[methodName === "adopt" ? 1 : 0];
        if (
          !isCallableObject<ScriptPropertyKey, unknown>(
            viewObjectValue(callback, realm.objectPrototype),
          )
        )
          throw createRuntimeError(realm, "type");
        const value = args[0],
          dispose =
            methodName === "adopt"
              ? builtinFunction(
                  realm.functionPrototype,
                  "",
                  0,
                  (receiver, args): unknown =>
                    hooks.call(callback, undefined, [value]),
                  hooks,
                )
              : callback;
        if (
          !pushDisposalResource<unknown>(stack, {
            value: undefined,
            method: dispose,
            hint,
          })
        )
          throw "DISPOSAL_REGISTRATION_INVARIANT";
        return methodName === "adopt" ? value : undefined;
      },
      hooks,
    );
    builtinProperty(prototype, methodName, method, true, true, hooks);
    if (methodName === "dispose" || methodName === "disposeAsync")
      builtinProperty(
        prototype,
        wellKnownSymbol(
          realm.symbolRegistry,
          asynchronous ? "asyncDispose" : "dispose",
        ),
        method,
        true,
        true,
        hooks,
      );
  }
  builtinProperty(global, name, constructor, true, true, hooks);
}

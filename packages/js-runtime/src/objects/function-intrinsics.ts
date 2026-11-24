import { stringValue } from "./coercion.ts";
import { arrayLikeValues } from "./array-like.ts";
import { callObject } from "./call.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { ordinaryHasInstance } from "./functions.ts";
import {
  createConstructorObject,
  ensureRareSlots,
  getOwnProperty,
  getProperty,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectCallDispatch,
} from "./operations.ts";
import {
  builtinFunctionMetadata,
  builtinFunction,
  builtinProperty,
} from "./intrinsics.ts";
import { createBoundFunction } from "./bound-functions.ts";
import { viewObjectValue } from "./values.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
  type DynamicFunctionCompiler,
} from "./errors.ts";
/** Function protocol operations. Dynamic source compilation requires its own pipeline. */
export function installFunctionIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const ordinary = builtinFunction(
    realm.functionPrototype,
    "[Symbol.hasInstance]",
    1,
    (receiver, args): unknown => {
      const result = ordinaryHasInstance(args[0], receiver, hooks, realm);
      if (result.error !== "none") throw createRuntimeError(realm, "type");
      return result.value;
    },
    hooks,
  );
  realm.ordinaryHasInstanceMethod = ordinary;
  builtinProperty(
    realm.functionPrototype,
    wellKnownSymbol(realm.symbolRegistry, "hasInstance"),
    ordinary,
    false,
    false,
    hooks,
  );
  function callable(
    value: unknown,
  ): OrdinaryObject<ScriptPropertyKey, unknown> {
    const object = viewObjectValue(value, realm.objectPrototype);
    if (object === undefined || object.internalCall === undefined)
      throw createRuntimeError(realm, "type");
    return object;
  }
  function compileDynamic(
    kind: "normal" | "generator" | "async" | "async-generator",
    args: readonly unknown[],
    target: unknown,
  ): unknown {
    const parameters: string[] = [];
    let body = "";
    // Coercion precedes compilation, including syntax validation. A later body
    // conversion can throw even when an earlier parameter string is invalid.
    for (let index = 0; index < args.length; index++) {
      const converted = stringValue(args[index], hooks, realm);
      if (converted.error === "type") throw createRuntimeError(realm, "type");
      if (converted.error === "unsupported") rejectUnsupportedExecution(realm);
      if (index < args.length - 1) parameters.push(converted.value);
      else body = converted.value;
    }
    const compile: DynamicFunctionCompiler | undefined =
      realm.dynamicFunctionCompiler;
    if (compile === undefined) return rejectUnsupportedExecution(realm);
    return compile(kind, parameters, body, target);
  }
  const constructor: OrdinaryObject<ScriptPropertyKey, unknown> =
    createConstructorObject<ScriptPropertyKey, unknown>(
      realm.functionPrototype,
      (receiver, args): unknown => compileDynamic("normal", args, constructor),
      (args, target): unknown => compileDynamic("normal", args, target),
    );
  builtinFunctionMetadata(constructor, "Function", 1, hooks);
  builtinProperty(
    constructor,
    "prototype",
    realm.functionPrototype,
    false,
    false,
    hooks,
  );
  builtinProperty(
    realm.functionPrototype,
    "constructor",
    constructor,
    true,
    true,
    hooks,
  );
  function installDynamicConstructor(
    name: string,
    kind: "generator" | "async" | "async-generator",
    prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  ): void {
    const dynamic: OrdinaryObject<ScriptPropertyKey, unknown> =
      createConstructorObject<ScriptPropertyKey, unknown>(
        constructor,
        (receiver, args): unknown => compileDynamic(kind, args, dynamic),
        (args, target): unknown => compileDynamic(kind, args, target),
      );
    builtinFunctionMetadata(dynamic, name, 1, hooks);
    builtinProperty(dynamic, "prototype", prototype, false, false, hooks);
    builtinProperty(prototype, "constructor", dynamic, false, true, hooks);
  }
  installDynamicConstructor(
    "GeneratorFunction",
    "generator",
    realm.generatorFunctionPrototype,
  );
  installDynamicConstructor(
    "AsyncFunction",
    "async",
    realm.asyncFunctionPrototype,
  );
  installDynamicConstructor(
    "AsyncGeneratorFunction",
    "async-generator",
    realm.asyncGeneratorFunctionPrototype,
  );
  builtinProperty(
    realm.asyncFunctionPrototype,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "AsyncFunction",
    false,
    true,
    hooks,
  );
  const call = builtinFunction(
    realm.functionPrototype,
    "call",
    1,
    (receiver, args): unknown => {
      const target = callable(receiver);
      const result = callObject<ScriptPropertyKey, unknown>(
        target,
        args[0],
        args.slice(1),
        undefined,
      );
      if (result.error !== "none") throw "CALLABLE_INVARIANT";
      return result.value;
    },
    hooks,
  );
  const apply = builtinFunction(
    realm.functionPrototype,
    "apply",
    2,
    (receiver, args): unknown => {
      const target = callable(receiver);
      const list = args[1];
      const values: unknown[] =
        list === undefined || list === null
          ? []
          : arrayLikeValues(list, realm, hooks);
      const result = callObject<ScriptPropertyKey, unknown>(
        target,
        args[0],
        values,
        undefined,
      );
      if (result.error !== "none") throw "CALLABLE_INVARIANT";
      return result.value;
    },
    hooks,
  );
  realm.functionApply = apply;
  function forwardCall(
    receiver: unknown,
    args: readonly unknown[],
    applying: boolean,
  ): ObjectCallDispatch<ScriptPropertyKey, unknown> {
    let step: ObjectCallDispatch<ScriptPropertyKey, unknown> | undefined =
      undefined;
    // Validate the callee and read the array-like arguments in the builtin's
    // realm, then release that context before the call driver enters the target.
    realm.executionContext.run((): unknown => {
      const target = callable(receiver);
      const list = args[1];
      const values = applying
        ? list === undefined || list === null
          ? []
          : arrayLikeValues(list, realm, hooks)
        : args.slice(1);
      step = { kind: "call", target, receiver: args[0], arguments: values };
      return undefined;
    });
    if (step === undefined) throw "CALLABLE_INVARIANT";
    return step;
  }
  ensureRareSlots<ScriptPropertyKey, unknown>(call).internalTailDispatch = (
    receiver,
    args,
  ): ObjectCallDispatch<ScriptPropertyKey, unknown> =>
    forwardCall(receiver, args, false);
  ensureRareSlots<ScriptPropertyKey, unknown>(apply).internalTailDispatch = (
    receiver,
    args,
  ): ObjectCallDispatch<ScriptPropertyKey, unknown> =>
    forwardCall(receiver, args, true);
  const bind = builtinFunction(
    realm.functionPrototype,
    "bind",
    1,
    (receiver, args): unknown => {
      const target = callable(receiver);
      const prefix = args.slice(1);
      const bound = createBoundFunction<ScriptPropertyKey, unknown>(
        target,
        args[0],
        prefix,
        undefined,
        (object): unknown => object,
        hooks.sameValue,
      );
      let length = 0;
      if (
        getOwnProperty<ScriptPropertyKey, unknown>(target, "length") !==
        undefined
      ) {
        const value = getProperty<ScriptPropertyKey, unknown>(
          target,
          "length",
          receiver,
          hooks,
        );
        if (typeof value === "number" && value > 0)
          length =
            value === Infinity
              ? Infinity
              : Math.max(Math.floor(value) - prefix.length, 0);
      }
      builtinProperty(bound, "length", length, false, true, hooks);
      const name = getProperty<ScriptPropertyKey, unknown>(
        target,
        "name",
        receiver,
        hooks,
      );
      builtinProperty(
        bound,
        "name",
        "bound " + (typeof name === "string" ? name : ""),
        false,
        true,
        hooks,
      );
      return bound;
    },
    hooks,
  );
  builtinProperty(realm.functionPrototype, "call", call, true, true, hooks);
  builtinProperty(realm.functionPrototype, "bind", bind, true, true, hooks);
  builtinProperty(realm.functionPrototype, "apply", apply, true, true, hooks);
  builtinProperty(global, "Function", constructor, true, true, hooks);
}

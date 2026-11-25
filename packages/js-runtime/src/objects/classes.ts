import {
  runClassInitializers,
  type ClassFieldDecoration,
} from "./class-decorators.ts";
import {
  createSourceExecutionContext,
  createFunctionRealmContext,
} from "./jobs.ts";
import { propertyFunctionName } from "./symbols.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  addPrivateField,
  addPrivateMethod,
  addPrivateAccessor,
  type PrivateName,
  type PrivateMethod,
} from "./private-elements.ts";
import {
  createObject,
  createCallableObject,
  createConstructorObject,
  createDataProperty,
  defineOwnProperty,
  ensureExoticSlots,
  isExtensible,
  type OrdinaryObject,
  type ObjectHooks,
  type ObjectCall,
  type ObjectExecutionContext,
} from "./operations.ts";
import {
  checkPrimitiveContract,
  primitiveContractPredicate,
  viewObjectValue,
  callObjectValue,
} from "./values.ts";
import { attachClassFieldContract } from "./property-contracts.ts";
import { makeMethod } from "./methods.ts";
import { constructorPrototype } from "./functions.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import { functionMetadata, builtinProperty } from "./intrinsics.ts";
import {
  getPrivateObjectValue,
  setPrivateObjectValue,
} from "./private-values.ts";

/** Evaluated public field key and initializer, capturing its lexical environment.
 * Keys are prepared once during class definition; initializers run per instance. */
export interface ClassField {
  readonly privateName?: PrivateName;
  readonly name: ScriptPropertyKey;
  readonly initialize: ObjectCall<unknown>;
  readonly decoration?: ClassFieldDecoration;
  readonly contract?: number;
  readonly deferred?: boolean;
}

export type ClassPrivateMethod = PrivateMethod<unknown>;

export function checkClassMethodResult(
  implementation: ObjectCall<unknown>,
  realm: ErrorRealm,
  allowed: number,
): ObjectCall<unknown> {
  return (receiver: unknown, args: readonly unknown[]): unknown =>
    checkPrimitiveContract(realm, implementation(receiver, args), allowed);
}

/** Auto-accessor closures share an anonymous private backing field. Public
 * accessors are installed at definition time; private pairs are installed by
 * InitializeInstanceElements before the backing field is initialized. */
export function prepareClassAutoAccessor(
  target: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: ScriptPropertyKey,
  storage: PrivateName,
  privateName: PrivateName | undefined,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): {
  readonly name: PrivateName;
  readonly kind: "accessor";
  readonly get: unknown;
  readonly set: unknown;
} {
  const getter = createClassMethod(
    target,
    "get " + propertyFunctionName(name),
    0,
    (receiver, args): unknown => {
      const result = getPrivateObjectValue(
        receiver,
        storage,
        hooks,
        realm.objectPrototype,
      );
      if (result.error !== "none")
        throw createRuntimeError(realm, result.error);
      return result.value;
    },
    realm,
    hooks,
  );
  const setter = createClassMethod(
    target,
    "set " + propertyFunctionName(name),
    1,
    (receiver, args): unknown => {
      const error = setPrivateObjectValue(
        receiver,
        storage,
        args[0],
        hooks,
        realm.objectPrototype,
      );
      if (error !== "none") throw createRuntimeError(realm, error);
      return undefined;
    },
    realm,
    hooks,
  );
  if (
    privateName === undefined &&
    defineOwnProperty<ScriptPropertyKey, unknown>(
      target,
      name,
      {
        fields: 60,
        value: undefined,
        writable: false,
        get: getter,
        set: setter,
        enumerable: false,
        configurable: true,
      },
      hooks,
    ) !== "accepted"
  )
    throw createRuntimeError(realm, "type");
  return {
    name: privateName ?? storage,
    kind: "accessor",
    get: getter,
    set: setter,
  };
}

/** Install methods and complete accessor pairs before any instance/static fields.
 * Stage 3 nonextensible-applies-to-private: a non-empty batch first requires
 * ? IsExtensible(receiver), observed once even for several methods; an empty
 * batch never queries the receiver. */
export function initializeClassPrivateMethods(
  receiver: OrdinaryObject<ScriptPropertyKey, unknown>,
  methods: readonly ClassPrivateMethod[],
  realm: ErrorRealm,
): void {
  if (
    methods.length !== 0 &&
    !isExtensible<ScriptPropertyKey, unknown>(receiver)
  )
    throw createRuntimeError(realm, "type");
  for (const method of methods) {
    if (method === undefined) throw "PRIVATE_METHOD_INVARIANT";
    const error =
      method.kind === "method"
        ? addPrivateMethod<ScriptPropertyKey, unknown>(
            receiver,
            method.name,
            method.value,
          )
        : addPrivateAccessor<ScriptPropertyKey, unknown>(
            receiver,
            method.name,
            method.get,
            method.set,
          );
    if (error !== "none") throw createRuntimeError(realm, error);
  }
}

/** Shared instance/static field semantics: DefineOwnProperty, never setter assignment. */
export function initializeClassFields(
  receiver: OrdinaryObject<ScriptPropertyKey, unknown>,
  fields: readonly ClassField[],
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  for (const field of fields) {
    if (field === undefined) throw "CLASS_FIELD_INVARIANT";
    let value = field.initialize(receiver, []);
    const decoration = field.decoration;
    if (decoration !== undefined) {
      for (const initializer of decoration.initializers) {
        const result = callObjectValue(
          initializer,
          receiver,
          [value],
          realm.objectPrototype,
        );
        if (result.error !== "none")
          throw createRuntimeError(realm, result.error);
        value = result.value;
      }
    }
    const privateName = field.privateName;
    const contract = field.contract ?? 0;
    if (contract !== 0 && !(field.deferred === true && value === undefined))
      checkPrimitiveContract(realm, value, contract);
    if (privateName !== undefined) {
      if (
        addPrivateField<ScriptPropertyKey, unknown>(
          receiver,
          privateName,
          value,
          primitiveContractPredicate(contract),
        ) !== "none"
      )
        throw createRuntimeError(realm, "type");
    } else if (
      !createDataProperty<ScriptPropertyKey, unknown>(
        receiver,
        field.name,
        value,
        hooks,
      )
    )
      throw createRuntimeError(realm, "type");
    if (privateName === undefined && contract !== 0)
      attachClassFieldContract(receiver, field.name, contract, realm);
    if (decoration !== undefined)
      runClassInitializers(decoration.extraInitializers, receiver, realm);
  }
}

/** Constructor execution receives the original construction target. */
export type BaseClassBody = (
  receiver: unknown,
  args: readonly unknown[],
  newTarget: unknown,
) => unknown;

/** Construction owns its source-context boundary so completion processing can
 * resume in the caller. Class [[Call]] creates its error in the defining realm. */
export function classConstructorContext(
  realm: ErrorRealm,
): ObjectExecutionContext<unknown> {
  return createFunctionRealmContext(realm);
}

/** Base-class construction. Definition evaluation installs methods, initializes
 * the class binding, then executes static elements separately in source order. */
export function createBaseClass(
  name: string,
  length: number,
  body: BaseClassBody | undefined,
  fields: readonly ClassField[],
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  preparedPrototype:
    OrdinaryObject<ScriptPropertyKey, unknown> | undefined = undefined,
  privateMethods: readonly ClassPrivateMethod[] = [],
  initializers: readonly unknown[] = [],
): OrdinaryObject<ScriptPropertyKey, unknown> {
  let prototype = preparedPrototype;
  if (prototype === undefined)
    prototype = createObject<ScriptPropertyKey, unknown>(realm.objectPrototype);
  const execution = createSourceExecutionContext(realm);
  const constructor = createConstructorObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    (receiver, args): unknown => {
      throw createRuntimeError(realm, "type");
    },
    (args, newTarget): unknown => {
      // OrdinaryCreateFromConstructor precedes PrepareForOrdinaryCall, so its
      // abrupt completions (such as GetFunctionRealm of a revoked proxy
      // newTarget) are created in the caller's realm, not the class realm.
      const instance = createObject<ScriptPropertyKey, unknown>(
        constructorPrototype(newTarget, "object", realm, hooks),
      );
      return execution.run((): unknown => {
        // InitializeInstanceElements precedes parameter defaults and the body.
        initializeClassPrivateMethods(instance, privateMethods, realm);
        runClassInitializers(initializers, instance, realm);
        initializeClassFields(instance, fields, realm, hooks);
        const returned =
          body === undefined ? undefined : body(instance, args, newTarget);
        return viewObjectValue(returned, realm.objectPrototype) === undefined
          ? instance
          : returned;
      });
    },
    classConstructorContext(realm),
  );
  initializeClassConstructor(constructor, prototype, name, length, hooks);
  return constructor;
}

/** Shared base/derived class identity and standard property attributes. */
export function initializeClassConstructor(
  constructor: OrdinaryObject<ScriptPropertyKey, unknown>,
  prototype: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: string,
  length: number,
  hooks: ObjectHooks<unknown>,
): void {
  makeMethod<ScriptPropertyKey, unknown>(constructor, prototype);
  functionMetadata(constructor, name, length, hooks);
  builtinProperty(constructor, "prototype", prototype, false, false, hooks);
  builtinProperty(prototype, "constructor", constructor, true, true, hooks);
}

/** Callable creation is shared by public and private methods/accessors. */
export function createClassMethod(
  home: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: string,
  length: number,
  implementation: ObjectCall<unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  source?: string,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  const method = createCallableObject<ScriptPropertyKey, unknown>(
    realm.functionPrototype,
    implementation,
  );
  functionMetadata(method, name, length, hooks);
  if (source !== undefined)
    ensureExoticSlots(method).internalSourceText = source;
  makeMethod<ScriptPropertyKey, unknown>(method, home);
  return method;
}

/** Method target is the instance prototype or the class constructor. */
export function defineClassMethod(
  target: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: ScriptPropertyKey,
  length: number,
  implementation: ObjectCall<unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  source?: string,
): void {
  const method = createClassMethod(
    target,
    propertyFunctionName(name),
    length,
    implementation,
    realm,
    hooks,
    source,
  );
  defineClassMethodValue(target, name, method, realm, hooks);
}

/** Install an already-created method, including generator/async functions,
 * with class data-property attributes. Creation owns its home-object binding. */
export function defineClassMethodValue(
  target: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: ScriptPropertyKey,
  method: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  if (
    defineOwnProperty<ScriptPropertyKey, unknown>(
      target,
      name,
      {
        fields: 51,
        value: method,
        writable: true,
        enumerable: false,
        configurable: true,
        get: undefined,
        set: undefined,
      },
      hooks,
    ) !== "accepted"
  )
    throw createRuntimeError(realm, "type");
}

/** Specify just one accessor half so repeated getter/setter definitions merge. */
export function defineClassAccessor(
  target: OrdinaryObject<ScriptPropertyKey, unknown>,
  name: ScriptPropertyKey,
  setter: boolean,
  implementation: ObjectCall<unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  length: number = setter ? 1 : 0,
  source?: string,
): void {
  const accessor = createClassMethod(
    target,
    (setter ? "set " : "get ") + propertyFunctionName(name),
    length,
    implementation,
    realm,
    hooks,
    source,
  );
  if (
    defineOwnProperty<ScriptPropertyKey, unknown>(
      target,
      name,
      {
        fields: setter ? 56 : 52,
        value: undefined,
        writable: false,
        get: setter ? undefined : accessor,
        set: setter ? accessor : undefined,
        enumerable: false,
        configurable: true,
      },
      hooks,
    ) !== "accepted"
  )
    throw createRuntimeError(realm, "type");
}

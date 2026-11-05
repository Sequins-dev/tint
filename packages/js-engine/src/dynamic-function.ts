import {
  parseDynamicFunction,
  expectedArgumentCount,
  isSimpleParameter,
} from "@tint/typescript/syntax";
import { validateJavaScriptBindings } from "@tint/typescript/binding";
import {
  compileClosedDynamicFunction,
  compileManagedGlobalAccessDynamicFunction,
  compileManagedReceiverWriteDynamicFunction,
  type ManagedGlobalAccessDynamicFunctionCode,
  resolveManagedPointers,
  type ManagedIdentityBinding,
  type ClosedDynamicFunctionCode,
} from "@tint/compiler/native";
import {
  createGlobalScope,
  resolveBinding,
  getBindingReference,
  type GlobalEnvironment,
} from "@tint/js-runtime/environments/global";
import {
  nativeSignatureHeaderByteLength,
  nativeSignatureParameterByteLength,
} from "@tint/abi/function";
import {
  getObjectValueProperty,
  setObjectValueProperty,
  constructorPrototype,
  createSourceFunction,
  createSourceAsyncDispatchFunction,
  viewObjectValue,
  createSourceGeneratorFunction,
  takeGeneratorStart,
  createSourceAsyncGeneratorFunction,
  takeAsyncGeneratorStart,
  createAsyncReturnContinuation,
  type AsyncGeneratorBodyCompletion,
  type AsyncGeneratorContinuation,
  type GeneratorContinuation,
  type GeneratorResumeKind,
  type GeneratorOutcome,
  type SourceFunctionCall,
  retainFunctionSource,
  sloppyCallReceiver,
  setPrototype,
  type ErrorRealm,
  type OrdinaryObject,
  type ScriptPropertyKey,
  createRuntimeError,
  rejectUnsupportedExecution,
  type ObjectHooks,
  type DynamicFunctionCompiler,
} from "@tint/js-runtime/objects";
import type { DynamicFunctionBodyCompiler } from "./script-evaluation.ts";
import type { EngineCodeStorage } from "./native/code-storage.ts";

type ManagedReader = (base: unknown, step: number) => unknown;
type ManagedReaderFactory = (receiver: unknown) => ManagedReader;

export interface DynamicFunctionContext {
  readonly realm: ErrorRealm;
  readonly global: GlobalEnvironment<ScriptPropertyKey, unknown>;
  readonly object: OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly hooks: ObjectHooks<unknown>;
}
/** Explicit embedding authority; the engine itself performs no host calls. */
export interface DynamicFunctionCodeHost {
  readonly domain: () => number;
  readonly storage: EngineCodeStorage;
  readonly invokeBorrowed: (address: number, value: unknown) => unknown;
  readonly invokeManaged: (
    address: number,
    reader: (base: unknown, step: number) => unknown,
  ) => unknown;
  readonly descriptor: (
    reader: (base: unknown, step: number) => unknown,
  ) => number;
  readonly signature: (
    reader: (base: unknown, step: number) => unknown,
  ) => number;
  readonly readWord: (
    address: number,
    byteLength: number,
    offset: number,
  ) => number;
}
export interface DynamicFunctionLimits {
  readonly maxDynamicCodeBytes: number;
}

/** Creates a realm-local compiler, without installing globals or allocating code.
 * Grammar/binding validation is eager; native body compilation remains lazy.
 * The embedding supplies shared, process-lifetime executable storage. */
export function createDynamicFunctionCompiler(
  context: DynamicFunctionContext,
  host: DynamicFunctionCodeHost,
  limits: DynamicFunctionLimits,
  general?: DynamicFunctionBodyCompiler,
): DynamicFunctionCompiler {
  const realm = context.realm,
    global = context.global,
    object = context.object,
    hooks = context.hooks;
  const domain = host.domain();
  const ensureDomain = (): void => {
    if (
      !Number.isSafeInteger(domain) ||
      domain <= 0 ||
      host.domain() !== domain ||
      host.storage.domain !== domain
    )
      rejectUnsupportedExecution(realm);
  };
  ensureDomain();
  const publishNativeCode = (bytes: Uint8Array, realm: ErrorRealm): number => {
    ensureDomain();
    const address = host.storage.publish(bytes);
    ensureDomain();
    if (address === undefined) return rejectUnsupportedExecution(realm);
    return address;
  };
  const publishManaged = (
    native: ManagedGlobalAccessDynamicFunctionCode["native"],
    entryOffset: number,
    reader: ManagedReader,
    contract: string,
    signatureName: string,
  ): number => {
    ensureDomain();
    const bindings: readonly ManagedIdentityBinding[] = [
      {
        domain,
        role: "function-brand",
        name: "tint.managed.function-brand",
        contract: "tint.function.v1",
        address: host.descriptor(reader),
        byteLength: 32,
        parameters: [],
        returnType: undefined,
      },
      {
        domain,
        role: "signature",
        name: signatureName,
        contract: contract,
        address: host.signature(reader),
        byteLength:
          nativeSignatureHeaderByteLength +
          2 * nativeSignatureParameterByteLength,
        parameters: ["general", "number"],
        returnType: "general",
      },
    ];
    ensureDomain();
    const linked = resolveManagedPointers(
      native,
      bindings,
      (address: number, byteLength: number, offset: number): number =>
        host.readWord(address, byteLength, offset),
      domain,
    );
    if (!linked.ok) return rejectUnsupportedExecution(realm);

    return publishNativeCode(linked.value.code, realm) + entryOffset;
  };
  return (
    kind,
    parameters,
    body,
    target,
  ): OrdinaryObject<ScriptPropertyKey, unknown> => {
    ensureDomain();
    const parsed = parseDynamicFunction(kind, parameters, body);
    if (!parsed.ok) {
      if (
        parsed.error.code === "LIMIT" ||
        parsed.error.code === "UNSUPPORTED_SYNTAX"
      )
        return rejectUnsupportedExecution(realm);
      throw createRuntimeError(realm, "syntax");
    }
    const error = validateJavaScriptBindings(parsed.value.module, "script");
    if (error !== undefined) {
      if (error.code === "LIMIT" || error.code === "UNSUPPORTED")
        return rejectUnsupportedExecution(realm);
      throw createRuntimeError(realm, "syntax");
    }
    const prototype = constructorPrototype(
      target,
      kind === "async"
        ? "async-function"
        : kind === "generator"
          ? "generator-function"
          : kind === "async-generator"
            ? "async-generator-function"
            : "function",
      realm,
      hooks,
    );
    const active = realm.agent.activeContext;
    const identity = active === undefined ? undefined : active.scriptOrModule;
    const syntax = parsed.value;
    const statement = syntax.module.statements[0];
    const expression =
      statement?.kind === "expression" ? statement.expression : undefined;
    if (expression === undefined || expression.kind !== "function-expression")
      throw "DYNAMIC_FUNCTION_SYNTAX_INVARIANT";
    const strict = expression.strict ?? false;
    const length = expectedArgumentCount(expression.parameters);
    let simple = true;
    for (const parameter of expression.parameters) {
      if (parameter === undefined) throw "DYNAMIC_FUNCTION_PARAMETER_INVARIANT";
      if (!isSimpleParameter(parameter)) simple = false;
    }
    // Grammar and binding errors are eager; native body compilation is lazy.
    // Never skip parameter initialization: unsupported formals fail on call,
    // including generator calls, before a suspended iterator can be returned.
    const code: {
      address: number;
      input: number;
      minimumArguments: number;
      completion: ClosedDynamicFunctionCode["completion"];
      mode: "closed" | "managed";
      readerFactory: ManagedReaderFactory | undefined;
      carrier: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
    } = {
      address: 0,
      input: -2,
      minimumArguments: 0,
      completion: "ordinary",
      mode: "closed",
      readerFactory: undefined,
      carrier: undefined,
    };
    const ensureGeneral = (): OrdinaryObject<ScriptPropertyKey, unknown> => {
      ensureDomain();
      const cached = code.carrier;
      if (cached !== undefined) return cached;
      if (general === undefined) return rejectUnsupportedExecution(realm);
      const carrier = general(syntax, identity);
      ensureDomain();
      code.carrier = carrier;
      return carrier;
    };
    const callCarrier = (
      carrier: OrdinaryObject<ScriptPropertyKey, unknown>,
      receiver: unknown,
      args: readonly unknown[],
      callee: unknown,
      newTarget: unknown,
    ): unknown => {
      const call = carrier.internalCall;
      if (call === undefined) throw "DYNAMIC_BODY_CARRIER_INVARIANT";
      const packed: unknown[] = [callee, newTarget];
      for (const value of args) packed.push(value);
      return call(receiver, packed);
    };
    const ensureCompiled = (): void => {
      ensureDomain();
      if (code.address !== 0 || code.carrier !== undefined) return;
      const compiled = compileClosedDynamicFunction(
        syntax,
        limits.maxDynamicCodeBytes,
        { literals: "permanent" },
      );
      if (!compiled.ok) {
        const managed = compileManagedGlobalAccessDynamicFunction(
          syntax,
          limits.maxDynamicCodeBytes,
        );
        if (!managed.ok) {
          const written = compileManagedReceiverWriteDynamicFunction(
            syntax,
            limits.maxDynamicCodeBytes,
          );
          if (!written.ok) {
            ensureGeneral();
            return;
          }
          const write = written.value;
          const makeReader =
            (receiver: unknown): ManagedReader =>
            (base: unknown, step: number): unknown => {
              if (step === 0) return receiver;
              if (step !== 1) throw "MANAGED_RECEIVER_WRITE_STEP_INVARIANT";
              const error = setObjectValueProperty(
                base,
                write.property,
                true,
                write.strict,
                hooks,
                realm,
              );
              if (error === "unsupported")
                return rejectUnsupportedExecution(realm);
              if (error !== "none") throw createRuntimeError(realm, error);
              return undefined;
            };
          const reader = makeReader(undefined);
          code.mode = "managed";
          code.readerFactory = makeReader;
          code.address = publishManaged(
            write.native,
            write.entry.offset,
            reader,
            write.readerContract,
            "tint.managed.receiver-write",
          );
          return;
        }
        const result = managed.value;
        const scope = createGlobalScope<ScriptPropertyKey, unknown>(global),
          name = result.globalName,
          properties = result.properties,
          readStrict = result.strict;
        const reader = (base: unknown, step: number): unknown => {
          if (step !== 0) {
            const key = properties[step - 1];
            if (key === undefined) throw "MANAGED_ACCESS_STEP_INVARIANT";
            const property = getObjectValueProperty(base, key, hooks, realm);
            if (property.error === "unsupported")
              return rejectUnsupportedExecution(realm);
            if (property.error !== "none")
              throw createRuntimeError(realm, property.error);
            return property.value;
          }
          const reference = resolveBinding<ScriptPropertyKey, unknown>(
            scope,
            name,
            readStrict,
          );
          const value = getBindingReference<ScriptPropertyKey, unknown>(
            reference,
          );
          if (value.error !== "none")
            throw createRuntimeError(realm, value.error);
          return value.value;
        };
        code.mode = "managed";
        code.readerFactory = (_receiver: unknown): ManagedReader => reader;
        code.address = publishManaged(
          result.native,
          result.entry.offset,
          reader,
          result.readerContract,
          "tint.managed.global-access",
        );
        return;
      }
      const result = compiled.value;
      if (
        result.parameters.length !== 1 ||
        result.parameters[0] !== "general" ||
        result.returnType !== "general"
      ) {
        ensureGeneral();
        return;
      }
      code.input = result.input;
      code.minimumArguments = result.minimumArguments;
      code.completion = result.completion;
      code.address =
        publishNativeCode(result.native.code, realm) + result.entry.offset;
    };
    const bindReceiver = (receiver: unknown): unknown => {
      if (strict) return receiver;
      const bound = sloppyCallReceiver(receiver, object, hooks, realm);
      if (bound.error !== "none") return rejectUnsupportedExecution(realm);
      return bound.value;
    };
    const executeBody = (
      receiver: unknown,
      args: readonly unknown[],
    ): unknown => {
      ensureCompiled();
      if (code.mode === "managed") {
        const factory = code.readerFactory;
        if (factory === undefined) throw "MANAGED_READER_INVARIANT";
        const reader = factory(receiver);
        ensureDomain();
        return host.invokeManaged(code.address, reader);
      }
      if (args.length < code.minimumArguments)
        return rejectUnsupportedExecution(realm);
      const input = code.input;
      ensureDomain();
      return host.invokeBorrowed(
        code.address,
        input === -1 ? receiver : input < 0 ? undefined : args[input],
      );
    };
    const selectGeneral = (
      args: readonly unknown[],
    ): OrdinaryObject<ScriptPropertyKey, unknown> | undefined => {
      if (!simple) return ensureGeneral();
      ensureCompiled();
      if (
        code.carrier !== undefined ||
        (code.mode === "closed" && args.length < code.minimumArguments)
      )
        return ensureGeneral();
      return undefined;
    };
    const execute: SourceFunctionCall = (
      receiver,
      args,
      callee,
      newTarget,
    ): unknown => {
      const carrier = selectGeneral(args);
      return carrier === undefined
        ? executeBody(bindReceiver(receiver), args)
        : callCarrier(carrier, receiver, args, callee, newTarget);
    };
    const fn =
      kind === "normal"
        ? createSourceFunction(execute, true, realm, hooks, "anonymous", length)
        : kind === "async"
          ? createSourceAsyncDispatchFunction(
              (receiver, args, callee) => {
                const carrier = selectGeneral(args);
                if (carrier === undefined) return undefined;
                const value = viewObjectValue(
                  callCarrier(carrier, receiver, args, callee, undefined),
                  object,
                );
                if (value === undefined)
                  throw "DYNAMIC_ASYNC_CARRIER_INVARIANT";
                return value;
              },
              (receiver, args): unknown =>
                executeBody(bindReceiver(receiver), args),
              realm,
              hooks,
              "anonymous",
              length,
            )
          : kind === "async-generator"
            ? createSourceAsyncGeneratorFunction(
                (
                  receiver: unknown,
                  args: readonly unknown[],
                  callee: unknown,
                ): AsyncGeneratorContinuation<unknown> => {
                  const carrier = selectGeneral(args);
                  if (carrier !== undefined)
                    return takeAsyncGeneratorStart(
                      callCarrier(carrier, receiver, args, callee, undefined),
                      realm,
                    );
                  const boundReceiver = bindReceiver(receiver);
                  return createAsyncReturnContinuation<unknown>(
                    (): AsyncGeneratorBodyCompletion<unknown> => {
                      const value = executeBody(boundReceiver, args);
                      if (code.completion === "async-generator-direct")
                        return { kind: "direct", value };
                      if (code.completion === "async-generator-await-return")
                        return { kind: "await", value };
                      throw "DYNAMIC_ASYNC_GENERATOR_COMPLETION_INVARIANT";
                    },
                  );
                },
                realm,
                hooks,
                "anonymous",
                length,
              )
            : createSourceGeneratorFunction(
                (
                  receiver: unknown,
                  args: readonly unknown[],
                  callee: unknown,
                ): GeneratorContinuation => {
                  const carrier = selectGeneral(args);
                  if (carrier !== undefined)
                    return takeGeneratorStart(
                      callCarrier(carrier, receiver, args, callee, undefined),
                      realm,
                    );
                  const boundReceiver = bindReceiver(receiver);
                  return (
                    resume: GeneratorResumeKind,
                    value: unknown,
                  ): GeneratorOutcome<unknown> => {
                    if (resume === "throw") throw value;
                    if (resume === "return") return { kind: "return", value };
                    return {
                      kind: "return",
                      value: executeBody(boundReceiver, args),
                    };
                  };
                },
                realm,
                hooks,
                "anonymous",
                length,
              );
    if (!setPrototype<ScriptPropertyKey, unknown>(fn, prototype))
      throw "DYNAMIC_FUNCTION_PROTOTYPE_INVARIANT";
    return retainFunctionSource(fn, parsed.value.sourceText);
  };
}

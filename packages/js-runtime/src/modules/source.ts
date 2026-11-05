import { runAsyncContinuation } from "../objects/async-functions.ts";
import { createScriptPromiseHooks } from "../objects/promises.ts";
import type { GeneratorContinuation } from "../objects/generators.ts";
import type { ModuleCapability } from "./loading.ts";
import {
  createMutableBinding,
  createImmutableBinding,
  initializeBinding,
  hasBinding,
  type DeclarativeEnvironment,
} from "../environments/records/index.ts";
import {
  createDeclarativeScope,
  createGlobalScope,
  type EnvironmentScope,
  type GlobalEnvironment,
} from "../environments/global/index.ts";
import {
  rejectUnsupportedExecution,
  type ErrorRealm,
  type ScriptCompletionRecord,
} from "../objects/errors.ts";
import type { ScriptPropertyKey } from "../objects/symbols.ts";
import {
  createSourceTextModule,
  type SourceModuleShape,
  type ModuleRecord,
} from "./records.ts";
export interface SourceModuleDeclarations {
  readonly variables: readonly string[];
  readonly lexical: readonly {
    readonly name: string;
    readonly constant: boolean;
  }[];
  readonly functions: readonly string[];
}
/** Allocate cells now, instantiate hoisted values at link, and run only the
 * body at evaluation. Module imports are connected by the existing linker. */
export function createLoweredSourceModule(
  global: GlobalEnvironment<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hostDefined: unknown,
  shape: SourceModuleShape,
  declarations: SourceModuleDeclarations,
  instantiate: (
    scope: EnvironmentScope<ScriptPropertyKey, unknown>,
    environment: DeclarativeEnvironment<unknown>,
  ) => readonly unknown[],
  execute: (
    scope: EnvironmentScope<ScriptPropertyKey, unknown>,
    environment: DeclarativeEnvironment<unknown>,
  ) => ScriptCompletionRecord,
): ModuleRecord {
  return loweredSourceModule(
    global,
    realm,
    hostDefined,
    shape,
    declarations,
    instantiate,
    execute,
    undefined,
  );
}

export function createLoweredAsyncSourceModule(
  global: GlobalEnvironment<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hostDefined: unknown,
  shape: SourceModuleShape,
  declarations: SourceModuleDeclarations,
  instantiate: (
    scope: EnvironmentScope<ScriptPropertyKey, unknown>,
    environment: DeclarativeEnvironment<unknown>,
  ) => readonly unknown[],
  execute: (
    scope: EnvironmentScope<ScriptPropertyKey, unknown>,
    environment: DeclarativeEnvironment<unknown>,
  ) => GeneratorContinuation,
): ModuleRecord {
  if (!shape.hasTopLevelAwait) throw "MODULE_ASYNC_SHAPE_INVARIANT";
  return loweredSourceModule(
    global,
    realm,
    hostDefined,
    shape,
    declarations,
    instantiate,
    undefined,
    execute,
  );
}

function loweredSourceModule(
  global: GlobalEnvironment<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hostDefined: unknown,
  shape: SourceModuleShape,
  declarations: SourceModuleDeclarations,
  instantiate: (
    scope: EnvironmentScope<ScriptPropertyKey, unknown>,
    environment: DeclarativeEnvironment<unknown>,
  ) => readonly unknown[],
  execute:
    | ((
        scope: EnvironmentScope<ScriptPropertyKey, unknown>,
        environment: DeclarativeEnvironment<unknown>,
      ) => ScriptCompletionRecord)
    | undefined,
  executeAsync:
    | ((
        scope: EnvironmentScope<ScriptPropertyKey, unknown>,
        environment: DeclarativeEnvironment<unknown>,
      ) => GeneratorContinuation)
    | undefined,
): ModuleRecord {
  const state: {
    scope: EnvironmentScope<ScriptPropertyKey, unknown> | undefined;
    module: ModuleRecord | undefined;
  } = { scope: undefined, module: undefined };
  const variables: string[] = [],
    seenVariables = new Set<string>();
  const module = createSourceTextModule(
    realm,
    shape,
    hostDefined,
    (environment): void => {
      state.scope = createDeclarativeScope<ScriptPropertyKey, unknown>(
        createGlobalScope<ScriptPropertyKey, unknown>(global),
        environment,
      );
      for (const name of declarations.variables) {
        if (name === undefined) throw "MODULE_DECLARATION_INVARIANT";
        if (seenVariables.has(name)) continue;
        seenVariables.add(name);
        variables.push(name);
        createMutableBinding<unknown>(environment, name, false);
      }
      for (const name of declarations.functions) {
        if (name === undefined) throw "MODULE_DECLARATION_INVARIANT";
        createMutableBinding<unknown>(environment, name, false);
      }
      for (const declaration of declarations.lexical) {
        if (declaration === undefined) throw "MODULE_DECLARATION_INVARIANT";
        if (declaration.constant)
          createImmutableBinding<unknown>(environment, declaration.name, true);
        else
          createMutableBinding<unknown>(environment, declaration.name, false);
      }
      for (const exported of shape.localExports) {
        if (
          exported === undefined ||
          !hasBinding<unknown>(environment, exported.localName)
        )
          throw "MODULE_SHAPE_INVARIANT";
      }
    },
    (): void => {
      const scope = state.scope,
        current = state.module;
      if (scope === undefined || current === undefined)
        throw "MODULE_DECLARATION_INVARIANT";
      for (const name of variables) {
        if (name === undefined) throw "MODULE_DECLARATION_INVARIANT";
        initializeBinding<unknown>(current.environment, name, undefined);
      }
      const functions = instantiate(scope, current.environment);
      if (functions.length !== declarations.functions.length)
        throw "MODULE_DECLARATION_INVARIANT";
      for (let index = 0; index < functions.length; index++) {
        const name = declarations.functions[index];
        if (name === undefined) throw "MODULE_DECLARATION_INVARIANT";
        initializeBinding<unknown>(current.environment, name, functions[index]);
      }
    },
    (): void => {
      const scope = state.scope,
        current = state.module;
      if (scope === undefined || current === undefined)
        throw "MODULE_DECLARATION_INVARIANT";
      const body = execute;
      if (body === undefined) throw "MODULE_ASYNC_ENTRY_INVARIANT";
      const completion = body(scope, current.environment);
      if (completion.error === "none") return;
      if (completion.error === "throw") throw completion.value;
      if (completion.error === "unsupported") rejectUnsupportedExecution(realm);
      // This authority is embedding-owned, so an identical user-thrown string
      // remains a JavaScript error rather than being mistaken for a host fault.
      const fault: { readonly error: unknown } = {
        error: "MODULE_COMPLETION_INVARIANT",
      };
      current.executionFault = fault;
      throw undefined;
    },
    executeAsync === undefined
      ? undefined
      : (capability: ModuleCapability): void => {
          const scope = state.scope,
            current = state.module,
            body = executeAsync;
          if (
            scope === undefined ||
            current === undefined ||
            body === undefined
          )
            throw "MODULE_DECLARATION_INVARIANT";
          const protocol = createScriptPromiseHooks(
            realm,
            global.hooks,
            (promise, operation): void =>
              realm.promiseRejectionTracker(promise, operation),
          );
          runAsyncContinuation(
            body(scope, current.environment),
            capability.functions,
            realm,
            global.hooks,
            protocol,
            current,
          );
        },
  );
  state.module = module;
  return module;
}

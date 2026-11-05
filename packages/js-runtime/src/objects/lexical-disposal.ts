import { createDisposalStack, type DisposalStack } from "../disposal/index.ts";
import {
  resolveDisposalMethod,
  disposeSyncResources,
  disposeMixedLexicalResources,
  type DisposalCompletion,
} from "./disposal-resources.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
import type { ObjectHooks } from "./operations.ts";
export function createLexicalDisposalStack(): DisposalStack<unknown> {
  return createDisposalStack<unknown>();
}
/** Registration precedes lexical initialization. Getters may still observe TDZ. */
export function registerLexicalDisposable(
  stack: DisposalStack<unknown>,
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  if (value === undefined || value === null) return value;
  const resources = stack.resources,
    method = resolveDisposalMethod(value, false, realm, hooks);
  if (method === undefined) throw createRuntimeError(realm, "type");
  resources.push({ value, method, hint: "sync" });
  return value;
}
export function disposeLexicalResources(
  stack: DisposalStack<unknown>,
  failed: boolean,
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  disposeSyncResources(stack, realm, hooks, failed, value);
}

export function registerAsyncLexicalDisposable(
  stack: DisposalStack<unknown>,
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): unknown {
  const resources = stack.resources;
  if (value === undefined || value === null) {
    resources.push({ value, method: undefined, hint: "async" });
    return value;
  }
  const method = resolveDisposalMethod(value, true, realm, hooks);
  if (method === undefined) throw createRuntimeError(realm, "type");
  resources.push({ value, method, hint: "async" });
  return value;
}
export function disposeAsyncLexicalResources(
  stack: DisposalStack<unknown>,
  failed: boolean,
  value: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): DisposalCompletion {
  return disposeMixedLexicalResources(stack, realm, hooks, failed, value);
}

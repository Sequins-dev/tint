import { installDisposalStackIntrinsics } from "./disposable-stack.ts";
import type { OrdinaryObject, ObjectHooks } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import type { ErrorRealm } from "./errors.ts";
export function installAsyncDisposableStackIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  installDisposalStackIntrinsics(global, realm, hooks, true);
}

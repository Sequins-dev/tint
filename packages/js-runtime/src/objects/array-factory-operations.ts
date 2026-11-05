import type { OrdinaryObject } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
/** Shared construction/property contract for synchronous and async factories. */
export interface ArrayFactoryOperations {
  readonly create: (
    receiver: unknown,
    length: number,
    iterable: boolean,
  ) => OrdinaryObject<ScriptPropertyKey, unknown>;
  readonly define: (
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
    index: number,
    value: unknown,
  ) => void;
  readonly finish: (
    object: OrdinaryObject<ScriptPropertyKey, unknown>,
    length: number,
  ) => unknown;
}

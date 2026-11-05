import type { BindingResult } from "./index.ts";

/** A function's own this cell. Lexical-this functions (arrows) reuse the enclosing
 * cell instead of allocating one. Mutable state is internal, not a JS property. */
export interface ThisBinding<Value> {
  value: Value;
  initialized: boolean;
}

export function createThisBinding<Value>(
  undefinedValue: Value,
): ThisBinding<Value> {
  return { value: undefinedValue, initialized: false };
}

/** Unlike variable initialization, a repeated BindThisValue is a language error.
 * The caller performs construction before binding, and field initialization after. */
export function bindThisValue<Value>(
  binding: ThisBinding<Value>,
  value: Value,
): "none" | "reference" {
  if (binding.initialized) return "reference";
  binding.value = value;
  binding.initialized = true;
  return "none";
}

export function getThisBinding<Value>(
  binding: ThisBinding<Value>,
): BindingResult<Value> {
  return {
    error: binding.initialized ? "none" : "reference",
    value: binding.value,
  };
}

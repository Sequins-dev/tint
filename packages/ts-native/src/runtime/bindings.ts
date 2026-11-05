import { syntaxHash } from "@tint/typescript/syntax";
import {
  createKeyIndex,
  createStringIndex,
} from "@tint/foundation/collections/key-index";
import type { CheckedClosures } from "@tint/typescript/checker";
import type { Span } from "@tint/typescript/syntax";
export interface PreparedBindingIndex {
  readonly functionId: (name: string) => number | undefined;
  readonly parameterType: (fn: number, parameter: number) => number | undefined;
}
/** A snapshot of a checked module's identity-based declaration relationships. */
export function createPreparedBindingIndex(
  checked: CheckedClosures,
): PreparedBindingIndex {
  const bindings = createKeyIndex<Span, number>(syntaxHash),
    functions = createKeyIndex<Span, number>(syntaxHash),
    names = createStringIndex<number>();
  for (const binding of checked.bindings.bindings) {
    if (binding === undefined) throw "runtime binding invariant";
    if (bindings.get(binding.node) === undefined)
      bindings.set(binding.node, binding.id);
  }
  for (const fn of checked.bindings.functions) {
    if (fn === undefined) throw "runtime function invariant";
    if (functions.get(fn.node) === undefined) functions.set(fn.node, fn.id);
  }
  for (const statement of checked.module.statements) {
    if (statement === undefined) throw "runtime statement invariant";
    if (
      statement.kind !== "function" ||
      names.get(statement.name) !== undefined
    )
      continue;
    const fn = functions.get(statement);
    if (fn !== undefined) names.set(statement.name, fn);
  }
  return {
    functionId: (name) => names.get(name),
    parameterType: (fn, parameter) => {
      const node = checked.bodies.get(fn)?.parameters[parameter];
      const binding = node === undefined ? undefined : bindings.get(node);
      return binding === undefined ? undefined : checked.bindingTypes[binding];
    },
  };
}

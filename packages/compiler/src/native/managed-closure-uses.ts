import type { CheckedClosures } from "@tint/typescript/checker";
import { createKeyIndex } from "@tint/foundation/collections/key-index";
import {
  rewriteModule,
  syntaxHash,
  type Span,
  type Statement,
} from "@tint/typescript/syntax";

/** A local declaration without a surface callback contract may only be called
 * within JIT code. Prove that exception from binder references, never names,
 * source positions or the function's physical ABI. Value escapes need a separate
 * exact callback contract, even when they happen to share a machine signature. */
export function managedDirectCallDeclarations(
  checked: CheckedClosures,
  wrapper: number,
):
  | { readonly ok: true; readonly value: readonly number[] }
  | { readonly ok: false; readonly error: string } {
  const functions = checked.bindings.functions;
  if (functions[wrapper]?.id !== wrapper)
    return {
      ok: false,
      error: "managed closure proof: wrapper function is missing",
    };
  // Native object keys share one hash; index nodes by syntax hash so large
  // entries (thousands of calls) do not probe every recorded node per lookup.
  const declarations = createKeyIndex<Span, true>(syntaxHash),
    callees = createKeyIndex<Span, true>(syntaxHash);
  rewriteModule(checked.module, {
    statement: (mapped: Statement, original: Statement) => {
      if (original.kind === "function") declarations.set(original, true);
      return mapped;
    },
    expression: (mapped, original) => {
      if (original.kind === "call" && original.callee.kind === "identifier")
        callees.set(original.callee, true);
      return mapped;
    },
  });
  const local = new Set<number>();
  for (const fn of functions) {
    if (fn === undefined) throw "managed closure function invariant";
    let parent = fn.parent;
    while (parent !== undefined && parent !== wrapper) {
      const enclosing = functions[parent];
      if (enclosing === undefined)
        return {
          ok: false,
          error: "managed closure proof: parent function is missing",
        };
      parent = enclosing.parent;
    }
    if (parent === wrapper && declarations.has(fn.node)) local.add(fn.id);
  }
  const result: number[] = [];
  for (const id of local) {
    const fn = functions[id];
    if (fn === undefined) throw "managed closure candidate invariant";
    const binding = checked.bindings.bindings.find(
      (item) =>
        item !== undefined && item.kind === "function" && item.node === fn.node,
    );
    if (binding === undefined)
      return {
        ok: false,
        error: "managed closure proof: declaration binding is missing",
      };
    let direct = true;
    for (const reference of checked.bindings.references) {
      if (reference === undefined) throw "managed closure reference invariant";
      if (
        reference.binding === binding.id &&
        (reference.access !== "read" || !callees.has(reference.node))
      ) {
        direct = false;
        break;
      }
    }
    if (direct) result.push(id);
  }
  return { ok: true, value: result };
}

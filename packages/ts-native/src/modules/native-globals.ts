import { syntaxHash } from "@tint/typescript/syntax";
import { createKeyIndex } from "@tint/foundation/collections/key-index";
import type { BoundModule } from "@tint/typescript/binding";
import {
  rewriteModule,
  type Module,
  type Expression,
} from "@tint/typescript/syntax";
export interface NativeConstructor {
  readonly global: string;
  readonly factory: string;
}
export type NativeGlobalsResult =
  | { readonly ok: true; readonly value: Module }
  | { readonly ok: false; readonly error: string };
/** Replace resolved global constructors with linked runtime factories. The caller
 * owns the registry; source spelling alone never grants an intrinsic capability. */
export function prepareNativeGlobals(
  module: Module,
  bound: BoundModule,
  constructors: readonly NativeConstructor[],
): NativeGlobalsResult {
  const factories = new Map<string, string>();
  for (const constructor of constructors) {
    if (constructor === undefined) throw "native constructor invariant";
    if (factories.has(constructor.global))
      return { ok: false, error: "duplicate native global constructor" };
    const bindings = bound.bindings.filter(
      (b) => b.name === constructor.factory,
    );
    const binding = bindings[0];
    if (
      bindings.length !== 1 ||
      binding === undefined ||
      binding.scope !== 0 ||
      binding.kind !== "function"
    )
      return {
        ok: false,
        error:
          "native factory requires an unshadowed module function: " +
          constructor.factory,
      };
    factories.set(constructor.global, constructor.factory);
  }
  const globals = createKeyIndex<Expression, string>(syntaxHash);
  for (const reference of bound.references) {
    if (reference === undefined) throw "global reference invariant";
    if (reference.global !== undefined)
      globals.set(reference.node, reference.global);
  }
  return {
    ok: true,
    value: rewriteModule(module, {
      expression: (mapped, original) => {
        if (original.kind !== "new" || mapped.kind !== "new") return mapped;
        let target = original.callee;
        while (target.kind === "group") target = target.expression;
        const global = globals.get(target),
          factory = global === undefined ? undefined : factories.get(global);
        if (factory === undefined) return mapped;
        return {
          kind: "call",
          callee: {
            kind: "identifier",
            name: factory,
            start: mapped.callee.start,
            end: mapped.callee.end,
          },
          arguments: mapped.arguments,
          typeArguments: mapped.typeArguments,
          start: mapped.start,
          end: mapped.end,
        };
      },
    }),
  };
}

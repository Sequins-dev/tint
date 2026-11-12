import { syntaxHash } from "@tint/typescript/syntax";
import {
  createKeyIndex,
  type KeyIndex,
} from "@tint/foundation/collections/key-index";
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
/** Runtime functions implementing `console` output for typed programs. */
export interface NativeConsole {
  readonly log: string;
  readonly error: string;
}
export function prepareNativeGlobals(
  module: Module,
  bound: BoundModule,
  constructors: readonly NativeConstructor[],
  nativeConsole: NativeConsole | undefined = undefined,
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
        if (
          nativeConsole !== undefined &&
          original.kind === "call" &&
          mapped.kind === "call"
        ) {
          const line = consoleLine(mapped, original, globals, nativeConsole);
          if (line !== undefined) return line;
        }
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

/** `console.log(a, b)` (also `info`/`debug`, and `error`/`warn` on standard
 * error) as one runtime call with the arguments' string conversions joined
 * by spaces, which is how console formats primitives. Other arguments fail
 * typed checking (string conversion of objects), leaving general semantics. */
function consoleLine(
  mapped: Expression,
  original: Expression,
  globals: KeyIndex<Expression, string>,
  nativeConsole: NativeConsole,
): Expression | undefined {
  if (mapped.kind !== "call" || original.kind !== "call") return undefined;
  if (mapped.optional === true) return undefined;
  const callee = original.callee;
  if (callee.kind !== "member" || callee.optional === true) return undefined;
  let object = callee.object;
  while (object.kind === "group") object = object.expression;
  if (globals.get(object) !== "console") return undefined;
  const method = callee.property;
  const target =
    method === "log" || method === "info" || method === "debug"
      ? nativeConsole.log
      : method === "error" || method === "warn"
        ? nativeConsole.error
        : undefined;
  if (target === undefined) return undefined;
  const parts: (string | undefined)[] = [""],
    raw: string[] = [""],
    substitutions: Expression[] = [];
  for (let i = 0; i < mapped.arguments.length; i++) {
    const argument = mapped.arguments[i];
    if (argument === undefined || argument.kind === "spread") return undefined;
    if (i > 0) {
      parts[parts.length - 1] = " ";
      raw[raw.length - 1] = " ";
    }
    substitutions.push(argument);
    parts.push("");
    raw.push("");
  }
  const text: Expression =
    substitutions.length === 0
      ? { kind: "string", value: "", start: mapped.start, end: mapped.end }
      : {
          kind: "template-expression",
          parts,
          raw,
          substitutions,
          start: mapped.start,
          end: mapped.end,
        };
  return {
    kind: "call",
    callee: {
      kind: "identifier",
      name: target,
      start: mapped.callee.start,
      end: mapped.callee.end,
    },
    arguments: [text],
    start: mapped.start,
    end: mapped.end,
  };
}

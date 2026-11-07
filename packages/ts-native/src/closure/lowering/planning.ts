import { syntaxHash } from "@tint/typescript/syntax";
import { createKeyIndex } from "@tint/foundation/collections/key-index";
import type { ScalarType } from "@tint/ir/scalar";
import type { CheckedClosures } from "@tint/typescript/checker";
import type { Expression, Span } from "@tint/typescript/syntax";
import {
  planClosures,
  type ClosureLayouts,
  type BindingStorage,
  type TargetDataLayout,
} from "../layout.ts";
export type PlanResult =
  | { readonly ok: true; readonly value: ClosureLayouts }
  | { readonly ok: false; readonly error: string };
/** Simple strict parameters are initialized before body-created closures. A
 * numeric binding with no syntactic writes, including in descendants, needs no
 * shared cell. Defaults, sloppy code and dynamic binding exposure retain cells.
 * This is a binding/dataflow proof, independent of readonly type assertions. */
export function valueParameterCaptures(checked: CheckedClosures): Uint8Array {
  const result = new Uint8Array(checked.bindings.bindings.length),
    writes = new Uint8Array(checked.bindings.bindings.length);
  if (
    checked.module.strict === false ||
    (checked.bindings.directEvalOwners?.length ?? 0) !== 0
  )
    return result;
  for (const reference of checked.bindings.references) {
    if (reference === undefined) throw "capture reference invariant";
    if (reference.global === "arguments" || reference.global === "eval")
      return result;
    if (reference.binding !== undefined && reference.access !== "read")
      writes[reference.binding] = 1;
  }
  // Redeclaration initializers are binding operations, not identifier
  // references. Treat every alias conservatively, even a bare var redeclaration.
  for (const alias of checked.bindings.aliases ?? []) {
    if (alias === undefined) throw "capture alias invariant";
    writes[alias.binding] = 1;
  }
  for (const operation of checked.operations) {
    if (operation === undefined) throw "capture operation invariant";
    if (operation.operation.kind === "write") writes[operation.binding] = 1;
  }
  for (const binding of checked.bindings.bindings) {
    if (binding === undefined) throw "capture binding invariant";
    const owner = binding.owner;
    if (
      binding.kind !== "parameter" ||
      !binding.captured ||
      owner === undefined ||
      writes[binding.id] === 1
    )
      continue;
    const fn = checked.bindings.functions[owner],
      body = checked.bodies.get(owner),
      type = checked.bindingTypes[binding.id];
    if (
      fn === undefined ||
      checked.bindings.scopes[fn.scope]?.strict !== true ||
      body === undefined ||
      (fn.parameterCopies?.length ?? 0) !== 0 ||
      body.parameters.some(
        (parameter) =>
          parameter.kind === "pattern-parameter" ||
          parameter.initializer !== undefined ||
          parameter.rest === true,
      ) ||
      type === undefined ||
      scalarType(checked, type) !== "number"
    )
      continue;
    result[binding.id] = 1;
  }
  return result;
}
/** Declarations proven never reassigned and used exclusively as direct callees need no runtime function cell. */
export function directFunctions(
  checked: CheckedClosures,
): (number | undefined)[] {
  const calls = createKeyIndex<Expression, number>(syntaxHash);
  checked.expressions.forEach((type, node) => {
    if (node.kind === "call") {
      let callee = node.callee;
      while (callee.kind === "group") callee = callee.expression;
      if (callee.kind === "identifier") calls.set(callee, 1);
    }
  });
  const indirect: number[] = [];
  for (const reference of checked.bindings.references) {
    if (reference === undefined) throw "reference graph invariant";
    const binding = reference.binding;
    if (
      binding !== undefined &&
      (reference.access !== "read" || calls.get(reference.node) === undefined)
    )
      indirect[binding] = 1;
  }
  const functions = createKeyIndex<Span, number>(syntaxHash);
  for (const fn of checked.bindings.functions) {
    if (fn === undefined) throw "function graph invariant";
    if (functions.get(fn.node) === undefined) functions.set(fn.node, fn.id);
  }
  const result: (number | undefined)[] = [];
  for (const binding of checked.bindings.bindings) {
    if (binding === undefined) throw "binding graph invariant";
    if (binding.kind !== "function" || indirect[binding.id] === 1) continue;
    const fn = functions.get(binding.node);
    if (fn !== undefined) result[binding.id] = fn;
  }
  return result;
}
export function planScalarClosures(
  checked: CheckedClosures,
  target: TargetDataLayout,
  maxBytes: number,
): PlanResult {
  const direct = directFunctions(checked),
    graph = {
      ...checked.bindings,
      bindings: checked.bindings.bindings.map((b) =>
        direct[b.id] !== undefined ? { ...b, captured: false } : b,
      ),
      functions: checked.bindings.functions.map((f) => ({
        ...f,
        captures: f.captures.filter((c) => direct[c.binding] === undefined),
      })),
    };
  const representations: BindingStorage[] = [];
  for (const binding of graph.bindings) {
    if (binding === undefined) throw "planned binding invariant";
    if (binding.captured) {
      const type = checked.bindingTypes[binding.id],
        encoding = type === undefined ? undefined : scalarType(checked, type),
        bytes =
          encoding === undefined
            ? undefined
            : encoding === "optional-number" || encoding === "optional-boolean"
              ? 16
              : 8;
      if (bytes === undefined)
        return {
          ok: false,
          error: "capture requires a supported scalar representation",
        };
      representations.push({ binding: binding.id, size: bytes, alignment: 8 });
    }
  }
  return planClosures(graph, representations, target, maxBytes);
}

export function scalarType(
  checked: CheckedClosures,
  id: number,
): ScalarType | undefined {
  const t = checked.types[id];
  if (t === undefined) return undefined;
  if (
    t.kind === "number" ||
    t.kind === "boolean" ||
    t.kind === "Uint8Array" ||
    t.kind === "Uint16Array" ||
    t.kind === "Uint32Array" ||
    t.kind === "Float64Array"
  )
    return t.kind;
  if (t.kind === "undefined") return "optional-number";
  if (t.kind === "literal")
    return typeof t.value === "number"
      ? "number"
      : typeof t.value === "boolean"
        ? "boolean"
        : undefined;
  if (t.kind === "union") {
    const members = t.members.map((m) => scalarType(checked, m)),
      first = members[0];
    if (first !== undefined && members.every((m) => m === first)) return first;
    if (
      members.length > 0 &&
      members.every((m) => m === "number" || m === "optional-number")
    )
      return "optional-number";
    if (
      members.length > 0 &&
      t.members.every(
        (m) =>
          checked.types[m]?.kind === "undefined" ||
          scalarType(checked, m) === "boolean" ||
          scalarType(checked, m) === "optional-boolean",
      )
    )
      return "optional-boolean";
  }
  return undefined;
}

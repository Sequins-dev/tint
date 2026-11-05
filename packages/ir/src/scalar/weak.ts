import type { Instruction, ModuleIR, ScalarType } from "./model.ts";
export type WeakOperation = "new" | "key" | "value" | "set-value" | "clear";
export interface WeakBinding {
  readonly function: number;
  readonly operation: WeakOperation;
}
/** Replace only explicitly authorized declarations, after ordinary source
 * checking. Handles use general values, never fictional source record layouts. */
export function bindWeakOperations(
  module: ModuleIR,
  bindings: readonly WeakBinding[],
):
  | { readonly ok: true; readonly value: ModuleIR }
  | { readonly ok: false; readonly error: string } {
  const functions = module.functions.slice(),
    seen = new Set<number>();
  for (const binding of bindings) {
    if (binding === undefined) throw "weak binding invariant";
    const fn = functions[binding.function],
      operation = binding.operation;
    const parameters: readonly ScalarType[] =
      operation === "new"
        ? ["general", "general", "boolean"]
        : operation === "set-value"
          ? ["general", "general"]
          : ["general"];
    const result =
      operation === "new" || operation === "key" || operation === "value";
    if (
      fn === undefined ||
      seen.has(binding.function) ||
      !["new", "key", "value", "set-value", "clear"].includes(operation)
    )
      return { ok: false, error: "invalid or duplicate weak binding" };
    seen.add(binding.function);
    if (
      fn.environment !== undefined ||
      fn.closureEnvironment !== undefined ||
      fn.returnType !== (result ? "general" : "void") ||
      fn.parameters.length !== parameters.length
    )
      return { ok: false, error: "weak binding signature mismatch" };
    const instructions: Instruction[] = [];
    for (let index = 0; index < parameters.length; index++) {
      const slot = fn.parameters[index];
      if (slot === undefined || fn.slots[slot] !== parameters[index])
        return { ok: false, error: "weak binding parameter mismatch" };
      instructions.push({ kind: "load", id: index, slot, start: 0, end: 0 });
    }
    const id = parameters.length;
    switch (operation) {
      case "new":
        instructions.push({
          kind: "weak-slot-new",
          id,
          key: 0,
          value: 1,
          ephemeron: 2,
          start: 0,
          end: 0,
        });
        break;
      case "key":
        instructions.push({
          kind: "weak-slot-key",
          id,
          cell: 0,
          start: 0,
          end: 0,
        });
        break;
      case "value":
        instructions.push({
          kind: "weak-slot-value",
          id,
          cell: 0,
          start: 0,
          end: 0,
        });
        break;
      case "set-value":
        instructions.push({
          kind: "weak-slot-set-value",
          cell: 0,
          value: 1,
          start: 0,
          end: 0,
        });
        break;
      case "clear":
        instructions.push({
          kind: "weak-slot-clear",
          cell: 0,
          start: 0,
          end: 0,
        });
        break;
    }
    const returnValue: number | undefined = result ? id : undefined;
    functions[binding.function] = {
      ...fn,
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions,
          terminator: {
            kind: "return",
            value: returnValue,
            start: 0,
            end: 0,
          },
        },
      ],
    };
  }
  return { ok: true, value: { ...module, functions } };
}

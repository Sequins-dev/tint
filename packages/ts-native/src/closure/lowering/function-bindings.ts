import { typeParameterCount } from "@tint/typescript/syntax";
import type { CheckedClosures } from "@tint/typescript/checker";
import type { Statement } from "@tint/typescript/syntax";
import type { FunctionIR, Span } from "@tint/ir/scalar";
/** Checked source identities, selected by the compiler rather than source names. */
export interface FunctionAddressBinding {
  readonly function: number;
  readonly target: number;
  readonly part: "entry" | "signature";
}
export function validateFunctionAddressBindings(
  checked: CheckedClosures,
  entries: readonly number[],
  bindings: readonly FunctionAddressBinding[],
  imported: ReadonlySet<number>,
  records: ReadonlySet<number>,
): string | undefined {
  const stubs = new Set<number>();
  for (const binding of bindings) {
    if (
      binding === undefined ||
      !Number.isSafeInteger(binding.function) ||
      binding.function < 0 ||
      stubs.has(binding.function)
    )
      return "function address binding has an invalid or duplicate stub";
    stubs.add(binding.function);
  }
  function declaration(id: number): Statement | undefined {
    const fn = checked.bindings.functions[id];
    if (fn === undefined || fn.parent !== undefined) return undefined;
    return checked.module.statements.find(
      (statement) =>
        statement !== undefined &&
        statement.kind === "function" &&
        statement === fn.node,
    );
  }
  for (const binding of bindings) {
    if (binding === undefined) throw "function address binding invariant";
    if (!Number.isSafeInteger(binding.target) || binding.target < 0)
      return "function address binding has an invalid target";
    const stub = declaration(binding.function),
      target = declaration(binding.target);
    if (
      stub === undefined ||
      stub.kind !== "function" ||
      target === undefined ||
      target.kind !== "function"
    )
      return "function address binding requires checked top-level declarations";
    if (
      !entries.includes(binding.function) ||
      !entries.includes(binding.target)
    )
      return "function address binding stub and target must be included";
    if (binding.part !== "entry" && binding.part !== "signature")
      return "function address binding has an invalid address part";
    if (stubs.has(binding.target))
      return "function address binding target cannot be another stub";
    if (
      imported.has(binding.function) ||
      imported.has(binding.target) ||
      records.has(binding.function) ||
      records.has(binding.target)
    )
      return "function address binding overlaps another capability binding";
    if (
      stub.async === true ||
      stub.generator === true ||
      typeParameterCount(stub.typeParameters) > 0 ||
      target.async === true ||
      target.generator === true ||
      typeParameterCount(target.typeParameters) > 0
    )
      return "function address binding requires synchronous nongeneric functions";
    const body = checked.bodies.get(binding.function);
    if (
      body === undefined ||
      stub.parameters.length !== 0 ||
      stub.receiver !== undefined ||
      checked.types[body.result]?.kind !== "number"
    )
      return "function address binding stub requires no parameters or receiver and a number result";
    if (target.receiver !== undefined)
      return "function address binding target must be environment-free";
  }
  return undefined;
}
/** Lowered environment/signature checks remain mandatory before applying this. */
export function bindFunctionAddress(
  fn: FunctionIR,
  target: number,
  part: "entry" | "signature",
  span: Span,
): FunctionIR {
  return {
    ...fn,
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { ...span, kind: "function-address", id: 0, target, part },
        ],
        terminator: { ...span, kind: "return", value: 0 },
      },
    ],
  };
}

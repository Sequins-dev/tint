// Lower bounds (AArch64 instructions per site) for IR operations whose
// operands and result are register resident, given the representations the
// emitter chose. Memory homes (@m) are deliberately not charged: spills and
// reloads count as reducible. The bounds describe what a good lowering of
// the same IR needs, not what V8 emits; refine them as lowerings improve.
// Undefined means "no bound": the operation is excluded from excess ranking.

/** Representations of operands (and "->result") from the range signature. */
function representations(operands: string): {
  inputs: string[];
  result: string | undefined;
} {
  const inputs: string[] = [];
  let result: string | undefined;
  for (const part of operands.split(" ")) {
    if (part === "" || part.startsWith("slot:")) continue;
    const kind = part.replace(/@[rm]$/, "");
    if (kind.startsWith("->")) result = kind.slice(2);
    else inputs.push(kind);
  }
  return { inputs, result };
}
const integerKinds = new Set(["int", "word", "i32", "const"]);

export function lowerBound(
  operation: string,
  operands: string,
): number | undefined {
  const { inputs } = representations(operands);
  const [kind = "", operator = ""] = operation.split(":");
  switch (kind) {
    case "constant":
      // Folded into users (immediates) or one move.
      return 1;
    case "load":
    case "store":
      // A register-allocated slot needs no instruction (or one move).
      return 0;
    case "undefined":
    case "boolean-none":
    case "reference-none":
      return 0;
    case "optional-present":
    case "boolean-present":
    case "optional-value":
    case "boolean-value":
    case "reference-value":
    case "reference-wrap":
      return 0;
    case "optional-wrap":
    case "boolean-wrap":
      return 1;
    case "optional-value-or":
      return 1; // csel
    case "unary":
      return operator === "boolean-number" || operator === "+" ? 0 : 1;
    case "binary": {
      if (["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(operator))
        // Compare; a fused branch carries the condition (else cset).
        return inputs.some((input) => input.startsWith("optional")) ? 2 : 1;
      if (operator === "%")
        // Integers: sdiv + msub; doubles: fdiv, frintz, fmsub.
        return inputs.every((input) => integerKinds.has(input)) ? 2 : 3;
      if (operator === "/") return 1;
      // Arithmetic and bitwise: one instruction (any int<->f64 conversion
      // of a mismatched result counts as reducible).
      return 1;
    }
    case "array-length":
    case "reference-vector-length":
      return 1;
    case "array-read":
      // Bounds compare + branch + load (+ convert to a double result).
      return 4;
    case "array-write":
      return 3;
    case "array-valid":
      return 2;
    case "reference-vector-read":
      return 3;
    case "reference-vector-write":
      return 3;
    case "record-read":
      return 1;
    case "record":
      // Checked record field access: guard + load/store.
      return operator === "read" || operator === "write" ? 2 : undefined;
    case "branch":
      return 1;
    case "jump":
      return 1;
    case "trap":
      return 1;
    case "call":
      // Argument moves and the branch.
      return inputs.length + 1;
    default:
      return undefined;
  }
}

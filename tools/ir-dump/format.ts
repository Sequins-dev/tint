// Text form of scalar IR (MIR) for analysis: one line per instruction,
// `vN = kind field=value ...`, slots as sN, blocks as bN.
import type {
  FunctionIR,
  Instruction,
  ModuleIR,
  Terminator,
} from "@tint/ir/scalar";

function fields(
  node: Instruction | Terminator,
  skip: readonly string[],
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (skip.includes(key) || value === undefined) continue;
    parts.push(
      key +
        "=" +
        (typeof value === "object" ? JSON.stringify(value) : String(value)),
    );
  }
  return parts.join(" ");
}
export function formatFunction(fn: FunctionIR): string {
  const lines: string[] = [];
  lines.push(
    `fn ${fn.id} ${fn.name} (${fn.parameters.map((p) => "s" + p).join(", ")}) -> ${fn.returnType}` +
      (fn.closureEnvironment === undefined
        ? ""
        : ` closure-env=${fn.closureEnvironment}`) +
      (fn.environment === undefined ? "" : " environment"),
  );
  lines.push("  slots " + fn.slots.map((type, i) => `s${i}:${type}`).join(" "));
  if (fn.integerSlots !== undefined && fn.integerSlots.length > 0)
    lines.push(
      "  integer " + fn.integerSlots.map((slot) => `s${slot}`).join(" "),
    );
  for (const block of fn.blocks) {
    lines.push(
      `  b${block.id}:` +
        (block.exception === undefined
          ? ""
          : ` catch->b${block.exception.target} s${block.exception.slot}`),
    );
    for (const op of block.instructions) {
      const id = "id" in op && op.id !== undefined ? `v${op.id} = ` : "";
      lines.push(
        `    ${id}${op.kind} ${fields(op, ["kind", "id", "start", "end"])}`,
      );
    }
    lines.push(
      `    ${block.terminator.kind} ${fields(block.terminator, ["kind", "start", "end"])}`,
    );
  }
  return lines.join("\n");
}
export function formatModule(module: ModuleIR, filter?: string): string {
  return module.functions
    .filter((fn) => filter === undefined || fn.name.includes(filter))
    .map(formatFunction)
    .join("\n\n");
}

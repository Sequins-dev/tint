// Text form of scalar IR (MIR) for analysis: one line per instruction,
// `vN = kind field=value ...`, slots as sN, blocks as bN.
import type {
  FunctionIR,
  Instruction,
  ModuleIR,
  Terminator,
} from "@tint/ir/scalar";

/** Stable output omits function IDs (pruning renumbers functions) and names
 * referenced functions instead, so a function's text changes only when the
 * function does. Used by per-pass dumps and their diffs. */
export interface FormatOptions {
  readonly stable?: {
    readonly module: ModuleIR;
    /** The function's source name, shown in its header. */
    readonly source?: string;
  };
}

/** Instructions whose `target` field is a function identity. */
function referencesFunction(node: Instruction | Terminator): boolean {
  return (
    node.kind === "call" ||
    node.kind === "call-indirect" ||
    node.kind === "function-new" ||
    node.kind === "function-address"
  );
}
function fields(
  node: Instruction | Terminator,
  skip: readonly string[],
  module: ModuleIR | undefined,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (skip.includes(key) || value === undefined) continue;
    if (
      module !== undefined &&
      key === "target" &&
      typeof value === "number" &&
      referencesFunction(node)
    ) {
      parts.push("target=@" + (module.functions[value]?.name ?? "#" + value));
      continue;
    }
    // Multi-line strings are quoted: dumps keep one line per instruction.
    parts.push(
      key +
        "=" +
        (typeof value === "object" ||
        (typeof value === "string" && /[\n\r]/.test(value))
          ? JSON.stringify(value)
          : String(value)),
    );
  }
  return parts.join(" ");
}
export function formatFunction(
  fn: FunctionIR,
  options: FormatOptions = {},
): string {
  const module = options.stable?.module,
    source = options.stable?.source;
  const lines: string[] = [];
  lines.push(
    (module === undefined ? `fn ${fn.id} ${fn.name}` : `fn ${fn.name}`) +
      ` (${fn.parameters.map((p) => "s" + p).join(", ")}) -> ${fn.returnType}` +
      (fn.closureEnvironment === undefined
        ? ""
        : ` closure-env=${fn.closureEnvironment}`) +
      (fn.environment === undefined ? "" : " environment") +
      (source === undefined ? "" : ` ; ${source}`),
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
        `    ${id}${op.kind} ${fields(op, ["kind", "id", "start", "end"], module)}`,
      );
    }
    lines.push(
      `    ${block.terminator.kind} ${fields(block.terminator, ["kind", "start", "end"], module)}`,
    );
  }
  return lines.join("\n");
}
export function formatModule(module: ModuleIR, filter?: string): string {
  return module.functions
    .filter((fn) => filter === undefined || fn.name.includes(filter))
    .map((fn) => formatFunction(fn))
    .join("\n\n");
}
/** Scalar IR size: instructions plus terminators, and blocks. */
export function functionSize(fn: FunctionIR): {
  readonly instructions: number;
  readonly blocks: number;
} {
  let instructions = 0;
  for (const block of fn.blocks) instructions += block.instructions.length + 1;
  return { instructions, blocks: fn.blocks.length };
}

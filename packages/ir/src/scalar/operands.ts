import type { Instruction, Terminator } from "./model.ts";
/** Visit value IDs only, excluding slots, function IDs, record IDs and literals. */
export function visitInstructionOperands(
  op: Instruction,
  visit: (id: number) => void,
): void {
  switch (op.kind) {
    case "function-address":
    case "record-descriptor-address":
    case "constant":
    case "load":
    case "undefined":
    case "general-null":
    case "general-none":
    case "script-argument-count":
    case "script-argument-area":
    case "boolean-none":
    case "string-none":
    case "reference-none":
    case "string-literal":
    case "closure-environment":
      return;
    case "store":
    case "general-kind":
    case "general-record-is":
    case "general-is":
    case "general-record-descriptor":
    case "general-wrap":
    case "general-value":
    case "boolean-wrap":
    case "boolean-value":
    case "boolean-present":
    case "primitive-wrap":
    case "primitive-reference":
    case "string-wrap":
    case "string-value":
    case "string-present":
    case "reference-wrap":
    case "reference-value":
    case "string-reference":
    case "reference-string":
    case "error-message":
    case "error-is":
    case "optional-wrap":
    case "optional-present":
    case "optional-value":
      visit(op.value);
      return;
    case "optional-value-or":
      visit(op.value);
      visit(op.fallback);
      return;
    case "function-environment":
      visit(op.callee);
      return;
    case "unary":
      visit(op.operand);
      return;
    case "binary":
    case "general-equal":
    case "string-concat":
      visit(op.left);
      visit(op.right);
      return;
    case "record-read":
    case "record-has":
      visit(op.object);
      return;
    case "function-new":
      if (op.environment !== undefined) visit(op.environment);
      return;
    case "call-indirect":
      visit(op.callee);
      if (op.receiver !== undefined) visit(op.receiver);
      for (const id of op.arguments) {
        if (id === undefined) throw "operand invariant";
        visit(id);
      }
      for (const id of op.scriptArguments ?? []) {
        if (id === undefined) throw "script argument invariant";
        visit(id);
      }
      return;
    case "script-argument": {
      visit(op.index);
      const frame = op.frame;
      if (frame !== undefined) {
        visit(frame.count);
        visit(frame.registers);
        visit(frame.stack);
      }
      return;
    }
    case "call":
      if (op.receiver !== undefined) visit(op.receiver);
      for (const id of op.arguments) {
        if (id === undefined) throw "operand invariant";
        visit(id);
      }
      return;
    case "host-call":
    case "c-call":
    case "c-memory":
      for (const id of op.arguments) {
        if (id === undefined) throw "operand invariant";
        visit(id);
      }
      return;
    case "record-new":
      for (const id of op.arguments) if (id !== undefined) visit(id);
      const presence = op.presence;
      if (presence !== undefined)
        for (const id of presence) if (id !== undefined) visit(id);
      return;
    case "error-new":
      visit(op.message);
      return;
    case "string-length":
    case "string-two-byte":
    case "string-flat":
      visit(op.string);
      return;
    case "string-flatten-into":
      visit(op.address);
      visit(op.byteLength);
      visit(op.string);
      return;
    case "string-code-unit":
      visit(op.string);
      visit(op.index);
      return;
    case "string-starts-with":
    case "string-index-of":
      visit(op.string);
      visit(op.search);
      visit(op.position);
      return;
    case "string-from-latin1":
    case "bytes-ascii-prefix":
    case "string-from-utf8":
      visit(op.bytes);
      visit(op.begin);
      visit(op.limit);
      return;
    case "string-ascii-prefix":
    case "string-utf8-length":
      visit(op.string);
      visit(op.begin);
      visit(op.limit);
      return;
    case "string-ascii-case":
      visit(op.string);
      return;
    case "string-copy-latin1":
    case "string-write-utf8":
      visit(op.string);
      visit(op.begin);
      visit(op.limit);
      visit(op.bytes);
      visit(op.offset);
      return;
    case "string-slice":
      visit(op.string);
      visit(op.begin);
      visit(op.limit);
      return;
    case "string-allocate":
      visit(op.length);
      visit(op.twoByte);
      return;
    case "string-write":
      visit(op.target);
      visit(op.offset);
      visit(op.source);
      return;
    case "number-string-cached":
      visit(op.value);
      return;
    case "number-string-cache":
      visit(op.value);
      visit(op.string);
      return;
    case "string-index-cached":
      visit(op.string);
      return;
    case "string-index-cache":
      visit(op.string);
      visit(op.value);
      return;
    case "string-split-cached":
      visit(op.string);
      visit(op.separator);
      visit(op.template);
      return;
    case "string-split-cache":
      visit(op.string);
      visit(op.separator);
      visit(op.value);
      return;
    case "string-from-code-units":
      for (const id of op.values) {
        if (id === undefined) throw "operand invariant";
        visit(id);
      }
      return;
    case "weak-slot-new":
      visit(op.key);
      visit(op.value);
      visit(op.ephemeron);
      return;
    case "weak-slot-set-value":
      visit(op.cell);
      visit(op.value);
      return;
    case "weak-slot-key":
    case "weak-slot-value":
    case "weak-slot-clear":
      visit(op.cell);
      return;
    case "reference-vector-new":
    case "array-new":
      visit(op.length);
      return;
    case "reference-vector-is":
    case "reference-vector-length":
      visit(op.vector);
      return;
    case "reference-vector-read":
      visit(op.vector);
      visit(op.index);
      return;
    case "reference-vector-write":
      visit(op.vector);
      visit(op.index);
      visit(op.value);
      return;
    case "reference-vector-copy":
      visit(op.source);
      visit(op.target);
      visit(op.count);
      return;
    case "array-subarray":
      visit(op.array);
      visit(op.begin);
      visit(op.length);
      return;
    case "array-length":
    case "array-buffer":
    case "array-byte-offset":
    case "array-byte-length":
      visit(op.array);
      return;
    case "array-valid":
    case "array-read":
    case "array-element":
      visit(op.array);
      visit(op.index);
      return;
    case "array-copy":
      visit(op.array);
      visit(op.source);
      visit(op.offset);
      return;
    case "array-write":
    case "array-store":
      visit(op.array);
      visit(op.index);
      visit(op.value);
      return;
  }
  throw "unsupported instruction operands";
}
export function visitTerminatorOperands(
  op: Terminator,
  visit: (id: number) => void,
): void {
  switch (op.kind) {
    case "record":
    case "record-cell":
      visit(op.object);
      return;
    case "throw":
      visit(op.value);
      return;
    case "return":
      if (op.value !== undefined) visit(op.value);
      return;
    case "branch":
      visit(op.condition);
      return;
    case "trap":
    case "throw-literal":
    case "jump":
    case "cell":
      return;
  }
  throw "unsupported terminator operands";
}

/** Result identity for the closed instruction union; effect-only operations have none. */
export function instructionResult(
  instruction: Instruction,
): number | undefined {
  if (
    instruction.kind === "store" ||
    instruction.kind === "array-write" ||
    instruction.kind === "array-store" ||
    instruction.kind === "weak-slot-set-value" ||
    instruction.kind === "weak-slot-clear" ||
    instruction.kind === "reference-vector-write" ||
    instruction.kind === "reference-vector-copy" ||
    instruction.kind === "string-write" ||
    instruction.kind === "number-string-cache" ||
    instruction.kind === "string-index-cache" ||
    instruction.kind === "string-split-cache"
  )
    return undefined;
  return instruction.id;
}

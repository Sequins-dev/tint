import type { ImageAddressTarget } from "@tint/abi/relocation";
import { encodeFloat64, writeWord64 } from "@tint/foundation/binary/bytes";
import type { Word64 } from "@tint/foundation/binary/word64";
import {
  instructionResult,
  scalarByteLength,
  verify,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
  type ScalarType,
  type Span,
  type Terminator,
} from "@tint/ir/scalar";
import {
  encodeLayout,
  type Instruction as MachineInstruction,
  type Memory,
} from "../isa.ts";
import {
  gpr,
  imm,
  imageRelocations,
  label,
  mem,
  normal,
  resultBytes,
  resultPayload,
  thrown,
  setBoolean,
  word,
  xmm,
  type Emit,
  type ImageRelocations,
} from "./machine.ts";
import { createNumberEmission } from "./numbers.ts";

export { imageRelocations } from "./machine.ts";
export { appendExitEntry } from "./exit-entry.ts";

export interface X64Function {
  readonly id: number;
  readonly name: string;
  readonly offset: number;
}
export interface X64Module extends ImageRelocations {
  readonly code: Uint8Array;
  readonly data: Uint8Array;
  readonly functions: readonly X64Function[];
}
export interface X64Diagnostic {
  readonly code: "INVALID_IR" | "UNSUPPORTED" | "FRAME_LIMIT" | "ENCODING";
  readonly message: string;
  readonly function: number | undefined;
  readonly block: number | undefined;
  readonly span: Span | undefined;
}
export type X64Emission =
  | { readonly ok: true; readonly value: X64Module }
  | { readonly ok: false; readonly error: X64Diagnostic };

interface Argument {
  readonly slot: number;
  readonly type: ScalarType;
  readonly kind: "integer" | "float" | "stack";
  readonly index: number;
}

const rax = gpr(0);
const eax = word(0);
const rsp = gpr(4);
const rbp = gpr(5);
const context = gpr(7);
const environment = gpr(6);
const receiver = gpr(2);
const result = gpr(1);
const scratch = gpr(11);
const trapLabel = "trap";

function align16(bytes: number): number {
  return Math.ceil(bytes / 16) * 16;
}
function frame(offset: number): Memory<64> {
  return mem(5, offset);
}
function functionLabel(id: number): string {
  return "function:" + String(id);
}
function blockLabel(id: number, block: number): string {
  return functionLabel(id) + ":block:" + String(block);
}
function argumentLayout(fn: FunctionIR): Argument[] {
  const args: Argument[] = [];
  let general = 8,
    float = 0,
    stack = 0;
  for (const slot of fn.parameters) {
    if (slot === undefined) throw "parameter slot invariant";
    const type = fn.slots[slot];
    if (type === undefined) throw "parameter type invariant";
    if (type === "number" && float < 8)
      args.push({ slot, type, kind: "float", index: float++ });
    else if (type !== "number" && general < 10)
      args.push({ slot, type, kind: "integer", index: general++ });
    else {
      args.push({ slot, type, kind: "stack", index: stack });
      stack += 8;
    }
  }
  return args;
}
function copy(emit: Emit, from: Memory<64>, to: Memory<64>): void {
  emit({ op: "mov", dst: rax, src: from });
  emit({ op: "mov", dst: to, src: rax });
}

export function emitModule(module: ModuleIR): X64Emission {
  const verified = verify(module);
  if (!verified.ok)
    return {
      ok: false,
      error: {
        code: "INVALID_IR",
        message: verified.error.message,
        function: verified.error.function,
        block: verified.error.block,
        span: undefined,
      },
    };

  let functionId: number | undefined;
  let blockId: number | undefined;
  let span: Span | undefined;
  let failure: X64Diagnostic | undefined;
  function fail(code: X64Diagnostic["code"], message: string): never {
    failure = {
      code,
      message: "x86-64 scalar: " + message,
      function: functionId,
      block: blockId,
      span,
    };
    throw message;
  }

  const machine: MachineInstruction[] = [];
  const emit: Emit = (insn) => {
    machine.push(insn);
  };
  const numbers = createNumberEmission(emit);
  const constants: Word64[] = [];
  const external = new Map<string, ImageAddressTarget>();
  const argumentsByFunction: Argument[][] = [];

  function constant(value: number): Memory<64> {
    const bits = encodeFloat64(value);
    const key = "constant:" + String(bits.hi) + ":" + String(bits.lo);
    if (!external.has(key)) {
      external.set(key, { kind: "data", offset: constants.length * 8 });
      constants.push(bits);
    }
    return {
      kind: "mem",
      width: 64,
      address: { kind: "rip", disp: label(key) },
    };
  }

  function body(fn: FunctionIR): void {
    const fnLabel = functionLabel(fn.id);
    const done = fnLabel + ":return";
    const slots: number[] = [];
    const homes = new Map<number, number>();
    const types = new Map<number, ScalarType>();
    const savedContext = -8,
      savedResult = -16;
    const callResult = savedResult - resultBytes;
    let depth = -callResult;
    let outgoing = 0;
    for (const type of fn.slots) {
      if (type === undefined) throw "slot layout invariant";
      depth += scalarByteLength(type);
      slots.push(-depth);
    }
    for (const block of fn.blocks) {
      if (block === undefined) throw "block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "instruction invariant";
        const id = instructionResult(op);
        if (id !== undefined) {
          // Every home can hold a complete two-word scalar. Compact layout
          // and reuse across liveness ranges are later optimizations.
          depth += 16;
          homes.set(id, -depth);
        }
        if (op.kind === "call") {
          const args = argumentsByFunction[op.target];
          if (args === undefined) throw "call layout invariant";
          for (const arg of args)
            if (arg?.kind === "stack")
              outgoing = Math.max(outgoing, arg.index + 8);
        }
      }
    }
    const frameBytes = align16(depth + outgoing);
    if (frameBytes >= 0x80000000)
      fail("FRAME_LIMIT", "frame exceeds signed displacement");
    function slot(id: number): number {
      const offset = slots[id];
      if (offset === undefined) throw "slot invariant";
      return offset;
    }
    function home(id: number): number {
      const offset = homes.get(id);
      if (offset === undefined) throw "value home invariant";
      return offset;
    }
    function typeOf(id: number): ScalarType {
      const type = types.get(id);
      if (type === undefined) throw "value type invariant";
      return type;
    }
    function copyFrame(from: number, to: number, bytes: number): void {
      for (let offset = 0; offset < bytes; offset += 8)
        copy(emit, frame(from + offset), frame(to + offset));
    }
    function define(id: number, type: ScalarType): void {
      types.set(id, type);
      emit({ op: "mov", dst: frame(home(id)), src: rax });
    }
    function publish(state: number, from: number, bytes: number): void {
      emit({ op: "mov", dst: scratch, src: frame(savedResult) });
      for (let offset = 0; offset < bytes; offset += 8)
        copy(emit, frame(from + offset), mem(11, resultPayload + offset));
      emit({ op: "mov", dst: mem(11, 0), src: imm(state) });
      emit({ op: "mov", dst: eax, src: imm(state) });
      emit({ op: "jmp", target: label(done) });
    }
    function raise(block: Block, from: number): void {
      const handler = block.exception;
      if (handler === undefined) publish(thrown, from, 16);
      else {
        copyFrame(from, slot(handler.slot), 16);
        emit({ op: "jmp", target: label(blockLabel(fn.id, handler.target)) });
      }
    }

    function call(op: Instruction, block: Block): void {
      if (op.kind !== "call") throw "call invariant";
      const args = argumentsByFunction[op.target];
      const callee = module.functions[op.target];
      if (args === undefined || callee === undefined) throw "callee invariant";
      if (callee.import === true || op.environment === "inherit")
        fail(
          "UNSUPPORTED",
          "unsupported instruction call (" +
            (callee.import === true
              ? "managed import"
              : "inherited environment") +
            ")",
        );
      for (let i = 0; i < args.length; i++) {
        const arg = args[i],
          id = op.arguments[i];
        if (arg === undefined || id === undefined) throw "argument invariant";
        const source = frame(home(id));
        if (arg.kind === "float")
          emit({ op: "movsd", dst: xmm(arg.index), src: source });
        else {
          const dst = arg.kind === "integer" ? gpr(arg.index) : rax;
          if (scalarByteLength(arg.type) === 16)
            emit({ op: "lea", dst, src: source });
          else emit({ op: "mov", dst, src: source });
          if (arg.kind === "stack")
            emit({ op: "mov", dst: mem(4, arg.index), src: rax });
        }
      }
      emit({ op: "mov", dst: context, src: frame(savedContext) });
      emit({ op: "xor", dst: environment, src: environment });
      if (op.receiver === undefined)
        emit({ op: "xor", dst: receiver, src: receiver });
      else emit({ op: "lea", dst: receiver, src: frame(home(op.receiver)) });
      emit({ op: "lea", dst: result, src: frame(callResult) });
      emit({ op: "mov", dst: frame(callResult), src: imm(0) });
      emit({ op: "mov", dst: frame(callResult + 8), src: imm(0) });
      emit({ op: "call", target: label(functionLabel(op.target)) });
      const received = fnLabel + ":call:" + String(machine.length);
      emit({ op: "cmp", dst: eax, src: imm(normal) });
      emit({ op: "jcc", cc: "e", target: label(received) });
      emit({ op: "cmp", dst: eax, src: imm(thrown) });
      emit({ op: "jcc", cc: "ne", target: label(trapLabel) });
      raise(block, callResult + resultPayload);
      emit({ op: "label", name: received });
      const returnType = callee.returnType;
      const id = op.id;
      if (id !== undefined && returnType !== "void") {
        copyFrame(
          callResult + resultPayload,
          home(id),
          scalarByteLength(returnType),
        );
        types.set(id, returnType);
      }
    }

    function instruction(op: Instruction, block: Block): void {
      switch (op.kind) {
        case "constant": {
          const value = op.value;
          if (typeof value === "boolean") {
            emit({ op: "mov", dst: eax, src: imm(value ? 1 : 0) });
            define(op.id, "boolean");
          } else {
            emit({ op: "mov", dst: rax, src: constant(value) });
            define(op.id, "number");
          }
          return;
        }
        case "load": {
          const type = fn.slots[op.slot];
          if (type === undefined) throw "load slot invariant";
          copyFrame(slot(op.slot), home(op.id), scalarByteLength(type));
          types.set(op.id, type);
          return;
        }
        case "store":
          copyFrame(
            home(op.value),
            slot(op.slot),
            scalarByteLength(typeOf(op.value)),
          );
          return;
        case "call":
          call(op, block);
          return;
        case "general-none":
        case "general-null":
          emit({ op: "mov", dst: frame(home(op.id) + 8), src: imm(0) });
          emit({
            op: "mov",
            dst: eax,
            src: imm(op.kind === "general-null" ? 4 : 0),
          });
          define(op.id, "general");
          return;
        case "general-wrap": {
          const type = typeOf(op.value);
          if (type !== "number" && type !== "boolean") break;
          copy(emit, frame(home(op.value)), frame(home(op.id) + 8));
          emit({ op: "mov", dst: eax, src: imm(type === "number" ? 1 : 2) });
          define(op.id, "general");
          return;
        }
        case "general-value":
          if (op.type !== "number" && op.type !== "boolean") break;
          emit({
            op: "cmp",
            dst: frame(home(op.value)),
            src: imm(op.type === "number" ? 1 : 2),
          });
          emit({ op: "jcc", cc: "ne", target: label(trapLabel) });
          emit({ op: "mov", dst: rax, src: frame(home(op.value) + 8) });
          define(op.id, op.type);
          return;
        case "unary": {
          const type = typeOf(op.operand);
          const src = frame(home(op.operand));
          const truth = op.operator === "!" || op.operator === "truthy";
          const predicate = truth || op.operator === "is-integer";
          if (type === "boolean" && predicate) {
            if (op.operator === "is-integer")
              emit({ op: "xor", dst: eax, src: eax });
            else {
              emit({ op: "cmp", dst: src, src: imm(0) });
              setBoolean(emit, op.operator === "!" ? "e" : "ne", 0);
            }
          } else if (
            (type === "number" || op.operator === "boolean-number") &&
            numbers.unary(op.operator, src)
          ) {
            // The numeric selector leaves either the boolean or binary64 bits in RAX.
          } else
            fail(
              "UNSUPPORTED",
              "unsupported instruction unary " +
                op.operator +
                " (" +
                type +
                ")",
            );
          define(op.id, predicate ? "boolean" : "number");
          return;
        }
        case "binary": {
          const type = typeOf(op.left);
          const left = frame(home(op.left)),
            right = frame(home(op.right));
          const equal = op.operator === "===" || op.operator === "==";
          const unequal = op.operator === "!==" || op.operator === "!=";
          if (type === "boolean" && (equal || unequal)) {
            emit({ op: "mov", dst: rax, src: left });
            emit({ op: "cmp", dst: rax, src: right });
            setBoolean(emit, equal ? "e" : "ne", 0);
          } else if (
            type !== "number" ||
            !numbers.binary(op.operator, left, right)
          ) {
            fail(
              "UNSUPPORTED",
              "unsupported instruction binary " +
                op.operator +
                " (" +
                type +
                ")",
            );
          }
          const predicate =
            equal || unequal || ["<", "<=", ">", ">="].includes(op.operator);
          define(op.id, predicate ? "boolean" : "number");
          return;
        }
      }
      fail("UNSUPPORTED", "unsupported instruction " + op.kind);
    }

    function terminate(op: Terminator, block: Block): void {
      switch (op.kind) {
        case "return": {
          const id = op.value;
          if (id === undefined) publish(normal, 0, 0);
          else publish(normal, home(id), scalarByteLength(typeOf(id)));
          return;
        }
        case "throw":
          raise(block, home(op.value));
          return;
        case "trap":
          emit({ op: "jmp", target: label(trapLabel) });
          return;
        case "jump":
          emit({ op: "jmp", target: label(blockLabel(fn.id, op.target)) });
          return;
        case "branch":
          emit({ op: "cmp", dst: frame(home(op.condition)), src: imm(0) });
          emit({
            op: "jcc",
            cc: "ne",
            target: label(blockLabel(fn.id, op.consequent)),
          });
          emit({ op: "jmp", target: label(blockLabel(fn.id, op.alternate)) });
          return;
      }
      fail("UNSUPPORTED", "unsupported terminator " + op.kind);
    }

    emit({ op: "label", name: fnLabel });
    emit({ op: "push", src: rbp });
    emit({ op: "mov", dst: rbp, src: rsp });
    emit({ op: "sub", dst: rsp, src: imm(frameBytes) });
    emit({ op: "mov", dst: frame(savedResult), src: result });
    emit({ op: "mov", dst: frame(savedContext), src: context });
    const receiverSlot = fn.receiverSlot;
    if (receiverSlot !== undefined) {
      const offset = slot(receiverSlot),
        absent = fnLabel + ":receiver-absent";
      emit({ op: "mov", dst: frame(offset), src: imm(0) });
      emit({ op: "mov", dst: frame(offset + 8), src: imm(0) });
      emit({ op: "test", dst: receiver, src: receiver });
      emit({ op: "jcc", cc: "e", target: label(absent) });
      copy(emit, mem(2, 0), frame(offset));
      copy(emit, mem(2, 8), frame(offset + 8));
      emit({ op: "label", name: absent });
    }
    const args = argumentsByFunction[fn.id];
    if (args === undefined) throw "parameter layout invariant";
    for (const arg of args) {
      if (arg === undefined) throw "parameter invariant";
      const offset = slot(arg.slot);
      if (arg.kind === "float")
        emit({ op: "movsd", dst: frame(offset), src: xmm(arg.index) });
      else {
        const source =
          arg.kind === "integer" ? gpr(arg.index) : frame(16 + arg.index);
        if (scalarByteLength(arg.type) === 16) {
          emit({ op: "mov", dst: scratch, src: source });
          copy(emit, mem(11, 0), frame(offset));
          copy(emit, mem(11, 8), frame(offset + 8));
        } else {
          emit({ op: "mov", dst: rax, src: source });
          emit({ op: "mov", dst: frame(offset), src: rax });
        }
      }
    }
    if (fn.entry !== 0)
      emit({ op: "jmp", target: label(blockLabel(fn.id, fn.entry)) });
    for (const block of fn.blocks) {
      if (block === undefined) throw "block invariant";
      blockId = block.id;
      emit({ op: "label", name: blockLabel(fn.id, block.id) });
      for (const op of block.instructions) {
        if (op === undefined) throw "instruction invariant";
        span = { start: op.start, end: op.end };
        instruction(op, block);
      }
      const op = block.terminator;
      span = { start: op.start, end: op.end };
      terminate(op, block);
    }
    emit({ op: "label", name: done });
    emit({ op: "mov", dst: rsp, src: rbp });
    emit({ op: "pop", dst: rbp });
    emit({ op: "ret" });
  }

  try {
    for (const fn of module.functions) {
      if (fn === undefined) throw "function invariant";
      argumentsByFunction.push(argumentLayout(fn));
    }
    for (const fn of module.functions) {
      if (fn === undefined) throw "function invariant";
      functionId = fn.id;
      blockId = undefined;
      span = undefined;
      if (fn.environment !== undefined || fn.closureEnvironment !== undefined)
        fail("UNSUPPORTED", "unsupported function environment");
      if (fn.import !== true) body(fn);
    }
    // A declaration by itself also needs a linker binding.
    for (const fn of module.functions) {
      if (fn?.import !== true) continue;
      functionId = fn.id;
      blockId = undefined;
      span = undefined;
      fail("UNSUPPORTED", "unsupported managed import " + fn.name);
    }
    functionId = undefined;
    blockId = undefined;
    span = undefined;
    numbers.helpers();
    emit({ op: "label", name: trapLabel });
    emit({ op: "ud2" });
    const encoded = encodeLayout(machine, (name) => external.has(name));
    const functions: X64Function[] = [];
    for (const fn of module.functions) {
      if (fn === undefined) throw "function invariant";
      const offset = encoded.labels.get(functionLabel(fn.id));
      if (offset === undefined) throw "function label invariant";
      functions.push({ id: fn.id, name: fn.name, offset });
    }
    const data = new Uint8Array(constants.length * 8);
    for (let i = 0; i < constants.length; i++) {
      const bits = constants[i];
      if (bits === undefined || !writeWord64(data, i * 8, bits, "little").ok)
        throw "binary64 data invariant";
    }
    const relocations = imageRelocations(encoded.externalFixups, external);
    return {
      ok: true,
      value: {
        code: encoded.bytes,
        data,
        functions,
        addressFixups: relocations.addressFixups,
        patchAddress: relocations.patchAddress,
      },
    };
  } catch (caught) {
    return {
      ok: false,
      error: failure ?? {
        code: "ENCODING",
        message:
          typeof caught === "string"
            ? caught
            : "x86-64 scalar: encoding failed",
        function: functionId,
        block: blockId,
        span,
      },
    };
  }
}

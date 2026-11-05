import type {
  Block,
  FunctionIR,
  Instruction,
  ScalarType,
  Terminator,
  ReturnType,
  Span,
} from "./model.ts";
/** Construction primitive shared by generated functions. Values are
 * block-local; callers carry cross-block state through typed slots. */
export interface FunctionBuilder {
  readonly slot: (type: ScalarType) => number;
  readonly block: () => number;
  readonly at: (block: number) => void;
  readonly next: () => number;
  readonly emit: (instruction: Instruction) => void;
  readonly load: (slot: number) => number;
  readonly save: (slot: number, value: number) => void;
  readonly end: (terminator: Terminator) => void;
  readonly finish: () => FunctionIR;
}
export function createFunctionBuilder(
  id: number,
  name: string,
  parameters: readonly ScalarType[],
  returnType: ReturnType,
  span: Span = { start: 0, end: 0 },
): FunctionBuilder {
  const slots: ScalarType[] = parameters.slice(),
    blocks: (Block | undefined)[] = [undefined];
  let current = 0,
    values = 0,
    instructions: Instruction[] = [];
  function emit(op: Instruction): void {
    if (current < 0) throw "generated block is closed";
    instructions.push(op);
  }
  function next(): number {
    return values++;
  }
  function load(slot: number): number {
    const id = next();
    emit({ kind: "load", id, slot, start: span.start, end: span.end });
    return id;
  }
  function save(slot: number, value: number): void {
    emit({ kind: "store", slot, value, start: span.start, end: span.end });
  }
  return {
    slot: (type) => {
      const id = slots.length;
      slots.push(type);
      return id;
    },
    block: () => {
      const id = blocks.length;
      blocks.push(undefined);
      return id;
    },
    at: (block) => {
      if (
        current >= 0 ||
        block < 0 ||
        block >= blocks.length ||
        blocks[block] !== undefined
      )
        throw "generated block invariant";
      current = block;
      instructions = [];
    },
    next,
    emit,
    load,
    save,
    end: (terminator) => {
      if (current < 0) throw "generated block is closed";
      blocks[current] = { id: current, instructions, terminator };
      current = -1;
    },
    finish: () => {
      if (current >= 0) throw "generated block is open";
      const complete: Block[] = [];
      for (const block of blocks) {
        if (block === undefined) throw "generated block is missing";
        complete.push(block);
      }
      return {
        id,
        name,
        parameters: parameters.map((_, i) => i),
        slots,
        returnType,
        entry: 0,
        exported: false,
        blocks: complete,
      };
    },
  };
}

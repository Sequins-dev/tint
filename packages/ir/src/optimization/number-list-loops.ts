import {
  blockSuccessors,
  indirectCallClass,
  indirectCallTargets,
  instructionResult,
  naturalLoops,
  recordReadsKept,
  renumberInstructionResult,
  retainDebugValues,
  stableRecordLayouts,
  substituteInstructionValues,
  substituteTerminatorValues,
  visitInstructionOperands,
  visitTerminatorOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
  type NaturalLoop,
  type ScalarType,
  type Terminator,
} from "../scalar/index.ts";

export interface NumberListLoopHoisting {
  readonly module: ModuleIR;
  readonly visited: number;
  readonly rewritten: number;
}

const maxHoistedLoopInstructions = 2000;

interface NumberListHelpers {
  readonly header: number;
  readonly lengthFns: ReadonlySet<number>;
  readonly readFns: ReadonlySet<number>;
  readonly hasFns: ReadonlySet<number>;
  readonly popFns: ReadonlySet<number>;
  readonly pushFns: ReadonlySet<number>;
}

/** Records with the exact NumberList layout: `{ length: number, values: Float64Array | undefined, present: Uint8Array | undefined }`. */
function candidateHeaders(module: ModuleIR): Set<number> {
  const result = new Set<number>();
  const records = module.records ?? [];
  for (let id = 0; id < records.length; id++) {
    const record = records[id];
    if (record === undefined || record.fields.length !== 3) continue;
    const f0 = record.fields[0],
      f1 = record.fields[1],
      f2 = record.fields[2];
    if (
      f0 !== undefined &&
      f1 !== undefined &&
      f2 !== undefined &&
      f0.mutable &&
      f1.mutable &&
      f2.mutable &&
      f0.type === "number" &&
      f1.type === "optional-reference" &&
      f2.type === "optional-reference"
    )
      result.add(id);
  }
  return result;
}

function isEmptyTrap(block: Block | undefined): boolean {
  return (
    block !== undefined &&
    block.instructions.length === 0 &&
    block.terminator.kind === "trap"
  );
}

/** Symbolically verifies that `fn(list)` reads field 0 of candidate header `H`
 * and returns it with no other side effects. */
function matchLengthHelper(
  fn: FunctionIR,
  headers: ReadonlySet<number>,
): number | undefined {
  if (
    fn.import === true ||
    fn.parameters.length !== 1 ||
    fn.returnType !== "number" ||
    fn.blocks.length > 8
  )
    return undefined;
  const param = fn.parameters[0];
  if (param === undefined || fn.slots[param] !== "reference") return undefined;
  const slotState = new Map<number, string>();
  slotState.set(param, "list");
  let blockId = fn.entry,
    header: number | undefined;
  for (let steps = 0; steps < 16; steps++) {
    const block = fn.blocks[blockId];
    if (block === undefined || block.exception !== undefined) return undefined;
    const values = new Map<number, string>();
    for (const op of block.instructions) {
      if (op === undefined) return undefined;
      if (op.kind === "load") {
        const s = slotState.get(op.slot);
        if (s !== undefined) values.set(op.id, s);
      } else if (op.kind === "store") {
        const v = values.get(op.value);
        if (v === undefined) slotState.delete(op.slot);
        else slotState.set(op.slot, v);
      } else return undefined;
    }
    const term = block.terminator;
    if (term.kind === "jump") {
      blockId = term.target;
      continue;
    }
    if (
      term.kind === "record" &&
      term.operation === "read" &&
      term.field === 0 &&
      headers.has(term.record) &&
      values.get(term.object) === "list" &&
      isEmptyTrap(fn.blocks[term.alternate])
    ) {
      if (header !== undefined && header !== term.record) return undefined;
      header = term.record;
      slotState.set(term.slot, "length");
      blockId = term.consequent;
      continue;
    }
    if (term.kind === "return" && term.value !== undefined)
      return header !== undefined && values.get(term.value) === "length"
        ? header
        : undefined;
    return undefined;
  }
  return undefined;
}

/** Symbolically verifies that `fn(list, index)` has no side effects and on the
 * dense path (`present === none`, `values !== none`, `index < length`) returns
 * `array-read(reference-value(values, Float64Array), index)`. */
function matchReadHelper(
  fn: FunctionIR,
  headers: ReadonlySet<number>,
): number | undefined {
  if (
    fn.import === true ||
    fn.parameters.length !== 2 ||
    fn.returnType !== "optional-number" ||
    fn.blocks.length > 24
  )
    return undefined;
  const pList = fn.parameters[0],
    pIndex = fn.parameters[1];
  if (
    pList === undefined ||
    pIndex === undefined ||
    fn.slots[pList] !== "reference" ||
    fn.slots[pIndex] !== "number"
  )
    return undefined;
  for (const block of fn.blocks) {
    if (block === undefined || block.exception !== undefined) return undefined;
    for (const op of block.instructions) {
      if (op === undefined) return undefined;
      if (
        op.kind === "call" ||
        op.kind === "call-indirect" ||
        op.kind === "host-call" ||
        op.kind === "array-write" ||
        op.kind === "array-store" ||
        op.kind === "array-fill"
      )
        return undefined;
    }
    const t = block.terminator;
    if (
      t.kind === "throw" ||
      t.kind === "throw-literal" ||
      ((t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
        t.operation !== "read")
    )
      return undefined;
  }
  const slotState = new Map<number, string>();
  slotState.set(pList, "list");
  slotState.set(pIndex, "index");
  let blockId = fn.entry,
    header: number | undefined;
  for (let steps = 0; steps < 32; steps++) {
    const block = fn.blocks[blockId];
    if (block === undefined) return undefined;
    const values = new Map<number, string>();
    for (const op of block.instructions) {
      if (op === undefined) return undefined;
      if (op.kind === "load") {
        const s = slotState.get(op.slot);
        if (s !== undefined) values.set(op.id, s);
      } else if (op.kind === "store") {
        const v = values.get(op.value);
        if (v === undefined) slotState.delete(op.slot);
        else slotState.set(op.slot, v);
      } else if (op.kind === "reference-none") {
        values.set(op.id, "ref-none");
      } else if (op.kind === "undefined") {
        values.set(op.id, "undef");
      } else if (op.kind === "record-read") {
        if (values.get(op.object) !== "list" || !headers.has(op.record))
          return undefined;
        if (header !== undefined && header !== op.record) return undefined;
        header = op.record;
        if (op.field === 0) values.set(op.id, "length");
        else if (op.field === 1) values.set(op.id, "values");
        else if (op.field === 2) values.set(op.id, "present-none");
      } else if (op.kind === "reference-value") {
        if (values.get(op.value) === "values" && op.type === "Float64Array")
          values.set(op.id, "f64-values");
      } else if (op.kind === "array-read") {
        if (
          values.get(op.array) === "f64-values" &&
          values.get(op.index) === "index"
        )
          values.set(op.id, "result");
      } else if (op.kind === "binary") {
        const l = values.get(op.left),
          r = values.get(op.right);
        if (op.operator === "===" || op.operator === "!==") {
          const isEq = op.operator === "===";
          if (
            (l === "present-none" && r === "ref-none") ||
            (r === "present-none" && l === "ref-none")
          )
            values.set(op.id, isEq ? "true" : "false");
          else if (
            (l === "values" && r === "ref-none") ||
            (r === "values" && l === "ref-none")
          )
            values.set(op.id, isEq ? "false" : "true");
        } else if (op.operator === "<" && l === "index" && r === "length") {
          values.set(op.id, "true");
        } else if (op.operator === ">" && l === "length" && r === "index") {
          values.set(op.id, "true");
        }
      }
    }
    const term = block.terminator;
    if (term.kind === "jump") {
      blockId = term.target;
      continue;
    }
    if (
      term.kind === "record" &&
      term.operation === "read" &&
      headers.has(term.record) &&
      values.get(term.object) === "list" &&
      isEmptyTrap(fn.blocks[term.alternate])
    ) {
      if (header !== undefined && header !== term.record) return undefined;
      header = term.record;
      if (term.field === 0) slotState.set(term.slot, "length");
      else if (term.field === 1) slotState.set(term.slot, "values");
      else if (term.field === 2) slotState.set(term.slot, "present-none");
      else return undefined;
      blockId = term.consequent;
      continue;
    }
    if (term.kind === "branch") {
      const cond = values.get(term.condition);
      if (cond === "true") {
        blockId = term.consequent;
        continue;
      }
      if (cond === "false") {
        blockId = term.alternate;
        continue;
      }
      return undefined;
    }
    if (term.kind === "return" && term.value !== undefined)
      return header !== undefined && values.get(term.value) === "result"
        ? header
        : undefined;
    return undefined;
  }
  return undefined;
}

/** Symbolically verifies that `fn(list, index)` has no side effects and on the
 * dense in-range path (`present === none`, `index` is a non-negative integer
 * below `length`) returns `true`. */
function matchHasHelper(
  fn: FunctionIR,
  headers: ReadonlySet<number>,
): number | undefined {
  if (
    fn.import === true ||
    fn.parameters.length !== 2 ||
    fn.returnType !== "boolean" ||
    fn.blocks.length > 24
  )
    return undefined;
  const pList = fn.parameters[0],
    pIndex = fn.parameters[1];
  if (
    pList === undefined ||
    pIndex === undefined ||
    fn.slots[pList] !== "reference" ||
    fn.slots[pIndex] !== "number"
  )
    return undefined;
  for (const block of fn.blocks) {
    if (block === undefined || block.exception !== undefined) return undefined;
    for (const op of block.instructions) {
      if (op === undefined) return undefined;
      if (
        op.kind === "call" ||
        op.kind === "call-indirect" ||
        op.kind === "host-call" ||
        op.kind === "array-write" ||
        op.kind === "array-store" ||
        op.kind === "array-fill"
      )
        return undefined;
    }
    const t = block.terminator;
    if (
      t.kind === "throw" ||
      t.kind === "throw-literal" ||
      ((t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
        t.operation !== "read")
    )
      return undefined;
  }
  const slotState = new Map<number, string>();
  slotState.set(pList, "list");
  slotState.set(pIndex, "index");
  let blockId = fn.entry,
    header: number | undefined;
  for (let steps = 0; steps < 32; steps++) {
    const block = fn.blocks[blockId];
    if (block === undefined) return undefined;
    const values = new Map<number, string>();
    for (const op of block.instructions) {
      if (op === undefined) return undefined;
      if (op.kind === "load") {
        const s = slotState.get(op.slot);
        if (s !== undefined) values.set(op.id, s);
      } else if (op.kind === "store") {
        const v = values.get(op.value);
        if (v === undefined) slotState.delete(op.slot);
        else slotState.set(op.slot, v);
      } else if (op.kind === "constant") {
        if (op.value === 0) values.set(op.id, "zero");
        else if (op.value === true) values.set(op.id, "true");
        else if (op.value === false) values.set(op.id, "false");
      } else if (op.kind === "reference-none") {
        values.set(op.id, "ref-none");
      } else if (op.kind === "record-read") {
        if (values.get(op.object) !== "list" || !headers.has(op.record))
          return undefined;
        if (header !== undefined && header !== op.record) return undefined;
        header = op.record;
        if (op.field === 0) values.set(op.id, "length");
        else if (op.field === 2) values.set(op.id, "present-none");
      } else if (op.kind === "unary") {
        const arg = values.get(op.operand);
        if (op.operator === "is-integer" && arg === "index")
          values.set(op.id, "true");
        else if (op.operator === "truthy") {
          if (arg === "true" || arg === "false") values.set(op.id, arg);
          else if (arg === "present-none") values.set(op.id, "false");
        } else if (op.operator === "!") {
          if (arg === "true") values.set(op.id, "false");
          else if (arg === "false") values.set(op.id, "true");
        }
      } else if (op.kind === "binary") {
        const l = values.get(op.left),
          r = values.get(op.right);
        if (op.operator === "===" || op.operator === "!==") {
          const isEq = op.operator === "===";
          if (
            (l === "present-none" && r === "ref-none") ||
            (r === "present-none" && l === "ref-none")
          )
            values.set(op.id, isEq ? "true" : "false");
        } else if (op.operator === ">=" && l === "index" && r === "zero")
          values.set(op.id, "true");
        else if (op.operator === "<=" && l === "zero" && r === "index")
          values.set(op.id, "true");
        else if (op.operator === "<" && l === "index" && r === "length")
          values.set(op.id, "true");
        else if (op.operator === ">" && l === "length" && r === "index")
          values.set(op.id, "true");
      }
    }
    const term = block.terminator;
    if (term.kind === "jump") {
      blockId = term.target;
      continue;
    }
    if (
      term.kind === "record" &&
      term.operation === "read" &&
      headers.has(term.record) &&
      values.get(term.object) === "list" &&
      isEmptyTrap(fn.blocks[term.alternate])
    ) {
      if (header !== undefined && header !== term.record) return undefined;
      header = term.record;
      if (term.field === 0) slotState.set(term.slot, "length");
      else if (term.field === 2) slotState.set(term.slot, "present-none");
      else return undefined;
      blockId = term.consequent;
      continue;
    }
    if (term.kind === "branch") {
      const cond = values.get(term.condition);
      if (cond === "true") {
        blockId = term.consequent;
        continue;
      }
      if (cond === "false") {
        blockId = term.alternate;
        continue;
      }
      return undefined;
    }
    if (term.kind === "return" && term.value !== undefined)
      return header !== undefined && values.get(term.value) === "true"
        ? header
        : undefined;
    return undefined;
  }
  return undefined;
}

/** Symbolically verifies that `fn(list)` on the dense non-empty path
 * (`present === none`, `values !== none`, `0 < length <= values.length`)
 * writes `list.length = length - 1` and returns `values[length - 1]` with no
 * other side effects. */
function matchPopHelper(
  fn: FunctionIR,
  headers: ReadonlySet<number>,
): number | undefined {
  if (
    fn.import === true ||
    fn.parameters.length !== 1 ||
    fn.returnType !== "optional-number" ||
    fn.blocks.length > 36
  )
    return undefined;
  const pList = fn.parameters[0];
  if (pList === undefined || fn.slots[pList] !== "reference") return undefined;
  const slotState = new Map<number, string>();
  slotState.set(pList, "list");
  let blockId = fn.entry,
    header: number | undefined,
    wroteLength = false;
  for (let steps = 0; steps < 48; steps++) {
    const block = fn.blocks[blockId];
    if (block === undefined || block.exception !== undefined) return undefined;
    const values = new Map<number, string>();
    for (const op of block.instructions) {
      if (op === undefined) return undefined;
      if (op.kind === "load") {
        const s = slotState.get(op.slot);
        if (s !== undefined) values.set(op.id, s);
      } else if (op.kind === "store") {
        const v = values.get(op.value);
        if (v === undefined) slotState.delete(op.slot);
        else slotState.set(op.slot, v);
      } else if (op.kind === "constant") {
        if (op.value === 0) values.set(op.id, "zero");
        else if (op.value === 1) values.set(op.id, "one");
      } else if (op.kind === "reference-none") {
        values.set(op.id, "ref-none");
      } else if (op.kind === "undefined") {
        values.set(op.id, "undef");
      } else if (op.kind === "record-read") {
        if (values.get(op.object) !== "list" || !headers.has(op.record))
          return undefined;
        if (header !== undefined && header !== op.record) return undefined;
        header = op.record;
        if (op.field === 0) values.set(op.id, "length");
        else if (op.field === 1) values.set(op.id, "values");
        else if (op.field === 2) values.set(op.id, "present-none");
      } else if (op.kind === "reference-value") {
        if (values.get(op.value) === "values" && op.type === "Float64Array")
          values.set(op.id, "f64-values");
      } else if (op.kind === "array-length") {
        if (values.get(op.array) === "f64-values") values.set(op.id, "cap");
      } else if (op.kind === "array-read") {
        if (
          values.get(op.array) === "f64-values" &&
          values.get(op.index) === "index"
        )
          values.set(op.id, "result");
      } else if (op.kind === "array-element") {
        if (
          values.get(op.array) === "f64-values" &&
          values.get(op.index) === "index"
        )
          values.set(op.id, "element");
      } else if (op.kind === "optional-wrap") {
        if (values.get(op.value) === "element") values.set(op.id, "result");
      } else if (op.kind === "binary") {
        const l = values.get(op.left),
          r = values.get(op.right);
        if (op.operator === ">>>" && l === "length" && r === "zero") {
          values.set(op.id, "length");
        } else if (op.operator === "-" && l === "length" && r === "one") {
          values.set(op.id, "index");
        } else if (op.operator === "===" || op.operator === "!==") {
          const isEq = op.operator === "===";
          if (
            (l === "length" && r === "zero") ||
            (r === "length" && l === "zero")
          )
            values.set(op.id, isEq ? "false" : "true");
          else if (
            (l === "present-none" && r === "ref-none") ||
            (r === "present-none" && l === "ref-none")
          )
            values.set(op.id, isEq ? "true" : "false");
          else if (
            (l === "values" && r === "ref-none") ||
            (r === "values" && l === "ref-none")
          )
            values.set(op.id, isEq ? "false" : "true");
        } else if (op.operator === "<") {
          if (l === "length" && r === "one") values.set(op.id, "false");
          else if (l === "index" && r === "cap") values.set(op.id, "true");
        } else if (op.operator === ">") {
          if (l === "one" && r === "length") values.set(op.id, "false");
          else if (l === "cap" && r === "index") values.set(op.id, "true");
        } else if (op.operator === ">=" && l === "length" && r === "one") {
          values.set(op.id, "true");
        }
      } else {
        return undefined;
      }
    }
    const term = block.terminator;
    if (term.kind === "jump") {
      blockId = term.target;
      continue;
    }
    if (
      term.kind === "record" &&
      headers.has(term.record) &&
      values.get(term.object) === "list" &&
      isEmptyTrap(fn.blocks[term.alternate])
    ) {
      if (header !== undefined && header !== term.record) return undefined;
      header = term.record;
      if (term.operation === "read") {
        if (term.field === 0) slotState.set(term.slot, "length");
        else if (term.field === 1) slotState.set(term.slot, "values");
        else if (term.field === 2) slotState.set(term.slot, "present-none");
        else return undefined;
      } else if (
        term.operation === "write" &&
        term.field === 0 &&
        slotState.get(term.slot) === "index" &&
        !wroteLength
      ) {
        wroteLength = true;
      } else {
        return undefined;
      }
      blockId = term.consequent;
      continue;
    }
    if (term.kind === "branch") {
      const cond = values.get(term.condition);
      if (cond === "true") {
        blockId = term.consequent;
        continue;
      }
      if (cond === "false") {
        blockId = term.alternate;
        continue;
      }
      return undefined;
    }
    if (term.kind === "return" && term.value !== undefined)
      return header !== undefined &&
        wroteLength &&
        values.get(term.value) === "result"
        ? header
        : undefined;
    return undefined;
  }
  return undefined;
}

/** Symbolically verifies that `fn(list, value)` on the dense in-capacity
 * numeric path (`present === none`, `value !== undefined`, `values !== none`,
 * `length < values.length`) writes `values[length] = value`, writes
 * `list.length = length + 1`, and returns `length + 1` with no other effects. */
function matchPushHelper(
  fn: FunctionIR,
  headers: ReadonlySet<number>,
): number | undefined {
  if (
    fn.import === true ||
    fn.parameters.length !== 2 ||
    fn.returnType !== "number" ||
    fn.blocks.length > 24
  )
    return undefined;
  const pList = fn.parameters[0],
    pVal = fn.parameters[1];
  if (
    pList === undefined ||
    pVal === undefined ||
    fn.slots[pList] !== "reference" ||
    fn.slots[pVal] !== "optional-number"
  )
    return undefined;
  const slotState = new Map<number, string>();
  slotState.set(pList, "list");
  slotState.set(pVal, "val-opt");
  let blockId = fn.entry,
    header: number | undefined,
    wroteElement = false,
    wroteLength = false;
  for (let steps = 0; steps < 48; steps++) {
    const block = fn.blocks[blockId];
    if (block === undefined || block.exception !== undefined) return undefined;
    const values = new Map<number, string>();
    for (const op of block.instructions) {
      if (op === undefined) return undefined;
      if (op.kind === "load") {
        const s = slotState.get(op.slot);
        if (s !== undefined) values.set(op.id, s);
      } else if (op.kind === "store") {
        const v = values.get(op.value);
        if (v === undefined) slotState.delete(op.slot);
        else slotState.set(op.slot, v);
      } else if (op.kind === "constant") {
        if (op.value === 0) values.set(op.id, "zero");
        else if (op.value === 1) values.set(op.id, "one");
      } else if (op.kind === "reference-none") {
        values.set(op.id, "ref-none");
      } else if (op.kind === "undefined") {
        values.set(op.id, "undef");
      } else if (op.kind === "optional-present") {
        if (values.get(op.value) === "val-opt") values.set(op.id, "true");
      } else if (op.kind === "optional-value") {
        if (values.get(op.value) === "val-opt") values.set(op.id, "val");
      } else if (op.kind === "record-read") {
        if (values.get(op.object) !== "list" || !headers.has(op.record))
          return undefined;
        if (header !== undefined && header !== op.record) return undefined;
        header = op.record;
        if (op.field === 0) values.set(op.id, "length");
        else if (op.field === 1) values.set(op.id, "values");
        else if (op.field === 2) values.set(op.id, "present-none");
      } else if (op.kind === "reference-value") {
        if (values.get(op.value) === "values" && op.type === "Float64Array")
          values.set(op.id, "f64-values");
      } else if (op.kind === "array-length") {
        if (values.get(op.array) === "f64-values") values.set(op.id, "cap");
      } else if (op.kind === "array-write" || op.kind === "array-store") {
        if (
          values.get(op.array) === "f64-values" &&
          values.get(op.index) === "length" &&
          values.get(op.value) === "val" &&
          !wroteElement
        )
          wroteElement = true;
        else return undefined;
      } else if (op.kind === "binary") {
        const l = values.get(op.left),
          r = values.get(op.right);
        if (op.operator === ">>>" && l === "length" && r === "zero") {
          values.set(op.id, "length");
        } else if (
          op.operator === "+" &&
          ((l === "length" && r === "one") || (r === "length" && l === "one"))
        ) {
          values.set(op.id, "next-length");
        } else if (op.operator === "===" || op.operator === "!==") {
          const isEq = op.operator === "===";
          if (
            (l === "present-none" && r === "ref-none") ||
            (r === "present-none" && l === "ref-none")
          )
            values.set(op.id, isEq ? "true" : "false");
          else if (
            (l === "val-opt" && r === "undef") ||
            (r === "val-opt" && l === "undef")
          )
            values.set(op.id, isEq ? "false" : "true");
          else if (
            (l === "values" && r === "ref-none") ||
            (r === "values" && l === "ref-none")
          )
            values.set(op.id, isEq ? "false" : "true");
        } else if (op.operator === "<" && l === "length" && r === "cap") {
          values.set(op.id, "true");
        } else if (op.operator === ">" && l === "cap" && r === "length") {
          values.set(op.id, "true");
        }
      } else {
        return undefined;
      }
    }
    const term = block.terminator;
    if (term.kind === "jump") {
      blockId = term.target;
      continue;
    }
    if (
      term.kind === "record" &&
      headers.has(term.record) &&
      values.get(term.object) === "list" &&
      isEmptyTrap(fn.blocks[term.alternate])
    ) {
      if (header !== undefined && header !== term.record) return undefined;
      header = term.record;
      if (term.operation === "read") {
        if (term.field === 0) slotState.set(term.slot, "length");
        else if (term.field === 1) slotState.set(term.slot, "values");
        else if (term.field === 2) slotState.set(term.slot, "present-none");
        else return undefined;
      } else if (
        term.operation === "write" &&
        term.field === 0 &&
        slotState.get(term.slot) === "next-length" &&
        !wroteLength
      ) {
        wroteLength = true;
      } else {
        return undefined;
      }
      blockId = term.consequent;
      continue;
    }
    if (term.kind === "branch") {
      const cond = values.get(term.condition);
      if (cond === "true") {
        blockId = term.consequent;
        continue;
      }
      if (cond === "false") {
        blockId = term.alternate;
        continue;
      }
      return undefined;
    }
    if (term.kind === "return" && term.value !== undefined)
      return header !== undefined &&
        wroteElement &&
        wroteLength &&
        values.get(term.value) === "next-length"
        ? header
        : undefined;
    return undefined;
  }
  return undefined;
}

function addMapSet(
  map: Map<number, Set<number>>,
  key: number,
  value: number,
): void {
  let set = map.get(key);
  if (set === undefined) {
    set = new Set<number>();
    map.set(key, set);
  }
  set.add(value);
}

function findNumberListHelpers(module: ModuleIR): NumberListHelpers[] {
  const candidates = candidateHeaders(module);
  if (candidates.size === 0) return [];
  const lengths = new Map<number, Set<number>>(),
    reads = new Map<number, Set<number>>(),
    hases = new Map<number, Set<number>>(),
    pops = new Map<number, Set<number>>(),
    pushes = new Map<number, Set<number>>();
  for (const fn of module.functions) {
    if (fn === undefined) continue;
    const lenH = matchLengthHelper(fn, candidates);
    if (lenH !== undefined) {
      addMapSet(lengths, lenH, fn.id);
      continue;
    }
    const readH = matchReadHelper(fn, candidates);
    if (readH !== undefined) {
      addMapSet(reads, readH, fn.id);
      continue;
    }
    const hasH = matchHasHelper(fn, candidates);
    if (hasH !== undefined) {
      addMapSet(hases, hasH, fn.id);
      continue;
    }
    const popH = matchPopHelper(fn, candidates);
    if (popH !== undefined) {
      addMapSet(pops, popH, fn.id);
      continue;
    }
    const pushH = matchPushHelper(fn, candidates);
    if (pushH !== undefined) addMapSet(pushes, pushH, fn.id);
  }
  const allHeaders = new Set<number>();
  for (const [header] of reads) allHeaders.add(header);
  for (const [header] of pops) allHeaders.add(header);
  for (const [header] of pushes) allHeaders.add(header);
  const helpers: NumberListHelpers[] = [];
  for (const header of allHeaders) {
    const lengthFns = lengths.get(header) ?? new Set<number>(),
      readFns = reads.get(header) ?? new Set<number>(),
      hasFns = hases.get(header) ?? new Set<number>(),
      popFns = pops.get(header) ?? new Set<number>(),
      pushFns = pushes.get(header) ?? new Set<number>();
    if (
      (lengthFns.size > 0 && (readFns.size > 0 || popFns.size > 0)) ||
      pushFns.size > 0
    )
      helpers.push({ header, lengthFns, readFns, hasFns, popFns, pushFns });
  }
  return helpers;
}

function isUint32Constant(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 4294967295 &&
    (value !== 0 || 1 / value > 0)
  );
}

/** The uint32 constant `slot` holds on every path to the end of block `at`,
 * if any (same forward dataflow as boundCountedLoops / list-vectors). */
function slotEntryConstant(
  fn: FunctionIR,
  slot: number,
  at: number,
): number | undefined {
  const count = fn.blocks.length,
    state = new Uint8Array(count),
    known = new Float64Array(count),
    out = new Uint8Array(count),
    outValue = new Float64Array(count),
    worklist: number[] = [fn.entry];
  state[fn.entry] = 2;
  const meet = (target: number, kind: number, value: number): void => {
    const before = state[target] ?? 0;
    if (before === 2) return;
    if (before === 1 && kind === 1 && known[target] === value) return;
    state[target] = before === 0 ? kind : 2;
    known[target] = value;
    worklist.push(target);
  };
  const constants = new Map<number, number>();
  while (worklist.length > 0) {
    const id = worklist.pop();
    if (id === undefined) break;
    const block = fn.blocks[id];
    if (block === undefined) continue;
    let kind = state[id] ?? 2,
      value = known[id] ?? 0;
    constants.clear();
    for (const op of block.instructions) {
      if (op === undefined) continue;
      if (op.kind === "constant") {
        const literal = op.value;
        if (typeof literal === "number") constants.set(op.id, literal);
      } else if (op.kind === "store" && op.slot === slot) {
        const stored = constants.get(op.value);
        if (stored === undefined || !isUint32Constant(stored)) kind = 2;
        else {
          kind = 1;
          value = stored;
        }
      }
    }
    const t = block.terminator;
    if (
      (t.kind === "record" || t.kind === "record-cell" || t.kind === "cell") &&
      t.slot === slot &&
      t.operation !== "write"
    )
      kind = 2;
    out[id] = kind;
    outValue[id] = value;
    for (const target of blockSuccessors(block))
      if (target !== undefined) meet(target, kind, value);
    if (block.exception !== undefined) meet(block.exception.target, 2, 0);
  }
  return out[at] === 1 ? outValue[at] : undefined;
}

function retargetTerminator(
  term: Terminator,
  route: (id: number) => number,
): Terminator {
  if (term.kind === "jump") return { ...term, target: route(term.target) };
  if (
    term.kind === "branch" ||
    term.kind === "record" ||
    term.kind === "record-cell" ||
    term.kind === "cell"
  )
    return {
      ...term,
      consequent: route(term.consequent),
      alternate: route(term.alternate),
    };
  return term;
}

function cloneLoopColdCopy(
  fn: FunctionIR,
  loop: NaturalLoop,
  candBlocks: Block[],
  startValueId: number,
): { readonly coldHeader: number; readonly nextValue: number } | undefined {
  let nextValue = startValueId;
  const copies = new Map<number, number>();
  for (const id of loop.body) {
    if (id === undefined) continue;
    copies.set(id, candBlocks.length);
    candBlocks.push({
      id: candBlocks.length,
      instructions: [],
      terminator: { kind: "trap", start: 0, end: 0 },
    });
  }
  const route = (target: number): number => copies.get(target) ?? target,
    substitution = new Uint32Array(startValueId);
  for (const original of loop.body) {
    if (original === undefined) continue;
    const block = fn.blocks[original],
      copyId = copies.get(original);
    if (block === undefined || copyId === undefined) continue;
    substitution.fill(0);
    const instructions: Instruction[] = [];
    for (const op of block.instructions) {
      if (op === undefined) continue;
      const substituted = substituteInstructionValues(op, substitution),
        result = instructionResult(op);
      let copied = substituted;
      if (result !== undefined) {
        const renamed = nextValue++;
        substitution[result] = renamed + 1;
        copied = renumberInstructionResult(substituted, renamed);
      }
      instructions.push(copied);
    }
    const copyTerm = retargetTerminator(
      substituteTerminatorValues(block.terminator, substitution),
      route,
    );
    candBlocks[copyId] =
      block.exception === undefined
        ? { id: copyId, instructions, terminator: copyTerm }
        : {
            id: copyId,
            instructions,
            terminator: copyTerm,
            exception: {
              ...block.exception,
              target: route(block.exception.target),
            },
          };
  }
  const coldHeader = copies.get(loop.header);
  return coldHeader === undefined ? undefined : { coldHeader, nextValue };
}

/** Hoists dense `NumberList` header checks and bounds out of counted read
 * loops (`for-of` / `for (i < list.length)`), `while (list.length > k) list.pop()`,
 * and `for (...) list.push(...)` loops before inlining explodes the helpers. */
export function hoistNumberListLoops(
  module: ModuleIR,
  budget: number,
  closedCalls: boolean = false,
): NumberListLoopHoisting | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw "INVALID_OPTIMIZATION_BUDGET";
  let visited = module.functions.length;
  if (visited > budget) return undefined;
  const helpers = findNumberListHelpers(module);
  if (helpers.length === 0) return { module, visited, rewritten: 0 };

  const headerIndex = new Map<number, number>(),
    lengthToHelper = new Map<number, NumberListHelpers>(),
    readToHelper = new Map<number, NumberListHelpers>(),
    popToHelper = new Map<number, NumberListHelpers>(),
    pushToHelper = new Map<number, NumberListHelpers>(),
    helperFunctions = new Set<number>();
  for (let i = 0; i < helpers.length; i++) {
    const h = helpers[i];
    if (h === undefined) continue;
    headerIndex.set(h.header, i);
    for (const id of h.lengthFns) {
      lengthToHelper.set(id, h);
      helperFunctions.add(id);
    }
    for (const id of h.readFns) {
      readToHelper.set(id, h);
      helperFunctions.add(id);
    }
    for (const id of h.hasFns) helperFunctions.add(id);
    for (const id of h.popFns) {
      popToHelper.set(id, h);
      helperFunctions.add(id);
    }
    for (const id of h.pushFns) {
      pushToHelper.set(id, h);
      helperFunctions.add(id);
    }
  }

  // Interprocedural summaries of which functions may write or read each NumberList header.
  const targets = indirectCallTargets(module, closedCalls, budget - visited);
  if (targets === undefined) return undefined;
  const resolvedTargets = targets;
  visited += resolvedTargets.visited;
  const fnCount = module.functions.length,
    nodeCount = fnCount + resolvedTargets.classes.length,
    words = (helpers.length + 31) >>> 5,
    closed = stableRecordLayouts(module),
    writeMasks = new Uint32Array(nodeCount * words),
    readMasks = new Uint32Array(nodeCount * words),
    callers: number[][] = [];
  for (let i = 0; i < nodeCount; i++) callers.push([]);
  const markAll = (masks: Uint32Array, node: number): void => {
    for (let w = node * words; w < (node + 1) * words; w++)
      masks[w] = 0xffffffff;
  };
  for (let c = 0; c < resolvedTargets.classes.length; c++) {
    if (!closed) {
      markAll(writeMasks, fnCount + c);
      markAll(readMasks, fnCount + c);
    }
    for (const member of resolvedTargets.classes[c] ?? [])
      if (member !== undefined) callers[member]?.push(fnCount + c);
  }
  for (const fn of module.functions) {
    if (fn === undefined) continue;
    if (fn.import === true) {
      markAll(writeMasks, fn.id);
      markAll(readMasks, fn.id);
      continue;
    }
    for (const block of fn.blocks) {
      if (block === undefined) continue;
      visited += block.instructions.length + 1;
      const t = block.terminator;
      if (t.kind === "record" || t.kind === "record-cell") {
        const idx = headerIndex.get(t.record);
        if (idx !== undefined) {
          const at = fn.id * words + (idx >>> 5),
            bit = 1 << (idx & 31);
          if (t.operation !== "read")
            writeMasks[at] = ((writeMasks[at] ?? 0) | bit) >>> 0;
          else readMasks[at] = ((readMasks[at] ?? 0) | bit) >>> 0;
        }
      }
      for (const op of block.instructions) {
        if (op === undefined) continue;
        if (op.kind === "record-read") {
          const idx = headerIndex.get(op.record);
          if (idx !== undefined) {
            const at = fn.id * words + (idx >>> 5);
            readMasks[at] = ((readMasks[at] ?? 0) | (1 << (idx & 31))) >>> 0;
          }
        } else if (op.kind === "call") callers[op.target]?.push(fn.id);
        else if (op.kind === "call-indirect") {
          const cls = indirectCallClass(resolvedTargets, fn.id, block.id, op);
          if (cls >= 0) callers[fnCount + cls]?.push(fn.id);
        } else if (op.kind === "host-call" && !closed) {
          markAll(writeMasks, fn.id);
          markAll(readMasks, fn.id);
        }
      }
    }
    if (visited > budget) return undefined;
  }
  const propagateMask = (masks: Uint32Array): boolean => {
    const pending: number[] = [],
      queued = new Uint8Array(nodeCount);
    for (let i = 0; i < nodeCount; i++) {
      pending.push(i);
      queued[i] = 1;
    }
    while (pending.length > 0) {
      const callee = pending.pop();
      if (callee === undefined) break;
      queued[callee] = 0;
      for (const caller of callers[callee] ?? []) {
        if (caller === undefined) continue;
        if (++visited > budget) return false;
        let changed = false;
        for (let w = 0; w < words; w++) {
          const from = masks[callee * words + w] ?? 0,
            at = caller * words + w,
            before = masks[at] ?? 0,
            after = (before | from) >>> 0;
          if (after !== before) {
            masks[at] = after;
            changed = true;
          }
        }
        if (changed && queued[caller] === 0) {
          queued[caller] = 1;
          pending.push(caller);
        }
      }
    }
    return true;
  };
  if (!propagateMask(writeMasks) || !propagateMask(readMasks)) return undefined;

  function opTouchesHeader(
    masks: Uint32Array,
    fnId: number,
    blockId: number,
    op: Instruction,
    hIdx: number,
    ignoreHelpers?: ReadonlySet<number>,
  ): boolean {
    if (op.kind === "host-call") return !closed;
    let node = -1;
    if (op.kind === "call") {
      if (ignoreHelpers !== undefined && ignoreHelpers.has(op.target))
        return false;
      node = op.target;
    } else if (op.kind === "call-indirect") {
      const cls = indirectCallClass(resolvedTargets, fnId, blockId, op);
      if (cls < 0) return false;
      node = fnCount + cls;
    } else return false;
    return (
      (((masks[node * words + (hIdx >>> 5)] ?? 0) >>> (hIdx & 31)) & 1) !== 0
    );
  }

  function loopWritesHeader(
    fn: FunctionIR,
    loop: NaturalLoop,
    header: number,
    hIdx: number,
    allowedReadHelpers: ReadonlySet<number>,
  ): boolean {
    for (const id of loop.body) {
      const block = fn.blocks[id];
      if (block === undefined) return true;
      const t = block.terminator;
      if (
        (t.kind === "record" || t.kind === "record-cell") &&
        t.operation !== "read" &&
        t.record === header
      )
        return true;
      for (const op of block.instructions)
        if (
          op !== undefined &&
          opTouchesHeader(writeMasks, fn.id, id, op, hIdx, allowedReadHelpers)
        )
          return true;
    }
    return false;
  }

  const functions: FunctionIR[] = module.functions.slice();
  let rewritten = 0;

  for (let fnIdx = 0; fnIdx < module.functions.length; fnIdx++) {
    const fn = module.functions[fnIdx];
    if (fn === undefined || fn.import === true || helperFunctions.has(fn.id))
      continue;
    let hasCandidate = false;
    for (const block of fn.blocks) {
      if (block === undefined) continue;
      for (const op of block.instructions)
        if (
          op !== undefined &&
          op.kind === "call" &&
          (readToHelper.has(op.target) ||
            popToHelper.has(op.target) ||
            pushToHelper.has(op.target))
        ) {
          hasCandidate = true;
          break;
        }
      if (hasCandidate) break;
    }
    visited += fn.blocks.length;
    if (!hasCandidate) continue;
    if (visited > budget) return undefined;

    const result = rewriteFunction(fn, budget - visited);
    if (result === undefined) return undefined;
    visited += result.visited;
    if (result.rewritten > 0) {
      functions[fnIdx] = result.fn;
      rewritten += result.rewritten;
    }
  }

  return rewritten === 0
    ? { module, visited, rewritten: 0 }
    : { module: { ...module, functions }, visited, rewritten };

  function rewriteFunction(
    fn: FunctionIR,
    remaining: number,
  ): { fn: FunctionIR; visited: number; rewritten: number } | undefined {
    const forest = naturalLoops(fn, remaining);
    if (forest === undefined) return undefined;
    let work = forest.visited;
    if (forest.loops.length === 0) return { fn, visited: work, rewritten: 0 };

    const predecessors = new Map<number, number[]>();
    let nextValue = 0;
    for (const block of fn.blocks) {
      if (block === undefined) return undefined;
      for (const op of block.instructions) {
        if (op === undefined) return undefined;
        work++;
        const id = instructionResult(op);
        if (id !== undefined && id >= nextValue) nextValue = id + 1;
      }
      for (const target of blockSuccessors(block)) {
        if (target === undefined) continue;
        let list = predecessors.get(target);
        if (list === undefined) {
          list = [];
          predecessors.set(target, list);
        }
        list.push(block.id);
      }
    }
    if (work > remaining) return undefined;

    // Innermost loops first; each block joins at most one versioned loop.
    const loops: NaturalLoop[] = [];
    for (const loop of forest.loops) {
      if (loop === undefined) continue;
      let at = loops.length;
      while (at > 0 && (loops[at - 1]?.body.size ?? 0) > loop.body.size) at--;
      loops.splice(at, 0, loop);
    }

    let currentFn = fn,
      count = 0;
    const touched = new Set<number>();

    const makeResolve = (
      block: Block,
    ): ((id: number) => Instruction | undefined) => {
      const defs = new Map<number, Instruction>(),
        slotVal = new Map<number, number>();
      for (const op of block.instructions) {
        if (op === undefined) continue;
        const r = instructionResult(op);
        if (r !== undefined) defs.set(r, op);
        if (op.kind === "store") slotVal.set(op.slot, op.value);
      }
      return (id: number): Instruction | undefined => {
        let cur = id;
        for (let d = 0; d < 6; d++) {
          const def = defs.get(cur);
          if (def === undefined) return undefined;
          if (def.kind === "load") {
            const stored = slotVal.get(def.slot);
            if (stored !== undefined) {
              cur = stored;
              continue;
            }
          }
          return def;
        }
        return undefined;
      };
    };

    for (const loop of loops) {
      if (loop === undefined) continue;
      let overlap = false;
      for (const id of loop.body) if (touched.has(id)) overlap = true;
      if (overlap) continue;
      const outside = (predecessors.get(loop.header) ?? []).filter(
        (id) => !loop.body.has(id),
      );
      const preheaderId = outside[0];
      if (
        outside.length !== 1 ||
        preheaderId === undefined ||
        touched.has(preheaderId)
      )
        continue;
      const preheader = currentFn.blocks[preheaderId];
      if (preheader === undefined || preheader.exception !== undefined)
        continue;
      const preTerm = preheader.terminator;
      if (preTerm.kind !== "jump" || preTerm.target !== loop.header) continue;
      let irreducible = false;
      for (const id of loop.body) {
        if (id === loop.header) continue;
        if ((predecessors.get(id) ?? []).some((p) => !loop.body.has(p))) {
          irreducible = true;
          break;
        }
      }
      if (irreducible) continue;

      const hoistedRead = tryHoistReadLoop(
        currentFn,
        loop,
        preheaderId,
        preheader,
        nextValue,
      );
      if (hoistedRead !== undefined) {
        currentFn = hoistedRead.fn;
        nextValue = hoistedRead.nextValue;
        count += hoistedRead.rewritten;
        for (const id of loop.body) touched.add(id);
        touched.add(preheaderId);
        continue;
      }

      const hoistedPop = tryHoistPopLoop(
        currentFn,
        loop,
        preheaderId,
        preheader,
        nextValue,
      );
      if (hoistedPop !== undefined) {
        currentFn = hoistedPop.fn;
        nextValue = hoistedPop.nextValue;
        count += hoistedPop.rewritten;
        for (const id of loop.body) touched.add(id);
        touched.add(preheaderId);
        continue;
      }

      const hoistedPush = tryHoistPushLoop(
        currentFn,
        loop,
        preheaderId,
        preheader,
        nextValue,
      );
      if (hoistedPush !== undefined) {
        currentFn = hoistedPush.fn;
        nextValue = hoistedPush.nextValue;
        count += hoistedPush.rewritten;
        for (const id of loop.body) touched.add(id);
        touched.add(preheaderId);
      }
    }

    return { fn: currentFn, visited: work, rewritten: count };

    function tryHoistReadLoop(
      fnIn: FunctionIR,
      loop: NaturalLoop,
      preheaderId: number,
      preheader: Block,
      startValueId: number,
    ):
      | {
          readonly fn: FunctionIR;
          readonly nextValue: number;
          readonly rewritten: number;
        }
      | undefined {
      const headerBlock = fnIn.blocks[loop.header];
      if (headerBlock === undefined || headerBlock.exception !== undefined)
        return undefined;
      const hTerm = headerBlock.terminator;
      if (
        hTerm.kind !== "branch" ||
        !loop.body.has(hTerm.consequent) ||
        loop.body.has(hTerm.alternate)
      )
        return undefined;

      const resolveVal = makeResolve(headerBlock);
      const hStored = new Set<number>();
      for (const op of headerBlock.instructions)
        if (op !== undefined && op.kind === "store") hStored.add(op.slot);
      const condDef = resolveVal(hTerm.condition);
      if (
        condDef === undefined ||
        condDef.kind !== "binary" ||
        condDef.operator !== "<"
      )
        return undefined;
      const counterDef = resolveVal(condDef.left);
      if (
        counterDef === undefined ||
        counterDef.kind !== "load" ||
        fnIn.slots[counterDef.slot] !== "number"
      )
        return undefined;
      const counter = counterDef.slot;
      if (hStored.has(counter)) return undefined;

      const boundDef = resolveVal(condDef.right);
      let lenCall: Instruction | undefined,
        uint32Op: Instruction | undefined,
        preheaderBoundLoad: Instruction | undefined,
        preheaderResolve: ((id: number) => Instruction | undefined) | undefined;
      if (
        boundDef !== undefined &&
        boundDef.kind === "unary" &&
        boundDef.operator === "uint32"
      ) {
        uint32Op = boundDef;
        lenCall = resolveVal(boundDef.operand);
      } else if (
        boundDef !== undefined &&
        boundDef.kind === "load" &&
        !loop.writes.has(boundDef.slot) &&
        fnIn.slots[boundDef.slot] === "number"
      ) {
        // Also recognize `const length = lengthNumberList(list)` hoisted into
        // the loop preheader (as emitted by fused HIR pipelines).
        preheaderResolve = makeResolve(preheader);
        let stored: number | undefined;
        for (let i = preheader.instructions.length - 1; i >= 0; i--) {
          const pOp = preheader.instructions[i];
          if (
            pOp !== undefined &&
            pOp.kind === "store" &&
            pOp.slot === boundDef.slot
          ) {
            stored = pOp.value;
            break;
          }
        }
        if (stored !== undefined) {
          let rhs = preheaderResolve(stored);
          if (
            rhs !== undefined &&
            rhs.kind === "unary" &&
            rhs.operator === "uint32"
          )
            rhs = preheaderResolve(rhs.operand);
          if (
            rhs !== undefined &&
            rhs.kind === "call" &&
            rhs.id !== undefined
          ) {
            lenCall = rhs;
            preheaderBoundLoad = boundDef;
          }
        }
      } else {
        lenCall = boundDef;
      }
      if (
        lenCall === undefined ||
        lenCall.kind !== "call" ||
        lenCall.id === undefined
      )
        return undefined;
      const helper = lengthToHelper.get(lenCall.target);
      if (helper === undefined || helper.readFns.size === 0) return undefined;
      const listArg = lenCall.arguments[0];
      if (listArg === undefined) return undefined;
      let directListSlot: number | undefined;
      const srcBlock =
        preheaderBoundLoad !== undefined ? preheader : headerBlock;
      for (const sOp of srcBlock.instructions)
        if (sOp !== undefined && sOp.kind === "load" && sOp.id === listArg) {
          directListSlot = sOp.slot;
          break;
        }
      const listDef = (preheaderResolve ?? resolveVal)(listArg);
      const listSlots = new Set<number>();
      let listSlot = -1;
      if (
        directListSlot !== undefined &&
        !loop.writes.has(directListSlot) &&
        fnIn.slots[directListSlot] === "reference"
      ) {
        listSlot = directListSlot;
        listSlots.add(directListSlot);
      }
      if (
        listDef !== undefined &&
        listDef.kind === "load" &&
        !loop.writes.has(listDef.slot) &&
        fnIn.slots[listDef.slot] === "reference"
      ) {
        if (listSlot < 0) listSlot = listDef.slot;
        listSlots.add(listDef.slot);
      }
      if (listSlot < 0) return undefined;
      // Also recognize preheader slot copies `store(alias, load(listSlot))`
      // (as produced by fused HIR pipelines before propagate-slot-copies runs).
      const preResolve = preheaderResolve ?? makeResolve(preheader);
      const aliasWrites = new Map<number, number>();
      for (let i = 0; i < preheader.instructions.length; i++) {
        const pOp = preheader.instructions[i];
        if (pOp !== undefined && pOp.kind === "store")
          aliasWrites.set(pOp.slot, i);
      }
      for (const [slot, writeIdx] of aliasWrites) {
        if (
          listSlots.has(slot) ||
          loop.writes.has(slot) ||
          fnIn.slots[slot] !== "reference"
        )
          continue;
        const st = preheader.instructions[writeIdx];
        if (st === undefined || st.kind !== "store") continue;
        const rhs = preResolve(st.value);
        if (rhs !== undefined && rhs.kind === "load" && listSlots.has(rhs.slot))
          listSlots.add(slot);
      }
      // When the bound came from the preheader, ensure listSlot is not
      // reassigned in the preheader after `lenCall`!
      if (preheaderBoundLoad !== undefined) {
        let seenCall = false;
        for (const pOp of preheader.instructions) {
          if (pOp === lenCall) seenCall = true;
          else if (
            seenCall &&
            pOp !== undefined &&
            pOp.kind === "store" &&
            listSlots.has(pOp.slot)
          ) {
            const rhs = preResolve(pOp.value);
            if (
              rhs === undefined ||
              rhs.kind !== "load" ||
              !listSlots.has(rhs.slot)
            )
              return undefined;
          }
        }
      }

      const hIdx = headerIndex.get(helper.header);
      const readOnlyHelpers = new Set<number>();
      for (const id of helper.lengthFns) readOnlyHelpers.add(id);
      for (const id of helper.readFns) readOnlyHelpers.add(id);
      for (const id of helper.hasFns) readOnlyHelpers.add(id);
      if (
        hIdx === undefined ||
        loopWritesHeader(fnIn, loop, helper.header, hIdx, readOnlyHelpers)
      )
        return undefined;

      const startValue = slotEntryConstant(fnIn, counter, preheaderId);
      if (startValue === undefined) return undefined;

      let totalInsts = 0,
        stepBlock = -1,
        stepIndex = -1,
        validLoop = true;
      const matched: {
        readonly blockId: number;
        readonly index: number;
        readonly idxArg: number;
        readonly kind: "read" | "has";
      }[] = [];
      const matchedByBlock = new Map<number, number[]>();

      for (const id of loop.body) {
        const block = fnIn.blocks[id];
        if (block === undefined) return undefined;
        totalInsts += block.instructions.length;
        if (totalInsts > maxHoistedLoopInstructions) return undefined;
        if (block.exception !== undefined && block.exception.slot === counter)
          return undefined;
        const bt = block.terminator;
        if (
          (bt.kind === "record" ||
            bt.kind === "record-cell" ||
            bt.kind === "cell") &&
          bt.operation === "read" &&
          bt.slot === counter
        )
          return undefined;
        const defs = new Map<number, Instruction>(),
          slotVal = new Map<number, number>();
        const resolveLocal = (v: number): Instruction | undefined => {
          let cur = v;
          for (let d = 0; d < 6; d++) {
            const def = defs.get(cur);
            if (def === undefined) return undefined;
            if (def.kind === "load") {
              const s = slotVal.get(def.slot);
              if (s !== undefined) {
                cur = s;
                continue;
              }
            }
            return def;
          }
          return undefined;
        };
        for (let i = 0; i < block.instructions.length; i++) {
          const op = block.instructions[i];
          if (op === undefined) continue;
          const r = instructionResult(op);
          if (r !== undefined) defs.set(r, op);
          if (op.kind === "store") {
            if (op.slot === counter) {
              if (stepBlock >= 0) {
                validLoop = false;
                break;
              }
              const rhs = resolveLocal(op.value);
              if (
                rhs === undefined ||
                rhs.kind !== "binary" ||
                rhs.operator !== "+"
              ) {
                validLoop = false;
                break;
              }
              const l = resolveLocal(rhs.left),
                rr = resolveLocal(rhs.right);
              const isOne = (x: Instruction | undefined): boolean =>
                x !== undefined && x.kind === "constant" && x.value === 1;
              const loaded = isOne(l) ? rr : isOne(rr) ? l : undefined;
              if (
                loaded === undefined ||
                loaded.kind !== "load" ||
                loaded.slot !== counter
              ) {
                validLoop = false;
                break;
              }
              stepBlock = id;
              stepIndex = i;
            }
            slotVal.set(op.slot, op.value);
          } else if (
            id !== loop.header &&
            op.kind === "call" &&
            op.id !== undefined &&
            (helper.readFns.has(op.target) || helper.hasFns.has(op.target))
          ) {
            const kind = helper.readFns.has(op.target) ? "read" : "has";
            const aList = op.arguments[0],
              aIdx = op.arguments[1];
            if (aList === undefined || aIdx === undefined) continue;
            const listOp = resolveLocal(aList);
            if (
              listOp === undefined ||
              listOp.kind !== "load" ||
              !listSlots.has(listOp.slot)
            )
              continue;
            const idxOp = resolveLocal(aIdx);
            let inRange = false;
            if (
              idxOp !== undefined &&
              idxOp.kind === "load" &&
              idxOp.slot === counter
            )
              inRange = true;
            else if (
              idxOp !== undefined &&
              idxOp.kind === "binary" &&
              idxOp.operator === "-"
            ) {
              const base = resolveLocal(idxOp.left),
                sub = resolveLocal(idxOp.right);
              if (
                base !== undefined &&
                base.kind === "load" &&
                base.slot === counter &&
                sub !== undefined &&
                sub.kind === "constant"
              ) {
                const subValue = sub.value;
                if (
                  typeof subValue === "number" &&
                  Number.isInteger(subValue) &&
                  subValue >= 0 &&
                  subValue <= startValue
                )
                  inRange = true;
              }
            }
            if (inRange) {
              matched.push({ blockId: id, index: i, idxArg: aIdx, kind });
              let list = matchedByBlock.get(id);
              if (list === undefined) {
                list = [];
                matchedByBlock.set(id, list);
              }
              list.push(i);
            }
          }
        }
        if (!validLoop) return undefined;
      }
      if (stepBlock < 0 || matched.length === 0) return undefined;

      // Ensure no matched read executes after the counter increment in the same iteration.
      for (const idx of matchedByBlock.get(stepBlock) ?? [])
        if (idx !== undefined && idx > stepIndex) return undefined;
      const stepB = fnIn.blocks[stepBlock];
      if (stepB === undefined) return undefined;
      const seenAfter = new Set<number>(),
        queue: number[] = [];
      for (const succ of blockSuccessors(stepB))
        if (succ !== undefined && succ !== loop.header && loop.body.has(succ)) {
          seenAfter.add(succ);
          queue.push(succ);
        }
      while (queue.length > 0) {
        const id = queue.pop();
        if (id === undefined) break;
        if (id === stepBlock || matchedByBlock.has(id)) return undefined;
        const b = fnIn.blocks[id];
        if (b === undefined) return undefined;
        for (const succ of blockSuccessors(b))
          if (
            succ !== undefined &&
            succ !== loop.header &&
            loop.body.has(succ) &&
            !seenAfter.has(succ)
          ) {
            seenAfter.add(succ);
            queue.push(succ);
          }
      }

      const candSlots: ScalarType[] = fnIn.slots.slice(),
        presentSlot = candSlots.length;
      candSlots.push("optional-reference");
      const valuesOptSlot = candSlots.length;
      candSlots.push("optional-reference");
      const valuesSlot = candSlots.length;
      candSlots.push("Float64Array");
      const rawLenSlot = candSlots.length;
      candSlots.push("number");
      const lenSlot = candSlots.length;
      candSlots.push("number");

      const candBlocks: Block[] = fnIn.blocks.slice();
      const cloned = cloneLoopColdCopy(fnIn, loop, candBlocks, startValueId);
      if (cloned === undefined) return undefined;
      let candNextValue = cloned.nextValue;
      const coldHeader = cloned.coldHeader;

      // Rewrite hot header: replace `lenCall` (and `uint32Op`, or `preheaderBoundLoad`) with `load(lenSlot)`.
      const hotHeaderInsts: Instruction[] = [];
      for (const op of headerBlock.instructions) {
        if (op === undefined) continue;
        if (
          preheaderBoundLoad !== undefined &&
          op === preheaderBoundLoad &&
          op.kind === "load"
        ) {
          hotHeaderInsts.push({
            kind: "load",
            id: op.id,
            slot: lenSlot,
            start: op.start,
            end: op.end,
          });
        } else if (
          op === lenCall &&
          op.kind === "call" &&
          op.id !== undefined
        ) {
          hotHeaderInsts.push({
            kind: "load",
            id: op.id,
            slot: lenSlot,
            start: op.start,
            end: op.end,
          });
        } else if (
          uint32Op !== undefined &&
          op === uint32Op &&
          op.kind === "unary"
        ) {
          hotHeaderInsts.push({
            kind: "load",
            id: op.id,
            slot: lenSlot,
            start: op.start,
            end: op.end,
          });
        } else {
          hotHeaderInsts.push(op);
        }
      }
      candBlocks[loop.header] = {
        ...headerBlock,
        instructions: hotHeaderInsts,
      };

      // Rewrite matched `readFn(listSlot, idx)` in hot blocks to `array-element` + `optional-wrap`
      // and `hasFn(listSlot, idx)` to `constant true`.
      const matchMap = new Map<
        number,
        Map<number, { readonly idxArg: number; readonly kind: "read" | "has" }>
      >();
      for (const m of matched) {
        let perBlock = matchMap.get(m.blockId);
        if (perBlock === undefined) {
          perBlock = new Map<
            number,
            { readonly idxArg: number; readonly kind: "read" | "has" }
          >();
          matchMap.set(m.blockId, perBlock);
        }
        perBlock.set(m.index, { idxArg: m.idxArg, kind: m.kind });
      }
      for (const [blockId, indices] of matchMap) {
        const orig = candBlocks[blockId];
        if (orig === undefined) continue;
        const nextInsts: Instruction[] = [];
        for (let i = 0; i < orig.instructions.length; i++) {
          const op = orig.instructions[i];
          if (op === undefined) continue;
          const hit = indices.get(i);
          if (hit !== undefined && op.kind === "call" && op.id !== undefined) {
            if (hit.kind === "has") {
              nextInsts.push({
                kind: "constant",
                id: op.id,
                value: true,
                start: op.start,
                end: op.end,
              });
            } else {
              const vArr = candNextValue++,
                vEl = candNextValue++;
              nextInsts.push(
                {
                  kind: "load",
                  id: vArr,
                  slot: valuesSlot,
                  start: op.start,
                  end: op.end,
                },
                {
                  kind: "array-element",
                  id: vEl,
                  array: vArr,
                  index: hit.idxArg,
                  start: op.start,
                  end: op.end,
                },
                {
                  kind: "optional-wrap",
                  id: op.id,
                  value: vEl,
                  start: op.start,
                  end: op.end,
                },
              );
            }
          } else {
            nextInsts.push(op);
          }
        }
        candBlocks[blockId] = { ...orig, instructions: nextInsts };
      }

      candNextValue = emitDenseGuardPreheader(
        candBlocks,
        preheaderId,
        preheader,
        listSlot,
        helper.header,
        presentSlot,
        valuesOptSlot,
        valuesSlot,
        rawLenSlot,
        lenSlot,
        loop.header,
        coldHeader,
        candNextValue,
      );

      const debug =
        fnIn.debug === undefined
          ? undefined
          : retainDebugValues(fnIn, candBlocks);
      const candidate: FunctionIR =
        debug === undefined
          ? { ...fnIn, slots: candSlots, blocks: candBlocks }
          : { ...fnIn, slots: candSlots, blocks: candBlocks, debug };

      if (!recordReadsKept(fnIn, candidate)) return undefined;
      return {
        fn: candidate,
        nextValue: candNextValue,
        rewritten: matched.length,
      };
    }

    function tryHoistPopLoop(
      fnIn: FunctionIR,
      loop: NaturalLoop,
      preheaderId: number,
      preheader: Block,
      startValueId: number,
    ):
      | {
          readonly fn: FunctionIR;
          readonly nextValue: number;
          readonly rewritten: number;
        }
      | undefined {
      const headerBlock = fnIn.blocks[loop.header];
      if (headerBlock === undefined || headerBlock.exception !== undefined)
        return undefined;
      const hTerm = headerBlock.terminator;
      if (
        hTerm.kind !== "branch" ||
        !loop.body.has(hTerm.consequent) ||
        loop.body.has(hTerm.alternate)
      )
        return undefined;

      const resolveVal = makeResolve(headerBlock);
      const condDef = resolveVal(hTerm.condition);
      if (condDef === undefined || condDef.kind !== "binary") return undefined;

      // Match `len > C` (C >= 0), `C < len` (C >= 0), `len >= C` (C >= 1), `C <= len` (C >= 1), or `len !== 0`.
      let boundExpr: Instruction | undefined;
      const lDef = resolveVal(condDef.left),
        rDef = resolveVal(condDef.right);
      const numConst = (op: Instruction | undefined): number | undefined => {
        if (op === undefined || op.kind !== "constant") return undefined;
        const v = op.value;
        return typeof v === "number" ? v : undefined;
      };
      const lc = numConst(lDef),
        rc = numConst(rDef);
      if (condDef.operator === ">" && rc !== undefined && rc >= 0)
        boundExpr = lDef;
      else if (condDef.operator === "<" && lc !== undefined && lc >= 0)
        boundExpr = rDef;
      else if (condDef.operator === ">=" && rc !== undefined && rc >= 1)
        boundExpr = lDef;
      else if (condDef.operator === "<=" && lc !== undefined && lc >= 1)
        boundExpr = rDef;
      else if (condDef.operator === "!==") {
        if (rc === 0) boundExpr = lDef;
        else if (lc === 0) boundExpr = rDef;
      }
      if (boundExpr === undefined) return undefined;

      let lenCall: Instruction | undefined, uint32Op: Instruction | undefined;
      if (boundExpr.kind === "unary" && boundExpr.operator === "uint32") {
        uint32Op = boundExpr;
        lenCall = resolveVal(boundExpr.operand);
      } else {
        lenCall = boundExpr;
      }
      if (
        lenCall === undefined ||
        lenCall.kind !== "call" ||
        lenCall.id === undefined
      )
        return undefined;
      const helper = lengthToHelper.get(lenCall.target);
      if (helper === undefined || helper.popFns.size === 0) return undefined;
      const listArg = lenCall.arguments[0];
      if (listArg === undefined) return undefined;
      const listDef = resolveVal(listArg);
      if (
        listDef === undefined ||
        listDef.kind !== "load" ||
        loop.writes.has(listDef.slot) ||
        fnIn.slots[listDef.slot] !== "reference"
      )
        return undefined;
      const listSlot = listDef.slot;
      const hIdx = headerIndex.get(helper.header);
      if (hIdx === undefined) return undefined;

      // Verify: single `popFn(listSlot)` in loop body, no other touches of header or listSlot, no throws/returns/exceptions.
      let totalInsts = 0,
        popBlockId = -1,
        popIndex = -1;
      const allowedPopHelpers = new Set<number>();
      for (const id of helper.lengthFns) allowedPopHelpers.add(id);
      for (const id of helper.popFns) allowedPopHelpers.add(id);
      for (const id of loop.body) {
        const block = fnIn.blocks[id];
        if (block === undefined || block.exception !== undefined)
          return undefined;
        totalInsts += block.instructions.length;
        if (totalInsts > maxHoistedLoopInstructions) return undefined;
        const bt = block.terminator;
        if (
          bt.kind === "throw" ||
          bt.kind === "throw-literal" ||
          bt.kind === "return"
        )
          return undefined;
        if (
          (bt.kind === "record" || bt.kind === "record-cell") &&
          bt.record === helper.header
        )
          return undefined;
        const localResolve = makeResolve(block);
        const allowedListLoadIds = new Set<number>();
        for (let i = 0; i < block.instructions.length; i++) {
          const op = block.instructions[i];
          if (op === undefined) continue;
          if (op.kind === "record-read" && op.record === helper.header)
            return undefined;
          if (op === lenCall && op.kind === "call" && id === loop.header) {
            const a0 = op.arguments[0];
            if (a0 !== undefined) allowedListLoadIds.add(a0);
            continue;
          }
          if (
            id !== loop.header &&
            op.kind === "call" &&
            op.id !== undefined &&
            helper.popFns.has(op.target)
          ) {
            const a0 = op.arguments[0];
            if (a0 === undefined) return undefined;
            const argDef = localResolve(a0);
            if (
              argDef === undefined ||
              argDef.kind !== "load" ||
              argDef.slot !== listSlot ||
              popBlockId >= 0
            )
              return undefined;
            popBlockId = id;
            popIndex = i;
            allowedListLoadIds.add(a0);
            continue;
          }
          if (
            opTouchesHeader(
              writeMasks,
              fnIn.id,
              id,
              op,
              hIdx,
              allowedPopHelpers,
            ) ||
            opTouchesHeader(
              readMasks,
              fnIn.id,
              id,
              op,
              hIdx,
              allowedPopHelpers,
            ) ||
            (op.kind === "call" && allowedPopHelpers.has(op.target))
          )
            return undefined;
        }
        // Reject any other use of `listSlot` inside this block.
        const listLoads = new Set<number>();
        for (const op of block.instructions) {
          if (op === undefined) continue;
          if (op.kind === "load" && op.slot === listSlot) listLoads.add(op.id);
          else if (
            op !== lenCall &&
            !(id === popBlockId && op === block.instructions[popIndex])
          ) {
            let bad = false;
            visitInstructionOperands(op, (v) => {
              if (listLoads.has(v)) bad = true;
            });
            if (bad) return undefined;
          }
        }
        let badTerm = false;
        visitTerminatorOperands(bt, (v) => {
          if (listLoads.has(v)) badTerm = true;
        });
        if (badTerm) return undefined;
      }
      if (popBlockId < 0) return undefined;

      // Ensure `popBlockId` cannot reach itself without going back through `loop.header`.
      const popB = fnIn.blocks[popBlockId];
      if (popB === undefined) return undefined;
      const seen = new Set<number>(),
        q: number[] = [];
      for (const s of blockSuccessors(popB))
        if (s !== undefined && s !== loop.header && loop.body.has(s)) {
          seen.add(s);
          q.push(s);
        }
      while (q.length > 0) {
        const cur = q.pop();
        if (cur === undefined) break;
        if (cur === popBlockId) return undefined;
        const b = fnIn.blocks[cur];
        if (b === undefined) return undefined;
        for (const s of blockSuccessors(b))
          if (
            s !== undefined &&
            s !== loop.header &&
            loop.body.has(s) &&
            !seen.has(s)
          ) {
            seen.add(s);
            q.push(s);
          }
      }

      const candSlots: ScalarType[] = fnIn.slots.slice(),
        presentSlot = candSlots.length;
      candSlots.push("optional-reference");
      const valuesOptSlot = candSlots.length;
      candSlots.push("optional-reference");
      const valuesSlot = candSlots.length;
      candSlots.push("Float64Array");
      const rawLenSlot = candSlots.length;
      candSlots.push("number");
      const lenSlot = candSlots.length;
      candSlots.push("number");
      // Separate write-back slot so `record write` does not disqualify `lenSlot`
      // from staying an integer register slot in codegen.
      const writeLenSlot = candSlots.length;
      candSlots.push("number");

      const candBlocks: Block[] = fnIn.blocks.slice();
      const cloned = cloneLoopColdCopy(fnIn, loop, candBlocks, startValueId);
      if (cloned === undefined) return undefined;
      let candNextValue = cloned.nextValue;
      const coldHeader = cloned.coldHeader;

      // Rewrite hot header: replace `lenCall` (and `uint32Op`) with `load(lenSlot)`.
      const hotHeaderInsts: Instruction[] = [];
      for (const op of headerBlock.instructions) {
        if (op === undefined) continue;
        if (op === lenCall && op.kind === "call" && op.id !== undefined) {
          hotHeaderInsts.push({
            kind: "load",
            id: op.id,
            slot: lenSlot,
            start: op.start,
            end: op.end,
          });
        } else if (
          uint32Op !== undefined &&
          op === uint32Op &&
          op.kind === "unary"
        ) {
          hotHeaderInsts.push({
            kind: "load",
            id: op.id,
            slot: lenSlot,
            start: op.start,
            end: op.end,
          });
        } else {
          hotHeaderInsts.push(op);
        }
      }
      candBlocks[loop.header] = {
        ...headerBlock,
        instructions: hotHeaderInsts,
      };

      // Rewrite `popFn(listSlot)` to decrement `lenSlot` and read unchecked `array-element`.
      const origPop = candBlocks[popBlockId];
      if (origPop === undefined) return undefined;
      const nextPopInsts: Instruction[] = [];
      for (let i = 0; i < origPop.instructions.length; i++) {
        const op = origPop.instructions[i];
        if (op === undefined) continue;
        if (i === popIndex && op.kind === "call" && op.id !== undefined) {
          const vLen = candNextValue++,
            vOne = candNextValue++,
            vNext = candNextValue++,
            vArr = candNextValue++,
            vEl = candNextValue++;
          nextPopInsts.push(
            {
              kind: "load",
              id: vLen,
              slot: lenSlot,
              start: op.start,
              end: op.end,
            },
            {
              kind: "constant",
              id: vOne,
              value: 1,
              start: op.start,
              end: op.end,
            },
            {
              kind: "binary",
              id: vNext,
              operator: "-",
              left: vLen,
              right: vOne,
              start: op.start,
              end: op.end,
            },
            {
              kind: "store",
              slot: lenSlot,
              value: vNext,
              start: op.start,
              end: op.end,
            },
            {
              kind: "load",
              id: vArr,
              slot: valuesSlot,
              start: op.start,
              end: op.end,
            },
            {
              kind: "array-element",
              id: vEl,
              array: vArr,
              index: vNext,
              start: op.start,
              end: op.end,
            },
            {
              kind: "optional-wrap",
              id: op.id,
              value: vEl,
              start: op.start,
              end: op.end,
            },
          );
        } else {
          nextPopInsts.push(op);
        }
      }
      candBlocks[popBlockId] = { ...origPop, instructions: nextPopInsts };

      // Route every hot loop exit edge through a single `list.length = lenSlot` write-back.
      const trapId = candBlocks.length;
      candBlocks.push({
        id: trapId,
        instructions: [],
        terminator: { kind: "trap", start: 0, end: 0 },
      });
      const exitWritebacks = new Map<number, number>();
      const writebackFor = (exitId: number): number => {
        const existing = exitWritebacks.get(exitId);
        if (existing !== undefined) return existing;
        const wbId = candBlocks.length,
          vLenWb = candNextValue++,
          vList = candNextValue++;
        candBlocks.push({
          id: wbId,
          instructions: [
            { kind: "load", id: vLenWb, slot: lenSlot, start: 0, end: 0 },
            {
              kind: "store",
              slot: writeLenSlot,
              value: vLenWb,
              start: 0,
              end: 0,
            },
            { kind: "load", id: vList, slot: listSlot, start: 0, end: 0 },
          ],
          terminator: {
            kind: "record",
            object: vList,
            record: helper.header,
            field: 0,
            operation: "write",
            slot: writeLenSlot,
            consequent: exitId,
            alternate: trapId,
            start: 0,
            end: 0,
          },
        });
        exitWritebacks.set(exitId, wbId);
        return wbId;
      };
      for (const id of loop.body) {
        const b = candBlocks[id];
        if (b === undefined) continue;
        candBlocks[id] = {
          ...b,
          terminator: retargetTerminator(b.terminator, (t) =>
            loop.body.has(t) ? t : writebackFor(t),
          ),
        };
      }

      candNextValue = emitDenseGuardPreheader(
        candBlocks,
        preheaderId,
        preheader,
        listSlot,
        helper.header,
        presentSlot,
        valuesOptSlot,
        valuesSlot,
        rawLenSlot,
        lenSlot,
        loop.header,
        coldHeader,
        candNextValue,
      );

      const debug =
        fnIn.debug === undefined
          ? undefined
          : retainDebugValues(fnIn, candBlocks);
      const candidate: FunctionIR =
        debug === undefined
          ? { ...fnIn, slots: candSlots, blocks: candBlocks }
          : { ...fnIn, slots: candSlots, blocks: candBlocks, debug };

      if (!recordReadsKept(fnIn, candidate)) return undefined;
      return { fn: candidate, nextValue: candNextValue, rewritten: 1 };
    }

    function tryHoistPushLoop(
      fnIn: FunctionIR,
      loop: NaturalLoop,
      preheaderId: number,
      preheader: Block,
      startValueId: number,
    ):
      | {
          readonly fn: FunctionIR;
          readonly nextValue: number;
          readonly rewritten: number;
        }
      | undefined {
      let totalInsts = 0,
        targetHelper: NumberListHelpers | undefined,
        targetListSlot = -1;
      const matchedPushes: {
        readonly blockId: number;
        readonly index: number;
        readonly targetFn: number;
        readonly valArg: number;
        readonly unwrappedVal: number | undefined;
        readonly resultId: number | undefined;
      }[] = [];

      // First pass: find all `pushFn(listSlot, valArg)` calls in loop body; require one listSlot & helper.
      for (const id of loop.body) {
        const block = fnIn.blocks[id];
        if (block === undefined || block.exception !== undefined)
          return undefined;
        totalInsts += block.instructions.length;
        if (totalInsts > maxHoistedLoopInstructions) return undefined;
        const bt = block.terminator;
        if (
          bt.kind === "throw" ||
          bt.kind === "throw-literal" ||
          bt.kind === "return"
        )
          return undefined;
        const defs = new Map<number, Instruction>(),
          slotVal = new Map<number, number>();
        const resolveLocal = (v: number): Instruction | undefined => {
          let cur = v;
          for (let d = 0; d < 6; d++) {
            const def = defs.get(cur);
            if (def === undefined) return undefined;
            if (def.kind === "load") {
              const s = slotVal.get(def.slot);
              if (s !== undefined) {
                cur = s;
                continue;
              }
            }
            return def;
          }
          return undefined;
        };
        for (let i = 0; i < block.instructions.length; i++) {
          const op = block.instructions[i];
          if (op === undefined) continue;
          const r = instructionResult(op);
          if (r !== undefined) defs.set(r, op);
          if (op.kind === "store") slotVal.set(op.slot, op.value);
          else if (op.kind === "call") {
            const h = pushToHelper.get(op.target);
            if (h === undefined) continue;
            const aList = op.arguments[0],
              aVal = op.arguments[1];
            if (aList === undefined || aVal === undefined) return undefined;
            const listOp = resolveLocal(aList);
            if (
              listOp === undefined ||
              listOp.kind !== "load" ||
              loop.writes.has(listOp.slot) ||
              fnIn.slots[listOp.slot] !== "reference"
            )
              return undefined;
            if (targetHelper === undefined) {
              targetHelper = h;
              targetListSlot = listOp.slot;
            } else if (
              targetHelper.header !== h.header ||
              targetListSlot !== listOp.slot
            )
              return undefined;
            const valDef = defs.get(aVal);
            const unwrappedVal =
              valDef !== undefined && valDef.kind === "optional-wrap"
                ? valDef.value
                : undefined;
            matchedPushes.push({
              blockId: id,
              index: i,
              targetFn: op.target,
              valArg: aVal,
              unwrappedVal,
              resultId: op.id,
            });
          }
        }
      }
      // Keep block splitting simple: require 1 matched push call per hoisted loop.
      if (
        targetHelper === undefined ||
        targetListSlot < 0 ||
        matchedPushes.length !== 1
      )
        return undefined;
      const push = matchedPushes[0];
      if (push === undefined) return undefined;
      const helper = targetHelper,
        listSlot = targetListSlot,
        hIdx = headerIndex.get(helper.header);
      if (hIdx === undefined) return undefined;

      // Second pass: verify no other operation in the loop reads/writes `header` or uses `listSlot`.
      for (const id of loop.body) {
        const block = fnIn.blocks[id];
        if (block === undefined) return undefined;
        const bt = block.terminator;
        if (
          (bt.kind === "record" || bt.kind === "record-cell") &&
          bt.record === helper.header
        )
          return undefined;
        const listLoads = new Set<number>();
        for (let i = 0; i < block.instructions.length; i++) {
          const op = block.instructions[i];
          if (op === undefined) continue;
          if (op.kind === "record-read" && op.record === helper.header)
            return undefined;
          if (id === push.blockId && i === push.index) continue;
          if (op.kind === "load" && op.slot === listSlot) {
            listLoads.add(op.id);
            continue;
          }
          if (
            opTouchesHeader(writeMasks, fnIn.id, id, op, hIdx) ||
            opTouchesHeader(readMasks, fnIn.id, id, op, hIdx)
          )
            return undefined;
          let usesList = false;
          visitInstructionOperands(op, (v) => {
            if (listLoads.has(v)) usesList = true;
          });
          if (usesList) return undefined;
        }
        let termUsesList = false;
        visitTerminatorOperands(bt, (v) => {
          if (listLoads.has(v)) termUsesList = true;
        });
        if (termUsesList) return undefined;
      }

      // Check whether `push.resultId` is used and whether any value defined before
      // the push call is live after it (SSA values are block-local, so splitting
      // requires reloading/rematerializing any live-across value).
      const pushBlock = fnIn.blocks[push.blockId];
      if (pushBlock === undefined) return undefined;
      const beforeDefs = new Map<
          number,
          { readonly op: Instruction; readonly index: number }
        >(),
        lastStoreBeforePush = new Map<number, number>();
      for (let i = 0; i < push.index; i++) {
        const op = pushBlock.instructions[i];
        if (op === undefined) continue;
        const r = instructionResult(op);
        if (r !== undefined) beforeDefs.set(r, { op, index: i });
        if (op.kind === "store") lastStoreBeforePush.set(op.slot, i);
      }
      let resultUsed = false;
      const liveAcross: number[] = [],
        liveSet = new Set<number>();
      const checkAfterUse = (v: number): void => {
        if (push.resultId !== undefined && v === push.resultId)
          resultUsed = true;
        else if (beforeDefs.has(v) && !liveSet.has(v)) {
          liveSet.add(v);
          liveAcross.push(v);
        }
      };
      for (let i = push.index + 1; i < pushBlock.instructions.length; i++) {
        const op = pushBlock.instructions[i];
        if (op !== undefined) visitInstructionOperands(op, checkAfterUse);
      }
      visitTerminatorOperands(pushBlock.terminator, checkAfterUse);
      for (const id of liveAcross) {
        const entry = beforeDefs.get(id);
        if (entry === undefined) return undefined;
        const defOp = entry.op;
        if (defOp.kind === "load") {
          if ((lastStoreBeforePush.get(defOp.slot) ?? -1) > entry.index)
            return undefined;
        } else if (defOp.kind !== "constant") return undefined;
      }

      const candSlots: ScalarType[] = fnIn.slots.slice(),
        presentSlot = candSlots.length;
      candSlots.push("optional-reference");
      const valuesOptSlot = candSlots.length;
      candSlots.push("optional-reference");
      const rawLenSlot = candSlots.length;
      candSlots.push("number");
      const lenSlot = candSlots.length;
      candSlots.push("number");
      const writeLenSlot = candSlots.length;
      candSlots.push("number");
      const capSlot = candSlots.length;
      candSlots.push("number");
      const pushValSlot = candSlots.length;
      candSlots.push(
        push.unwrappedVal !== undefined ? "number" : "optional-number",
      );
      const pushResSlot = resultUsed ? candSlots.length : -1;
      if (resultUsed) candSlots.push("number");

      const candBlocks: Block[] = fnIn.blocks.slice();
      const cloned = cloneLoopColdCopy(fnIn, loop, candBlocks, startValueId);
      if (cloned === undefined) return undefined;
      let candNextValue = cloned.nextValue;
      const coldHeader = cloned.coldHeader;

      const trapId = candBlocks.length;
      candBlocks.push({
        id: trapId,
        instructions: [],
        terminator: { kind: "trap", start: 0, end: 0 },
      });

      // Split `push.blockId` around the push call into:
      // before -> [checkPresent ->] checkCap -> fastPush | slowPush -> after.
      const beforeInsts = pushBlock.instructions.slice(0, push.index),
        rawAfterInsts = pushBlock.instructions.slice(push.index + 1);
      let afterInsts: Instruction[] = rawAfterInsts,
        afterTerm: Terminator = pushBlock.terminator;
      if (liveAcross.length > 0) {
        const liveSubst = new Uint32Array(candNextValue),
          reloaded: Instruction[] = [];
        for (const id of liveAcross) {
          const entry = beforeDefs.get(id);
          if (entry === undefined) return undefined;
          const fresh = candNextValue++;
          liveSubst[id] = fresh + 1;
          const defOp = entry.op;
          if (defOp.kind === "load")
            reloaded.push({
              kind: "load",
              id: fresh,
              slot: defOp.slot,
              start: defOp.start,
              end: defOp.end,
            });
          else if (defOp.kind === "constant")
            reloaded.push({ ...defOp, id: fresh });
          else return undefined;
        }
        for (const op of rawAfterInsts)
          if (op !== undefined)
            reloaded.push(substituteInstructionValues(op, liveSubst));
        afterInsts = reloaded;
        afterTerm = substituteTerminatorValues(pushBlock.terminator, liveSubst);
      }
      const checkCapId = candBlocks.length,
        fastPushId = checkCapId + 1,
        slowPushId = checkCapId + 2,
        slowCallId = checkCapId + 3,
        slowReadValId = checkCapId + 4,
        slowReadLenId = checkCapId + 5,
        slowUpdateId = checkCapId + 6,
        slowCapId = checkCapId + 7,
        slowZeroCapId = checkCapId + 8,
        afterId = checkCapId + 9;

      if (push.unwrappedVal !== undefined) {
        beforeInsts.push({
          kind: "store",
          slot: pushValSlot,
          value: push.unwrappedVal,
          start: 0,
          end: 0,
        });
        candBlocks[push.blockId] = {
          id: push.blockId,
          instructions: beforeInsts,
          terminator: { kind: "jump", target: checkCapId, start: 0, end: 0 },
        };
      } else {
        const vPres = candNextValue++;
        beforeInsts.push(
          {
            kind: "store",
            slot: pushValSlot,
            value: push.valArg,
            start: 0,
            end: 0,
          },
          {
            kind: "optional-present",
            id: vPres,
            value: push.valArg,
            start: 0,
            end: 0,
          },
        );
        candBlocks[push.blockId] = {
          id: push.blockId,
          instructions: beforeInsts,
          terminator: {
            kind: "branch",
            condition: vPres,
            consequent: checkCapId,
            alternate: slowPushId,
            start: 0,
            end: 0,
          },
        };
      }

      // checkCap: if (len < cap) goto fastPush else goto slowPush
      const vLenC = candNextValue++,
        vCapC = candNextValue++,
        vFitsC = candNextValue++;
      candBlocks.push({
        id: checkCapId,
        instructions: [
          { kind: "load", id: vLenC, slot: lenSlot, start: 0, end: 0 },
          { kind: "load", id: vCapC, slot: capSlot, start: 0, end: 0 },
          {
            kind: "binary",
            id: vFitsC,
            operator: "<",
            left: vLenC,
            right: vCapC,
            start: 0,
            end: 0,
          },
        ],
        terminator: {
          kind: "branch",
          condition: vFitsC,
          consequent: fastPushId,
          alternate: slowPushId,
          start: 0,
          end: 0,
        },
      });

      // fastPush: unchecked array-store + integer len++
      const vValOptF = candNextValue++,
        vArrF = candNextValue++,
        vLenF = candNextValue++,
        vValLoaded = candNextValue++;
      const fastInsts: Instruction[] = [
        { kind: "load", id: vValOptF, slot: valuesOptSlot, start: 0, end: 0 },
        {
          kind: "reference-value",
          id: vArrF,
          value: vValOptF,
          type: "Float64Array",
          start: 0,
          end: 0,
        },
        { kind: "load", id: vLenF, slot: lenSlot, start: 0, end: 0 },
        { kind: "load", id: vValLoaded, slot: pushValSlot, start: 0, end: 0 },
      ];
      let vNumF = vValLoaded;
      if (push.unwrappedVal === undefined) {
        vNumF = candNextValue++;
        fastInsts.push({
          kind: "optional-value",
          id: vNumF,
          value: vValLoaded,
          start: 0,
          end: 0,
        });
      }
      const vOneF = candNextValue++,
        vNextF = candNextValue++;
      fastInsts.push(
        {
          kind: "array-store",
          array: vArrF,
          index: vLenF,
          value: vNumF,
          start: 0,
          end: 0,
        },
        { kind: "constant", id: vOneF, value: 1, start: 0, end: 0 },
        {
          kind: "binary",
          id: vNextF,
          operator: "+",
          left: vLenF,
          right: vOneF,
          start: 0,
          end: 0,
        },
        { kind: "store", slot: lenSlot, value: vNextF, start: 0, end: 0 },
      );
      if (pushResSlot >= 0)
        fastInsts.push({
          kind: "store",
          slot: pushResSlot,
          value: vNextF,
          start: 0,
          end: 0,
        });
      // When the tail after `push` is a small in-loop jump (e.g. `i++; continue`),
      // duplicate it directly into `fastPushId` to eliminate an unconditional branch
      // per iteration on the hot path.
      let fastTerm: Terminator = {
        kind: "jump",
        target: afterId,
        start: 0,
        end: 0,
      };
      if (
        pushResSlot < 0 &&
        afterTerm.kind === "jump" &&
        loop.body.has(afterTerm.target) &&
        afterInsts.length <= 8
      ) {
        const afterSubst = new Uint32Array(candNextValue);
        for (const op of afterInsts) {
          if (op === undefined) continue;
          const s = substituteInstructionValues(op, afterSubst),
            r = instructionResult(op);
          if (r !== undefined) {
            const renamed = candNextValue++;
            afterSubst[r] = renamed + 1;
            fastInsts.push(renumberInstructionResult(s, renamed));
          } else {
            fastInsts.push(s);
          }
        }
        fastTerm = afterTerm;
      }
      candBlocks.push({
        id: fastPushId,
        instructions: fastInsts,
        terminator: fastTerm,
      });

      // slowPush: sync list.length = lenSlot, call original pushFn, reload values/cap/len
      const vLenS0 = candNextValue++,
        vListS0 = candNextValue++;
      candBlocks.push({
        id: slowPushId,
        instructions: [
          { kind: "load", id: vLenS0, slot: lenSlot, start: 0, end: 0 },
          {
            kind: "store",
            slot: writeLenSlot,
            value: vLenS0,
            start: 0,
            end: 0,
          },
          { kind: "load", id: vListS0, slot: listSlot, start: 0, end: 0 },
        ],
        terminator: {
          kind: "record",
          object: vListS0,
          record: helper.header,
          field: 0,
          operation: "write",
          slot: writeLenSlot,
          consequent: slowCallId,
          alternate: trapId,
          start: 0,
          end: 0,
        },
      });

      const vListS1 = candNextValue++,
        vValS = candNextValue++;
      const slowCallInsts: Instruction[] = [
        { kind: "load", id: vListS1, slot: listSlot, start: 0, end: 0 },
        { kind: "load", id: vValS, slot: pushValSlot, start: 0, end: 0 },
      ];
      let vArgS = vValS;
      if (push.unwrappedVal !== undefined) {
        vArgS = candNextValue++;
        slowCallInsts.push({
          kind: "optional-wrap",
          id: vArgS,
          value: vValS,
          start: 0,
          end: 0,
        });
      }
      const vResS = candNextValue++,
        slowCallArgs: number[] = [vListS1, vArgS];
      slowCallInsts.push({
        kind: "call",
        id: vResS,
        target: push.targetFn,
        arguments: slowCallArgs,
        start: 0,
        end: 0,
      });
      if (pushResSlot >= 0)
        slowCallInsts.push({
          kind: "store",
          slot: pushResSlot,
          value: vResS,
          start: 0,
          end: 0,
        });
      const vListS2 = candNextValue++;
      slowCallInsts.push({
        kind: "load",
        id: vListS2,
        slot: listSlot,
        start: 0,
        end: 0,
      });
      candBlocks.push({
        id: slowCallId,
        instructions: slowCallInsts,
        terminator: {
          kind: "record",
          object: vListS2,
          record: helper.header,
          field: 2,
          operation: "read",
          slot: presentSlot,
          consequent: slowReadValId,
          alternate: trapId,
          start: 0,
          end: 0,
        },
      });

      const vListS3 = candNextValue++;
      candBlocks.push({
        id: slowReadValId,
        instructions: [
          { kind: "load", id: vListS3, slot: listSlot, start: 0, end: 0 },
        ],
        terminator: {
          kind: "record",
          object: vListS3,
          record: helper.header,
          field: 1,
          operation: "read",
          slot: valuesOptSlot,
          consequent: slowReadLenId,
          alternate: trapId,
          start: 0,
          end: 0,
        },
      });

      const vListS4 = candNextValue++;
      candBlocks.push({
        id: slowReadLenId,
        instructions: [
          { kind: "load", id: vListS4, slot: listSlot, start: 0, end: 0 },
        ],
        terminator: {
          kind: "record",
          object: vListS4,
          record: helper.header,
          field: 0,
          operation: "read",
          slot: rawLenSlot,
          consequent: slowUpdateId,
          alternate: trapId,
          start: 0,
          end: 0,
        },
      });

      const vRawS = candNextValue++,
        vLenS = candNextValue++,
        vExactS = candNextValue++,
        vPresS = candNextValue++,
        vNoneS1 = candNextValue++,
        vDenseS = candNextValue++,
        vValS2 = candNextValue++,
        vNoneS2 = candNextValue++,
        vHasValS = candNextValue++;
      const slowCheckValId = afterId + 1,
        slowCheckExactId = afterId + 2;
      candBlocks.push({
        id: slowUpdateId,
        instructions: [
          { kind: "load", id: vRawS, slot: rawLenSlot, start: 0, end: 0 },
          {
            kind: "unary",
            id: vLenS,
            operator: "uint32",
            operand: vRawS,
            start: 0,
            end: 0,
          },
          { kind: "store", slot: lenSlot, value: vLenS, start: 0, end: 0 },
          { kind: "load", id: vPresS, slot: presentSlot, start: 0, end: 0 },
          { kind: "reference-none", id: vNoneS1, start: 0, end: 0 },
          {
            kind: "binary",
            id: vDenseS,
            operator: "===",
            left: vPresS,
            right: vNoneS1,
            start: 0,
            end: 0,
          },
        ],
        terminator: {
          kind: "branch",
          condition: vDenseS,
          consequent: slowCheckValId,
          alternate: slowZeroCapId,
          start: 0,
          end: 0,
        },
      });

      const vValCapS = candNextValue++,
        vArrCapS = candNextValue++,
        vArrLenS = candNextValue++;
      candBlocks.push({
        id: slowCapId,
        instructions: [
          { kind: "load", id: vValCapS, slot: valuesOptSlot, start: 0, end: 0 },
          {
            kind: "reference-value",
            id: vArrCapS,
            value: vValCapS,
            type: "Float64Array",
            start: 0,
            end: 0,
          },
          {
            kind: "array-length",
            id: vArrLenS,
            array: vArrCapS,
            start: 0,
            end: 0,
          },
          { kind: "store", slot: capSlot, value: vArrLenS, start: 0, end: 0 },
        ],
        terminator: { kind: "jump", target: afterId, start: 0, end: 0 },
      });

      const vZeroCapS = candNextValue++;
      candBlocks.push({
        id: slowZeroCapId,
        instructions: [
          { kind: "constant", id: vZeroCapS, value: 0, start: 0, end: 0 },
          { kind: "store", slot: capSlot, value: vZeroCapS, start: 0, end: 0 },
        ],
        terminator: { kind: "jump", target: afterId, start: 0, end: 0 },
      });

      const afterFinalInsts: Instruction[] = [];
      if (pushResSlot >= 0 && push.resultId !== undefined)
        afterFinalInsts.push({
          kind: "load",
          id: push.resultId,
          slot: pushResSlot,
          start: 0,
          end: 0,
        });
      for (const op of afterInsts)
        if (op !== undefined) afterFinalInsts.push(op);
      candBlocks.push({
        id: afterId,
        instructions: afterFinalInsts,
        terminator: afterTerm,
      });

      candBlocks.push({
        id: slowCheckValId,
        instructions: [
          { kind: "load", id: vValS2, slot: valuesOptSlot, start: 0, end: 0 },
          { kind: "reference-none", id: vNoneS2, start: 0, end: 0 },
          {
            kind: "binary",
            id: vHasValS,
            operator: "!==",
            left: vValS2,
            right: vNoneS2,
            start: 0,
            end: 0,
          },
        ],
        terminator: {
          kind: "branch",
          condition: vHasValS,
          consequent: slowCheckExactId,
          alternate: slowZeroCapId,
          start: 0,
          end: 0,
        },
      });

      const vRawS2 = candNextValue++,
        vLenS2 = candNextValue++;
      candBlocks.push({
        id: slowCheckExactId,
        instructions: [
          { kind: "load", id: vRawS2, slot: rawLenSlot, start: 0, end: 0 },
          { kind: "load", id: vLenS2, slot: lenSlot, start: 0, end: 0 },
          {
            kind: "binary",
            id: vExactS,
            operator: "===",
            left: vLenS2,
            right: vRawS2,
            start: 0,
            end: 0,
          },
        ],
        terminator: {
          kind: "branch",
          condition: vExactS,
          consequent: slowCapId,
          alternate: slowZeroCapId,
          start: 0,
          end: 0,
        },
      });
      // Route every hot loop exit edge through a single `list.length = lenSlot` write-back.
      const hotBodyIds = new Set<number>();
      for (const id of loop.body) hotBodyIds.add(id);
      hotBodyIds.add(afterId);
      const exitWritebacks = new Map<number, number>();
      const writebackFor = (exitId: number): number => {
        const existing = exitWritebacks.get(exitId);
        if (existing !== undefined) return existing;
        const wbId = candBlocks.length,
          vLenWb = candNextValue++,
          vList = candNextValue++;
        candBlocks.push({
          id: wbId,
          instructions: [
            { kind: "load", id: vLenWb, slot: lenSlot, start: 0, end: 0 },
            {
              kind: "store",
              slot: writeLenSlot,
              value: vLenWb,
              start: 0,
              end: 0,
            },
            { kind: "load", id: vList, slot: listSlot, start: 0, end: 0 },
          ],
          terminator: {
            kind: "record",
            object: vList,
            record: helper.header,
            field: 0,
            operation: "write",
            slot: writeLenSlot,
            consequent: exitId,
            alternate: trapId,
            start: 0,
            end: 0,
          },
        });
        exitWritebacks.set(exitId, wbId);
        return wbId;
      };
      for (const id of hotBodyIds) {
        const b = candBlocks[id];
        if (b === undefined) continue;
        candBlocks[id] = {
          ...b,
          terminator: retargetTerminator(b.terminator, (t) =>
            loop.body.has(t) ||
            t === checkCapId ||
            t === fastPushId ||
            t === slowPushId ||
            t === afterId
              ? t
              : writebackFor(t),
          ),
        };
      }

      // Preheader guard: present === none && uint32(length) === length && len <= (values ? values.length : 0).
      const g1 = candBlocks.length,
        g2 = g1 + 1,
        g3 = g1 + 2,
        g4 = g1 + 3,
        g5 = g1 + 4,
        gCapSome = g1 + 5,
        gCapZero = g1 + 6,
        gCheckFits = g1 + 7,
        hotPre = g1 + 8,
        coldPre = g1 + 9;

      const vList0 = candNextValue++;
      const preInsts = preheader.instructions.slice();
      preInsts.push({
        kind: "load",
        id: vList0,
        slot: listSlot,
        start: 0,
        end: 0,
      });
      candBlocks[preheaderId] = {
        ...preheader,
        instructions: preInsts,
        terminator: {
          kind: "record",
          object: vList0,
          record: helper.header,
          field: 2,
          operation: "read",
          slot: presentSlot,
          consequent: g1,
          alternate: coldPre,
          start: 0,
          end: 0,
        },
      };

      const vPres0 = candNextValue++,
        vNone0 = candNextValue++,
        vDense0 = candNextValue++;
      candBlocks.push({
        id: g1,
        instructions: [
          { kind: "load", id: vPres0, slot: presentSlot, start: 0, end: 0 },
          { kind: "reference-none", id: vNone0, start: 0, end: 0 },
          {
            kind: "binary",
            id: vDense0,
            operator: "===",
            left: vPres0,
            right: vNone0,
            start: 0,
            end: 0,
          },
        ],
        terminator: {
          kind: "branch",
          condition: vDense0,
          consequent: g2,
          alternate: coldPre,
          start: 0,
          end: 0,
        },
      });

      const vList1 = candNextValue++;
      candBlocks.push({
        id: g2,
        instructions: [
          { kind: "load", id: vList1, slot: listSlot, start: 0, end: 0 },
        ],
        terminator: {
          kind: "record",
          object: vList1,
          record: helper.header,
          field: 1,
          operation: "read",
          slot: valuesOptSlot,
          consequent: g3,
          alternate: coldPre,
          start: 0,
          end: 0,
        },
      });

      const vList2 = candNextValue++;
      candBlocks.push({
        id: g3,
        instructions: [
          { kind: "load", id: vList2, slot: listSlot, start: 0, end: 0 },
        ],
        terminator: {
          kind: "record",
          object: vList2,
          record: helper.header,
          field: 0,
          operation: "read",
          slot: rawLenSlot,
          consequent: g4,
          alternate: coldPre,
          start: 0,
          end: 0,
        },
      });

      const vRaw0 = candNextValue++,
        vUint0 = candNextValue++,
        vExact0 = candNextValue++;
      candBlocks.push({
        id: g4,
        instructions: [
          { kind: "load", id: vRaw0, slot: rawLenSlot, start: 0, end: 0 },
          {
            kind: "unary",
            id: vUint0,
            operator: "uint32",
            operand: vRaw0,
            start: 0,
            end: 0,
          },
          { kind: "store", slot: lenSlot, value: vUint0, start: 0, end: 0 },
          {
            kind: "binary",
            id: vExact0,
            operator: "===",
            left: vUint0,
            right: vRaw0,
            start: 0,
            end: 0,
          },
        ],
        terminator: {
          kind: "branch",
          condition: vExact0,
          consequent: g5,
          alternate: coldPre,
          start: 0,
          end: 0,
        },
      });

      const vValOpt0 = candNextValue++,
        vNoneVal0 = candNextValue++,
        vHasVal0 = candNextValue++;
      candBlocks.push({
        id: g5,
        instructions: [
          { kind: "load", id: vValOpt0, slot: valuesOptSlot, start: 0, end: 0 },
          { kind: "reference-none", id: vNoneVal0, start: 0, end: 0 },
          {
            kind: "binary",
            id: vHasVal0,
            operator: "!==",
            left: vValOpt0,
            right: vNoneVal0,
            start: 0,
            end: 0,
          },
        ],
        terminator: {
          kind: "branch",
          condition: vHasVal0,
          consequent: gCapSome,
          alternate: gCapZero,
          start: 0,
          end: 0,
        },
      });

      const vValOpt1 = candNextValue++,
        vArr0 = candNextValue++,
        vCap0 = candNextValue++;
      candBlocks.push({
        id: gCapSome,
        instructions: [
          { kind: "load", id: vValOpt1, slot: valuesOptSlot, start: 0, end: 0 },
          {
            kind: "reference-value",
            id: vArr0,
            value: vValOpt1,
            type: "Float64Array",
            start: 0,
            end: 0,
          },
          { kind: "array-length", id: vCap0, array: vArr0, start: 0, end: 0 },
          { kind: "store", slot: capSlot, value: vCap0, start: 0, end: 0 },
        ],
        terminator: { kind: "jump", target: gCheckFits, start: 0, end: 0 },
      });

      const vZero0 = candNextValue++;
      candBlocks.push({
        id: gCapZero,
        instructions: [
          { kind: "constant", id: vZero0, value: 0, start: 0, end: 0 },
          { kind: "store", slot: capSlot, value: vZero0, start: 0, end: 0 },
        ],
        terminator: { kind: "jump", target: gCheckFits, start: 0, end: 0 },
      });

      const vLenG = candNextValue++,
        vCapG = candNextValue++,
        vFitsG = candNextValue++;
      candBlocks.push({
        id: gCheckFits,
        instructions: [
          { kind: "load", id: vLenG, slot: lenSlot, start: 0, end: 0 },
          { kind: "load", id: vCapG, slot: capSlot, start: 0, end: 0 },
          {
            kind: "binary",
            id: vFitsG,
            operator: "<=",
            left: vLenG,
            right: vCapG,
            start: 0,
            end: 0,
          },
        ],
        terminator: {
          kind: "branch",
          condition: vFitsG,
          consequent: hotPre,
          alternate: coldPre,
          start: 0,
          end: 0,
        },
      });

      candBlocks.push({
        id: hotPre,
        instructions: [],
        terminator: { kind: "jump", target: loop.header, start: 0, end: 0 },
      });
      candBlocks.push({
        id: coldPre,
        instructions: [],
        terminator: { kind: "jump", target: coldHeader, start: 0, end: 0 },
      });

      const debug =
        fnIn.debug === undefined
          ? undefined
          : retainDebugValues(fnIn, candBlocks);
      const candidate: FunctionIR =
        debug === undefined
          ? { ...fnIn, slots: candSlots, blocks: candBlocks }
          : { ...fnIn, slots: candSlots, blocks: candBlocks, debug };

      if (!recordReadsKept(fnIn, candidate)) return undefined;
      return { fn: candidate, nextValue: candNextValue, rewritten: 1 };
    }
  }
}

/** Emits preheader guards verifying `present === undefined && values !== undefined
 * && uint32(length) === length && uint32(length) <= values.length`, populating
 * `valuesSlot` and `lenSlot` before jumping to `hotTarget` (or `coldHeader`). */
function emitDenseGuardPreheader(
  candBlocks: Block[],
  preheaderId: number,
  preheader: Block,
  listSlot: number,
  headerRecord: number,
  presentSlot: number,
  valuesOptSlot: number,
  valuesSlot: number,
  rawLenSlot: number,
  lenSlot: number,
  hotTarget: number,
  coldHeader: number,
  startValueId: number,
): number {
  let nextValue = startValueId;
  const g1 = candBlocks.length,
    g2 = g1 + 1,
    g3 = g1 + 2,
    g4 = g1 + 3,
    g5 = g1 + 4,
    g6 = g1 + 5,
    hotPre = g1 + 6,
    coldPre = g1 + 7;

  const vList0 = nextValue++;
  const preInsts = preheader.instructions.slice();
  preInsts.push({ kind: "load", id: vList0, slot: listSlot, start: 0, end: 0 });
  candBlocks[preheaderId] = {
    ...preheader,
    instructions: preInsts,
    terminator: {
      kind: "record",
      object: vList0,
      record: headerRecord,
      field: 2,
      operation: "read",
      slot: presentSlot,
      consequent: g1,
      alternate: coldPre,
      start: 0,
      end: 0,
    },
  };

  const vPres = nextValue++,
    vNone1 = nextValue++,
    vDense = nextValue++;
  candBlocks.push({
    id: g1,
    instructions: [
      { kind: "load", id: vPres, slot: presentSlot, start: 0, end: 0 },
      { kind: "reference-none", id: vNone1, start: 0, end: 0 },
      {
        kind: "binary",
        id: vDense,
        operator: "===",
        left: vPres,
        right: vNone1,
        start: 0,
        end: 0,
      },
    ],
    terminator: {
      kind: "branch",
      condition: vDense,
      consequent: g2,
      alternate: coldPre,
      start: 0,
      end: 0,
    },
  });

  const vList1 = nextValue++;
  candBlocks.push({
    id: g2,
    instructions: [
      { kind: "load", id: vList1, slot: listSlot, start: 0, end: 0 },
    ],
    terminator: {
      kind: "record",
      object: vList1,
      record: headerRecord,
      field: 1,
      operation: "read",
      slot: valuesOptSlot,
      consequent: g3,
      alternate: coldPre,
      start: 0,
      end: 0,
    },
  });

  const vValOpt = nextValue++,
    vNone2 = nextValue++,
    vHasVal = nextValue++;
  candBlocks.push({
    id: g3,
    instructions: [
      { kind: "load", id: vValOpt, slot: valuesOptSlot, start: 0, end: 0 },
      { kind: "reference-none", id: vNone2, start: 0, end: 0 },
      {
        kind: "binary",
        id: vHasVal,
        operator: "!==",
        left: vValOpt,
        right: vNone2,
        start: 0,
        end: 0,
      },
    ],
    terminator: {
      kind: "branch",
      condition: vHasVal,
      consequent: g4,
      alternate: coldPre,
      start: 0,
      end: 0,
    },
  });

  const vList2 = nextValue++;
  candBlocks.push({
    id: g4,
    instructions: [
      { kind: "load", id: vList2, slot: listSlot, start: 0, end: 0 },
    ],
    terminator: {
      kind: "record",
      object: vList2,
      record: headerRecord,
      field: 0,
      operation: "read",
      slot: rawLenSlot,
      consequent: g5,
      alternate: coldPre,
      start: 0,
      end: 0,
    },
  });

  const vValOpt2 = nextValue++,
    vArr = nextValue++,
    vRawLen = nextValue++,
    vUintLen = nextValue++,
    vExact = nextValue++;
  candBlocks.push({
    id: g5,
    instructions: [
      { kind: "load", id: vValOpt2, slot: valuesOptSlot, start: 0, end: 0 },
      {
        kind: "reference-value",
        id: vArr,
        value: vValOpt2,
        type: "Float64Array",
        start: 0,
        end: 0,
      },
      { kind: "store", slot: valuesSlot, value: vArr, start: 0, end: 0 },
      { kind: "load", id: vRawLen, slot: rawLenSlot, start: 0, end: 0 },
      {
        kind: "unary",
        id: vUintLen,
        operator: "uint32",
        operand: vRawLen,
        start: 0,
        end: 0,
      },
      { kind: "store", slot: lenSlot, value: vUintLen, start: 0, end: 0 },
      {
        kind: "binary",
        id: vExact,
        operator: "===",
        left: vUintLen,
        right: vRawLen,
        start: 0,
        end: 0,
      },
    ],
    terminator: {
      kind: "branch",
      condition: vExact,
      consequent: g6,
      alternate: coldPre,
      start: 0,
      end: 0,
    },
  });

  const vArr2 = nextValue++,
    vCap = nextValue++,
    vLen = nextValue++,
    vFits = nextValue++;
  candBlocks.push({
    id: g6,
    instructions: [
      { kind: "load", id: vArr2, slot: valuesSlot, start: 0, end: 0 },
      { kind: "array-length", id: vCap, array: vArr2, start: 0, end: 0 },
      { kind: "load", id: vLen, slot: lenSlot, start: 0, end: 0 },
      {
        kind: "binary",
        id: vFits,
        operator: "<=",
        left: vLen,
        right: vCap,
        start: 0,
        end: 0,
      },
    ],
    terminator: {
      kind: "branch",
      condition: vFits,
      consequent: hotPre,
      alternate: coldPre,
      start: 0,
      end: 0,
    },
  });

  candBlocks.push({
    id: hotPre,
    instructions: [],
    terminator: { kind: "jump", target: hotTarget, start: 0, end: 0 },
  });
  candBlocks.push({
    id: coldPre,
    instructions: [],
    terminator: { kind: "jump", target: coldHeader, start: 0, end: 0 },
  });
  return nextValue;
}

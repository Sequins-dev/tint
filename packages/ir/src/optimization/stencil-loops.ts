import {
  blockSuccessors,
  dominates,
  immediateDominators,
  instructionResult,
  isNativeTypedArray,
  naturalLoops,
  recordReadsKept,
  renumberInstructionResult,
  retainDebugValues,
  substituteInstructionValues,
  substituteTerminatorValues,
  type Block,
  type FunctionIR,
  type Instruction,
  type NaturalLoop,
  type ScalarType,
  type Terminator,
} from "../scalar/index.ts";
import type { RemarkSink } from "./observer.ts";

export interface StencilLoopResult {
  readonly fn: FunctionIR;
  readonly visited: number;
  readonly rewritten: number;
}

function isPureHeaderBlock(block: Block): boolean {
  if (block.exception !== undefined || block.instructions.length > 16)
    return false;
  for (const op of block.instructions) {
    if (op === undefined) return false;
    if (
      op.kind !== "load" &&
      op.kind !== "constant" &&
      op.kind !== "binary" &&
      op.kind !== "unary" &&
      op.kind !== "array-length" &&
      op.kind !== "string-length"
    )
      return false;
  }
  return block.terminator.kind === "branch";
}

/** Supported typed-array kinds whose write->read round trip has an exact scalar
 * representation without lossy floating-point rounding or clamping. */
function supportedStencilArray(type: ScalarType | undefined): boolean {
  return (
    type === "Float64Array" ||
    type === "Uint8Array" ||
    type === "Int8Array" ||
    type === "Uint16Array" ||
    type === "Int16Array" ||
    type === "Uint32Array" ||
    type === "Int32Array"
  );
}

/** Emits the exact typed-array element narrowing for `valueId` (matching
 * ECMAScript's ToUint8/ToInt8/ToUint16/ToInt16/ToUint32/ToInt32 or Float64
 * identity), reusing `valueId` directly when it is already appropriately masked. */
function emitNarrowedElement(
  type: ScalarType,
  valueId: number,
  defs: ReadonlyMap<number, Instruction>,
  out: Instruction[],
  fresh: () => number,
): number {
  if (type === "Float64Array") return valueId;
  const def = defs.get(valueId);
  const isMask = (mask: number): boolean => {
    if (def === undefined || def.kind !== "binary" || def.operator !== "&")
      return false;
    const l = defs.get(def.left),
      r = defs.get(def.right);
    return (
      (l !== undefined && l.kind === "constant" && l.value === mask) ||
      (r !== undefined && r.kind === "constant" && r.value === mask)
    );
  };
  if (type === "Uint8Array") {
    if (isMask(255)) return valueId;
    const c = fresh(),
      r = fresh();
    out.push(
      { kind: "constant", id: c, value: 255, start: 0, end: 0 },
      {
        kind: "binary",
        id: r,
        operator: "&",
        left: valueId,
        right: c,
        start: 0,
        end: 0,
      },
    );
    return r;
  }
  if (type === "Uint16Array") {
    if (isMask(65535)) return valueId;
    const c = fresh(),
      r = fresh();
    out.push(
      { kind: "constant", id: c, value: 65535, start: 0, end: 0 },
      {
        kind: "binary",
        id: r,
        operator: "&",
        left: valueId,
        right: c,
        start: 0,
        end: 0,
      },
    );
    return r;
  }
  if (type === "Uint32Array") {
    if (def !== undefined && def.kind === "binary" && def.operator === ">>>") {
      const r = defs.get(def.right);
      if (r !== undefined && r.kind === "constant" && r.value === 0)
        return valueId;
    }
    const c = fresh(),
      r = fresh();
    out.push(
      { kind: "constant", id: c, value: 0, start: 0, end: 0 },
      {
        kind: "binary",
        id: r,
        operator: ">>>",
        left: valueId,
        right: c,
        start: 0,
        end: 0,
      },
    );
    return r;
  }
  if (type === "Int32Array") {
    if (
      def !== undefined &&
      def.kind === "binary" &&
      (def.operator === "|" ||
        def.operator === "&" ||
        def.operator === "^" ||
        def.operator === "<<" ||
        def.operator === ">>" ||
        def.operator === "imul")
    )
      return valueId;
    const c = fresh(),
      r = fresh();
    out.push(
      { kind: "constant", id: c, value: 0, start: 0, end: 0 },
      {
        kind: "binary",
        id: r,
        operator: "|",
        left: valueId,
        right: c,
        start: 0,
        end: 0,
      },
    );
    return r;
  }
  const shift = type === "Int8Array" ? 24 : 16;
  const c1 = fresh(),
    s1 = fresh(),
    c2 = fresh(),
    s2 = fresh();
  out.push(
    { kind: "constant", id: c1, value: shift, start: 0, end: 0 },
    {
      kind: "binary",
      id: s1,
      operator: "<<",
      left: valueId,
      right: c1,
      start: 0,
      end: 0,
    },
    { kind: "constant", id: c2, value: shift, start: 0, end: 0 },
    {
      kind: "binary",
      id: s2,
      operator: ">>",
      left: s1,
      right: c2,
      start: 0,
      end: 0,
    },
  );
  return s2;
}

/** Matches `load(counterSlot) + delta` or `load(counterSlot) - (-delta)` in
 * `defs`, returning `delta` in `{-1, 0, 1}` or undefined. */
function matchCounterOffset(
  valueId: number,
  counterSlot: number,
  defs: ReadonlyMap<number, Instruction>,
): -1 | 0 | 1 | undefined {
  const def = defs.get(valueId);
  if (def === undefined) return undefined;
  if (def.kind === "load" && def.slot === counterSlot) return 0;
  if (def.kind !== "binary" || (def.operator !== "+" && def.operator !== "-"))
    return undefined;
  const l = defs.get(def.left),
    r = defs.get(def.right);
  if (
    l !== undefined &&
    l.kind === "load" &&
    l.slot === counterSlot &&
    r !== undefined &&
    r.kind === "constant" &&
    r.value === 1
  )
    return def.operator === "+" ? 1 : -1;
  if (
    def.operator === "+" &&
    r !== undefined &&
    r.kind === "load" &&
    r.slot === counterSlot &&
    l !== undefined &&
    l.kind === "constant" &&
    l.value === 1
  )
    return 1;
  return undefined;
}

/** Scalar-replaces loop-carried typed-array stencil and prefix-recurrence loads:
 * in a unit-stride loop (`i++`) with a single `array-store(A, i, next)` and no
 * other memory writes or calls, carries `prev = A[i - 1]` (and `curr = A[i]`
 * when `A[i]` and `A[i + 1]` are also read before the store) in scalar slots
 * initialized behind a cloned preheader loop-entry guard. Eliminates the
 * cross-iteration store-to-load forwarding stall and redundant loads while
 * leaving 0-iteration loops untouched. */
export function scalarizeStencilLoops(
  fn: FunctionIR,
  budget: number,
  remarks?: RemarkSink,
): StencilLoopResult | undefined {
  if (budget < 0) return undefined;
  const forest = naturalLoops(fn, budget);
  if (forest === undefined) return undefined;
  let visited = forest.visited;
  if (forest.loops.length === 0) return { fn, visited, rewritten: 0 };

  let nextValue = 0;
  for (const block of fn.blocks) {
    if (block === undefined) return undefined;
    for (const op of block.instructions) {
      if (op === undefined) return undefined;
      const r = instructionResult(op);
      if (r !== undefined && r >= nextValue) nextValue = r + 1;
    }
  }

  // Process innermost loops first.
  const loops: NaturalLoop[] = [];
  for (const loop of forest.loops) {
    if (loop === undefined) continue;
    let at = loops.length;
    while (at > 0 && (loops[at - 1]?.body.size ?? 0) > loop.body.size) at--;
    loops.splice(at, 0, loop);
  }

  let current = fn,
    rewritten = 0;
  const touched = new Set<number>();

  for (const loop of loops) {
    if (loop === undefined) continue;
    let overlap = false;
    for (const id of loop.body) if (touched.has(id)) overlap = true;
    if (overlap) continue;

    // Build predecessors on `current` for this loop's check.
    const predecessors: number[][] = [];
    for (let i = 0; i < current.blocks.length; i++) predecessors.push([]);
    for (const block of current.blocks) {
      if (block === undefined) return undefined;
      for (const succ of blockSuccessors(block))
        predecessors[succ]?.push(block.id);
      if (block.exception !== undefined)
        predecessors[block.exception.target]?.push(block.id);
    }

    const outside = (predecessors[loop.header] ?? []).filter(
      (id) => !loop.body.has(id),
    );
    const preheaderId = outside[0];
    if (
      outside.length !== 1 ||
      preheaderId === undefined ||
      touched.has(preheaderId)
    )
      continue;
    const preheader = current.blocks[preheaderId],
      headerBlock = current.blocks[loop.header];
    if (
      preheader === undefined ||
      headerBlock === undefined ||
      preheader.exception !== undefined ||
      !isPureHeaderBlock(headerBlock)
    )
      continue;
    const preTerm = preheader.terminator;
    if (preTerm.kind !== "jump" || preTerm.target !== loop.header) continue;
    const hTerm = headerBlock.terminator;
    if (
      hTerm.kind !== "branch" ||
      !loop.body.has(hTerm.consequent) ||
      loop.body.has(hTerm.alternate)
    )
      continue;
    let irreducible = false;
    for (const id of loop.body) {
      if (id === loop.header) continue;
      if ((predecessors[id] ?? []).some((p) => !loop.body.has(p))) {
        irreducible = true;
        break;
      }
    }
    if (irreducible) continue;

    const exitTarget = hTerm.alternate;
    // Match `counter < bound` in headerBlock.
    const headerDefs = new Map<number, Instruction>();
    for (const op of headerBlock.instructions) {
      if (op === undefined) continue;
      const r = instructionResult(op);
      if (r !== undefined) headerDefs.set(r, op);
    }
    const condOp = headerDefs.get(hTerm.condition);
    if (condOp === undefined || condOp.kind !== "binary") continue;
    let counterLoad: Instruction | undefined;
    if (condOp.operator === "<" || condOp.operator === "<=")
      counterLoad = headerDefs.get(condOp.left);
    else if (condOp.operator === ">" || condOp.operator === ">=")
      counterLoad = headerDefs.get(condOp.right);
    if (
      counterLoad === undefined ||
      counterLoad.kind !== "load" ||
      current.slots[counterLoad.slot] !== "number"
    )
      continue;
    const counterSlot = counterLoad.slot;

    // Inspect loop body: no calls/throws/exits other than exitTarget, exactly
    // one `array-store`, no other array/memory writes, single unit-stride
    // `counter = counter + 1` after the store.
    let valid = true,
      storeBlockId = -1,
      storeIndex = -1,
      stepBlockId = -1,
      stepIndex = -1,
      arrSlot = -1,
      storedValId = -1;
    for (const id of loop.body) {
      const block = current.blocks[id];
      if (block === undefined || block.exception !== undefined) {
        valid = false;
        break;
      }
      visited += block.instructions.length + 1;
      if (visited > budget) return undefined;
      const t = block.terminator;
      if (
        t.kind === "throw" ||
        t.kind === "throw-literal" ||
        t.kind === "return" ||
        t.kind === "trap"
      ) {
        valid = false;
        break;
      }
      for (const succ of blockSuccessors(block))
        if (!loop.body.has(succ) && succ !== exitTarget) {
          valid = false;
          break;
        }
      if (!valid) break;
      if (
        (t.kind === "record" ||
          t.kind === "record-cell" ||
          t.kind === "cell") &&
        t.operation !== "read" &&
        t.slot === counterSlot
      ) {
        valid = false;
        break;
      }
      if (
        (t.kind === "record" ||
          t.kind === "record-cell" ||
          t.kind === "cell") &&
        t.operation === "read" &&
        t.slot === counterSlot
      ) {
        valid = false;
        break;
      }
      const defs = new Map<number, Instruction>();
      for (let i = 0; i < block.instructions.length; i++) {
        const op = block.instructions[i];
        if (op === undefined) {
          valid = false;
          break;
        }
        const r = instructionResult(op);
        if (r !== undefined) defs.set(r, op);
        if (
          op.kind === "call" ||
          op.kind === "call-indirect" ||
          op.kind === "host-call" ||
          op.kind === "c-call" ||
          op.kind === "array-write" ||
          op.kind === "array-copy" ||
          op.kind === "array-fill"
        ) {
          valid = false;
          break;
        }
        if (op.kind === "store" && op.slot === counterSlot) {
          if (id === loop.header || stepBlockId >= 0) {
            valid = false;
            break;
          }
          if (matchCounterOffset(op.value, counterSlot, defs) !== 1) {
            valid = false;
            break;
          }
          stepBlockId = id;
          stepIndex = i;
        } else if (op.kind === "array-store") {
          if (id === loop.header || storeBlockId >= 0) {
            valid = false;
            break;
          }
          const arrDef = defs.get(op.array);
          if (
            arrDef === undefined ||
            arrDef.kind !== "load" ||
            loop.writes.has(arrDef.slot) ||
            !isNativeTypedArray(current.slots[arrDef.slot]) ||
            !supportedStencilArray(current.slots[arrDef.slot])
          ) {
            valid = false;
            break;
          }
          if (matchCounterOffset(op.index, counterSlot, defs) !== 0) {
            valid = false;
            break;
          }
          storeBlockId = id;
          storeIndex = i;
          arrSlot = arrDef.slot;
          storedValId = op.value;
        }
      }
      if (!valid) break;
    }
    if (!valid || storeBlockId < 0 || stepBlockId < 0 || arrSlot < 0) continue;

    // Require `storeBlock` and `stepBlock` to execute on every iteration
    // (dominate all latches), and `store` to execute before `step` in the
    // iteration.
    const doms = immediateDominators(current, Math.max(1, budget - visited));
    if (doms === undefined) return undefined;
    visited += doms.visited;
    const alwaysRuns = (blockId: number): boolean =>
      loop.latches.every((latch) =>
        dominates(doms, current.entry, blockId, latch),
      );
    if (!alwaysRuns(storeBlockId) || !alwaysRuns(stepBlockId)) continue;
    if (storeBlockId === stepBlockId && stepIndex <= storeIndex) continue;
    if (
      storeBlockId !== stepBlockId &&
      !dominates(doms, current.entry, storeBlockId, stepBlockId)
    )
      continue;
    // No array-element reads of `arrSlot` in blocks other than `storeBlock`.
    let otherArrayRead = false;
    for (const id of loop.body) {
      if (id === storeBlockId) continue;
      const b = current.blocks[id];
      if (b === undefined) {
        otherArrayRead = true;
        break;
      }
      for (const op of b.instructions)
        if (
          op !== undefined &&
          (op.kind === "array-element" || op.kind === "array-read")
        ) {
          otherArrayRead = true;
          break;
        }
      if (otherArrayRead) break;
    }
    if (otherArrayRead) continue;

    // Scan `storeBlock` for `array-element(arrSlot, counter + delta)` before
    // `storeIndex`. Reject any read of `arrSlot` after `storeIndex`.
    const storeBlock = current.blocks[storeBlockId];
    if (storeBlock === undefined) continue;
    const storeDefs = new Map<number, Instruction>();
    const prevReads: number[] = [],
      currReads: number[] = [];
    let rightReadId = -1,
      badRead = false;
    for (let i = 0; i < storeBlock.instructions.length; i++) {
      const op = storeBlock.instructions[i];
      if (op === undefined) {
        badRead = true;
        break;
      }
      const r = instructionResult(op);
      if (r !== undefined) storeDefs.set(r, op);
      if (op.kind === "array-read") {
        badRead = true;
        break;
      }
      if (op.kind === "array-element") {
        const aDef = storeDefs.get(op.array);
        if (aDef === undefined || aDef.kind !== "load" || aDef.slot !== arrSlot)
          continue;
        if (i >= storeIndex) {
          badRead = true;
          break;
        }
        const delta = matchCounterOffset(op.index, counterSlot, storeDefs);
        if (delta === -1) prevReads.push(i);
        else if (delta === 0) currReads.push(i);
        else if (delta === 1) rightReadId = op.id;
      }
    }
    if (badRead || prevReads.length === 0) continue;

    // We carry `prev` always; we also carry `curr` when both `A[i]` and
    // `A[i + 1]` are read before the store (`curr` becomes `right`).
    const carryCurr = currReads.length > 0 && rightReadId >= 0;
    const arrType = current.slots[arrSlot];
    if (arrType === undefined) continue;

    const candSlots = current.slots.slice(),
      candBlocks = current.blocks.slice();
    let candNextValue = nextValue;
    const fresh = (): number => candNextValue++;

    const prevSlot = candSlots.length;
    candSlots.push("number");
    const currSlot = carryCurr ? candSlots.length : -1;
    if (carryCurr) candSlots.push("number");

    // Preheader entry check (cloned header): 0-iteration loops exit directly
    // without touching A[start - 1] or A[start]; >=1-iteration loops initialize
    // `prevSlot = A[i - 1]` (and `currSlot = A[i]`) and enter `loop.header`.
    const entryCheckId = candBlocks.length,
      initId = entryCheckId + 1;
    const subst = new Uint32Array(candNextValue),
      checkInsts: Instruction[] = [];
    for (const op of headerBlock.instructions) {
      if (op === undefined) continue;
      const s = substituteInstructionValues(op, subst),
        r = instructionResult(op);
      if (r !== undefined) {
        const renamed = fresh();
        subst[r] = renamed + 1;
        checkInsts.push(renumberInstructionResult(s, renamed));
      } else checkInsts.push(s);
    }
    const checkTerm: Terminator = substituteTerminatorValues(hTerm, subst);
    if (checkTerm.kind !== "branch") continue;

    candBlocks[preheaderId] = {
      ...preheader,
      terminator: { kind: "jump", target: entryCheckId, start: 0, end: 0 },
    };
    candBlocks.push({
      id: entryCheckId,
      instructions: checkInsts,
      terminator: {
        ...checkTerm,
        consequent: initId,
        alternate: exitTarget,
      },
    });

    const initInsts: Instruction[] = [];
    const vArr = fresh(),
      vI = fresh(),
      vOne = fresh(),
      vPrevIdx = fresh(),
      vPrev = fresh();
    initInsts.push(
      { kind: "load", id: vArr, slot: arrSlot, start: 0, end: 0 },
      { kind: "load", id: vI, slot: counterSlot, start: 0, end: 0 },
      { kind: "constant", id: vOne, value: 1, start: 0, end: 0 },
      {
        kind: "binary",
        id: vPrevIdx,
        operator: "-",
        left: vI,
        right: vOne,
        start: 0,
        end: 0,
      },
      {
        kind: "array-element",
        id: vPrev,
        array: vArr,
        index: vPrevIdx,
        start: 0,
        end: 0,
      },
      { kind: "store", slot: prevSlot, value: vPrev, start: 0, end: 0 },
    );
    if (carryCurr) {
      const vCurr = fresh();
      initInsts.push(
        {
          kind: "array-element",
          id: vCurr,
          array: vArr,
          index: vI,
          start: 0,
          end: 0,
        },
        { kind: "store", slot: currSlot, value: vCurr, start: 0, end: 0 },
      );
    }
    candBlocks.push({
      id: initId,
      instructions: initInsts,
      terminator: { kind: "jump", target: loop.header, start: 0, end: 0 },
    });

    // Rewrite `storeBlock`: replace A[i - 1] loads with `load(prevSlot)` (and
    // A[i] loads with `load(currSlot)` when carrying `curr`), then right after
    // `array-store`, update `prevSlot = narrowed(storedVal)` and `currSlot = right`.
    const prevSet = new Set<number>(),
      currSet = new Set<number>();
    for (const id of prevReads) if (id !== undefined) prevSet.add(id);
    if (carryCurr)
      for (const id of currReads) if (id !== undefined) currSet.add(id);
    const newInsts: Instruction[] = [];
    for (let i = 0; i < storeBlock.instructions.length; i++) {
      const op = storeBlock.instructions[i];
      if (op === undefined) continue;
      if (prevSet.has(i) && op.kind === "array-element") {
        newInsts.push({
          kind: "load",
          id: op.id,
          slot: prevSlot,
          start: op.start,
          end: op.end,
        });
      } else if (currSet.has(i) && op.kind === "array-element") {
        newInsts.push({
          kind: "load",
          id: op.id,
          slot: currSlot,
          start: op.start,
          end: op.end,
        });
      } else {
        newInsts.push(op);
        if (i === storeIndex) {
          const narrowed = emitNarrowedElement(
            arrType,
            storedValId,
            storeDefs,
            newInsts,
            fresh,
          );
          newInsts.push({
            kind: "store",
            slot: prevSlot,
            value: narrowed,
            start: 0,
            end: 0,
          });
          if (carryCurr)
            newInsts.push({
              kind: "store",
              slot: currSlot,
              value: rightReadId,
              start: 0,
              end: 0,
            });
        }
      }
    }
    candBlocks[storeBlockId] = { ...storeBlock, instructions: newInsts };

    const debug =
      current.debug === undefined
        ? undefined
        : retainDebugValues(current, candBlocks);
    const candidate: FunctionIR =
      debug === undefined
        ? { ...current, slots: candSlots, blocks: candBlocks }
        : { ...current, slots: candSlots, blocks: candBlocks, debug };
    if (!recordReadsKept(current, candidate)) continue;
    current = candidate;
    nextValue = candNextValue;
    rewritten++;
    for (const id of loop.body) touched.add(id);
    touched.add(preheaderId);
    if (remarks !== undefined)
      remarks({
        pass: "scalarize-stencil-loops",
        outcome: "applied",
        function: fn.name,
        start: headerBlock.terminator.start,
        end: headerBlock.terminator.end,
        message: carryCurr
          ? "carried prev and curr elements across stencil loop"
          : "carried prev element across recurrence loop",
      });
  }

  return { fn: current, visited, rewritten };
}

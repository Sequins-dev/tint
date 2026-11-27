import {
  instructionResult,
  instructionEffects,
  effectInvoke,
  effectWriteHeap,
  effectUnknown,
  blockSuccessors,
  visitInstructionOperands,
  visitTerminatorOperands,
  substituteInstructionValues,
  substituteTerminatorValues,
  retainDebugValues,
  type FunctionIR,
  type Block,
  type Instruction,
  type ScalarType,
} from "../scalar/index.ts";
import { hasScriptOperations } from "./control-flow.ts";
export interface ForwardedLoads {
  readonly fn: FunctionIR;
  readonly forwarded: number;
  readonly visited: number;
}
/** Verified block-local SSA. Local stores/loads establish canonical aliases;
 * joins and opaque effects invalidate slot knowledge. Allocation and known
 * calls cannot change unexposed local storage.
 * SSA snapshots stay immutable across those barriers. Stores remain for later
 * liveness cleanup, including stores observed by exception handlers. */
export function forwardLocalLoads(
  fn: FunctionIR,
  budget: number,
  effects?: Uint32Array,
): ForwardedLoads | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw "INVALID_OPTIMIZATION_BUDGET";
  const isScript = hasScriptOperations(fn);
  let visited = 0,
    maximum = -1,
    count = 0,
    candidates = 0,
    hasWrap = false;
  for (const block of fn.blocks) {
    if (block === undefined) throw "forward block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "forward instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined) {
        maximum = Math.max(maximum, id);
        count++;
      }
      if (
        op.kind === "load" ||
        op.kind === "record-read" ||
        op.kind === "reference-value" ||
        op.kind === "general-value" ||
        (isScript && (op.kind === "general-is" || op.kind === "general-equal"))
      )
        candidates++;
      if (
        op.kind === "reference-wrap" ||
        op.kind === "general-wrap" ||
        (isScript && (op.kind === "general-none" || op.kind === "general-null"))
      )
        hasWrap = true;
    }
  }
  // The alias table is indexed by value ID: bound it by the instruction
  // count, with slack for the sparse IDs later passes leave behind.
  if (candidates === 0 || maximum > count * 16 + 4096)
    return { fn, visited, forwarded: 0 };
  visited += maximum + 1 + fn.slots.length * 2;
  if (visited > budget) return undefined;
  const aliases = new Uint32Array(maximum + 1),
    slots = new Uint32Array(fn.slots.length),
    epochs = new Uint32Array(fn.slots.length),
    blocks: Block[] = [];
  let epoch = 0,
    forwarded = 0;
  function operand(_id: number): void {
    visited++;
  }
  function knownScalarType(
    op: Instruction,
    types: ReadonlyMap<number, ScalarType>,
  ): ScalarType | undefined {
    if (op.kind === "load") return fn.slots[op.slot];
    if (op.kind === "constant") {
      const literal = op.value;
      return typeof literal === "number" ? "number" : "boolean";
    }
    if (
      op.kind === "record-new" ||
      op.kind === "function-new" ||
      op.kind === "error-new"
    )
      return "reference";
    if (op.kind === "reference-value") return op.type ?? "reference";
    if (op.kind === "general-value") return op.type;
    if (
      op.kind === "string-literal" ||
      op.kind === "string-concat" ||
      op.kind === "string-slice" ||
      op.kind === "string-value"
    )
      return "string";
    if (op.kind === "optional-value" || op.kind === "optional-value-or")
      return "number";
    if (isScript) {
      if (op.kind === "unary")
        return op.operator === "!" ||
          op.operator === "truthy" ||
          op.operator === "is-integer"
          ? "boolean"
          : "number";
      if (op.kind === "binary")
        return op.operator === "===" ||
          op.operator === "!==" ||
          op.operator === "<" ||
          op.operator === "<=" ||
          op.operator === ">" ||
          op.operator === ">="
          ? "boolean"
          : "number";
      if (
        op.kind === "general-is" ||
        op.kind === "general-equal" ||
        op.kind === "general-record-is" ||
        op.kind === "property-store" ||
        op.kind === "element-store" ||
        op.kind === "general-element-store" ||
        op.kind === "general-slot-store" ||
        op.kind === "optional-present" ||
        op.kind === "boolean-present" ||
        op.kind === "string-present"
      )
        return "boolean";
    }
    return types.get(instructionResult(op) ?? -1);
  }
  const foldGeneralIs = hasWrap && isScript;
  const valueTypes = new Map<number, ScalarType>(),
    wrappedReference = new Map<number, number>(),
    wrappedGeneral = new Map<
      number,
      { readonly value: number; readonly type: ScalarType }
    >(),
    knownGeneralTag = new Map<
      number,
      "undefined" | "null" | "number" | "boolean" | "string" | "object"
    >();
  // When a block has a unique predecessor whose terminator writes a record
  // field of a slot-loaded object, forward matching unchecked record-reads in
  // the block directly to the written value slot (eliminating heap reload +
  // store-to-load forwarding stalls).
  const predCount = new Uint32Array(fn.blocks.length),
    uniquePred = new Uint32Array(fn.blocks.length);
  for (const block of fn.blocks) {
    if (block === undefined) throw "forward block invariant";
    for (const succ of blockSuccessors(block)) {
      if (succ >= 0 && succ < fn.blocks.length) {
        predCount[succ] = (predCount[succ] ?? 0) + 1;
        uniquePred[succ] = block.id;
      }
    }
    if (block.exception !== undefined) {
      const target = block.exception.target;
      if (target >= 0 && target < fn.blocks.length) {
        predCount[target] = (predCount[target] ?? 0) + 1;
        uniquePred[target] = block.id;
      }
    }
  }
  const entryWritten = new Map<
    number,
    {
      readonly objSlot: number;
      readonly record: number;
      readonly field: number;
      readonly valueSlot: number;
    }
  >();
  for (const block of fn.blocks) {
    if (block === undefined) throw "forward block invariant";
    if (block.id === fn.entry || (predCount[block.id] ?? 0) !== 1) continue;
    const pid = uniquePred[block.id] ?? -1,
      pred = pid >= 0 ? fn.blocks[pid] : undefined;
    if (pred === undefined) continue;
    const pt = pred.terminator;
    if (
      pt.kind !== "record" ||
      pt.operation !== "write" ||
      pt.consequent !== block.id ||
      pt.alternate === block.id ||
      pred.exception?.target === block.id
    )
      continue;
    let objSlot = -1,
      validObj = false,
      objAssignedInPred = false;
    const predLoadSlots = new Map<number, number>(),
      predSlotAlias = new Map<number, number>();
    for (const op of pred.instructions) {
      if (op === undefined) continue;
      if (op.kind === "load") {
        const canonical = predSlotAlias.get(op.slot) ?? op.slot;
        predLoadSlots.set(op.id, canonical);
        if (op.id === pt.object) {
          objSlot = canonical;
          validObj = true;
          objAssignedInPred = predSlotAlias.has(op.slot);
        }
      } else if (
        op.kind === "reference-value" ||
        op.kind === "reference-wrap"
      ) {
        const src = predLoadSlots.get(op.value);
        if (src !== undefined) {
          predLoadSlots.set(op.id, src);
          if (op.id === pt.object) {
            objSlot = src;
            validObj = true;
            objAssignedInPred = false;
          }
        }
      } else if (op.kind === "store") {
        if (validObj && op.slot === objSlot) validObj = false;
        const src = predLoadSlots.get(op.value);
        if (src !== undefined && src !== op.slot)
          predSlotAlias.set(op.slot, src);
        else predSlotAlias.delete(op.slot);
        for (const [k, v] of predSlotAlias)
          if (v === op.slot) predSlotAlias.delete(k);
      } else if (validObj) {
        const eff =
          op.kind === "call"
            ? effects === undefined
              ? effectUnknown
              : (effects[op.target] ?? effectUnknown)
            : instructionEffects(op);
        if ((eff & effectInvoke) !== 0) validObj = false;
      }
    }
    // If `objSlot` was copied from an optional-reference slot in a unique
    // dominating predecessor block (e.g. `store(tmp, reference-value(load(cell)))`
    // before a lowered record-read block split), resolve that canonical slot.
    if (validObj && objSlot >= 0 && !objAssignedInPred) {
      let curId = pid,
        targetSlot = objSlot;
      for (let hop = 0; hop < 4; hop++) {
        if (curId === fn.entry || (predCount[curId] ?? 0) !== 1) break;
        const prevId = uniquePred[curId] ?? -1,
          prevBlock = prevId >= 0 ? fn.blocks[prevId] : undefined;
        if (prevBlock === undefined || prevBlock.exception?.target === curId)
          break;
        const prevTerm = prevBlock.terminator;
        if (
          (prevTerm.kind === "record" ||
            prevTerm.kind === "record-cell" ||
            prevTerm.kind === "cell") &&
          prevTerm.operation !== "write" &&
          prevTerm.slot === targetSlot
        )
          break;
        const pLoads = new Map<number, number>(),
          pAlias = new Map<number, number>();
        let overwritten = false,
          invoked = false;
        for (const op of prevBlock.instructions) {
          if (op === undefined) continue;
          if (op.kind === "load") {
            pLoads.set(op.id, pAlias.get(op.slot) ?? op.slot);
          } else if (
            op.kind === "reference-value" ||
            op.kind === "reference-wrap"
          ) {
            const src = pLoads.get(op.value);
            if (src !== undefined) pLoads.set(op.id, src);
          } else if (op.kind === "store") {
            const src = pLoads.get(op.value);
            if (op.slot === targetSlot) {
              overwritten = true;
              if (src !== undefined && src !== op.slot)
                pAlias.set(op.slot, src);
              else pAlias.delete(op.slot);
            } else if (src !== undefined && src !== op.slot)
              pAlias.set(op.slot, src);
            else pAlias.delete(op.slot);
            for (const [k, v] of pAlias) if (v === op.slot) pAlias.delete(k);
          } else {
            const eff =
              op.kind === "call"
                ? effects === undefined
                  ? effectUnknown
                  : (effects[op.target] ?? effectUnknown)
                : instructionEffects(op);
            if ((eff & effectInvoke) !== 0) invoked = true;
          }
        }
        if (invoked) break;
        const mapped = pAlias.get(targetSlot);
        if (mapped !== undefined) {
          // Verify `mapped` wasn't overwritten in `pred` either (between entry
          // and `pt.object`).
          let predClobbered = false;
          for (const op of pred.instructions) {
            if (op !== undefined && op.kind === "store" && op.slot === mapped) {
              predClobbered = true;
              break;
            }
          }
          if (!predClobbered) {
            objSlot = mapped;
            targetSlot = mapped;
          }
          break;
        }
        if (overwritten) break;
        curId = prevId;
      }
    }
    if (validObj && objSlot >= 0) {
      entryWritten.set(block.id, {
        objSlot,
        record: pt.record,
        field: pt.field,
        valueSlot: pt.slot,
      });
    }
  }
  const loadSlotByVal = new Map<number, number>();
  const hasGeneral = hasScriptOperations(fn);
  const numberValues = hasGeneral ? new Set<number>() : undefined;
  const wrappedNumbers = hasGeneral ? new Map<number, number>() : undefined;
  function producesNumber(op: Instruction): boolean {
    switch (op.kind) {
      case "constant":
        return typeof op.value === "number";
      case "load":
        return fn.slots[op.slot] === "number";
      case "general-value":
        return op.type === "number";
      case "string-length":
      case "string-code-unit":
        return true;
      case "unary":
        return (
          op.operator === "-" ||
          op.operator === "+" ||
          op.operator === "~" ||
          op.operator === "ceil" ||
          op.operator === "trunc" ||
          op.operator === "sqrt" ||
          op.operator === "fround" ||
          op.operator === "f16round" ||
          op.operator === "uint32" ||
          op.operator === "boolean-number"
        );
      case "binary":
        switch (op.operator) {
          case "+":
          case "-":
          case "*":
          case "/":
          case "%":
          case "**":
          case "&":
          case "|":
          case "^":
          case "<<":
          case ">>":
          case ">>>":
          case "imul":
          case "min":
          case "max":
            return true;
        }
        return false;
    }
    return false;
  }
  for (const block of fn.blocks) {
    if (block === undefined) throw "forward block invariant";
    epoch++;
    numberValues?.clear();
    wrappedNumbers?.clear();
    const instructions: Instruction[] = [];
    if (hasWrap) {
      valueTypes.clear();
      wrappedReference.clear();
      wrappedGeneral.clear();
      knownGeneralTag.clear();
    }
    let wf:
      | {
          readonly objSlot: number;
          readonly record: number;
          readonly field: number;
          readonly valueSlot: number;
        }
      | undefined = entryWritten.get(block.id);
    if (wf !== undefined) loadSlotByVal.clear();
    let changed = false;
    for (const op of block.instructions) {
      if (op === undefined) throw "forward instruction invariant";
      visited++;
      visitInstructionOperands(op, operand);
      if (visited > budget) return undefined;
      if (op.kind === "load") {
        const known = epochs[op.slot] === epoch ? (slots[op.slot] ?? 0) : 0;
        if (known !== 0) {
          aliases[op.id] = known;
          if (wf !== undefined) loadSlotByVal.set(known - 1, op.slot);
          forwarded++;
          changed = true;
          continue;
        }
        slots[op.slot] = op.id + 1;
        epochs[op.slot] = epoch;
        if (wf !== undefined) loadSlotByVal.set(op.id, op.slot);
      }
      const rewritten = substituteInstructionValues(op, aliases);
      if (wf !== undefined && rewritten.kind === "reference-value") {
        const src = loadSlotByVal.get(rewritten.value);
        if (src !== undefined) loadSlotByVal.set(rewritten.id, src);
      }
      if (
        wf !== undefined &&
        rewritten.kind === "record-read" &&
        rewritten.record === wf.record &&
        rewritten.field === wf.field &&
        loadSlotByVal.get(rewritten.object) === wf.objSlot
      ) {
        const knownVal =
          epochs[wf.valueSlot] === epoch ? (slots[wf.valueSlot] ?? 0) : 0;
        if (knownVal !== 0) {
          aliases[rewritten.id] = knownVal;
          forwarded++;
          changed = true;
          continue;
        }
        instructions.push({
          kind: "load",
          id: rewritten.id,
          slot: wf.valueSlot,
          start: rewritten.start,
          end: rewritten.end,
          ...(rewritten.inline === undefined
            ? {}
            : { inline: rewritten.inline }),
        });
        slots[wf.valueSlot] = rewritten.id + 1;
        epochs[wf.valueSlot] = epoch;
        forwarded++;
        changed = true;
        continue;
      }
      if (
        hasWrap &&
        rewritten.kind === "reference-value" &&
        rewritten.type === undefined
      ) {
        const unwrapped = wrappedReference.get(rewritten.value);
        if (unwrapped !== undefined) {
          aliases[rewritten.id] = unwrapped + 1;
          forwarded++;
          changed = true;
          continue;
        }
      }
      if (
        wrappedNumbers !== undefined &&
        rewritten.kind === "general-value" &&
        rewritten.type === "number"
      ) {
        const unwrapped = wrappedNumbers.get(rewritten.value);
        if (unwrapped !== undefined) {
          aliases[rewritten.id] = unwrapped + 1;
          forwarded++;
          changed = true;
          continue;
        }
      }
      if (
        hasWrap &&
        rewritten.kind === "general-value" &&
        (rewritten.type === "reference" ||
          rewritten.type === "number" ||
          rewritten.type === "boolean" ||
          rewritten.type === "string")
      ) {
        const wrapped = wrappedGeneral.get(rewritten.value);
        if (wrapped !== undefined && wrapped.type === rewritten.type) {
          aliases[rewritten.id] = wrapped.value + 1;
          forwarded++;
          changed = true;
          continue;
        }
      }
      if (
        foldGeneralIs &&
        rewritten.kind === "general-is" &&
        knownGeneralTag.has(rewritten.value)
      ) {
        const actual = knownGeneralTag.get(rewritten.value);
        const matches =
          rewritten.type === "nullish"
            ? actual === "undefined" || actual === "null"
            : actual === rewritten.type;
        instructions.push({
          kind: "constant",
          id: rewritten.id,
          value: matches,
          start: rewritten.start,
          end: rewritten.end,
          ...(rewritten.inline === undefined
            ? {}
            : { inline: rewritten.inline }),
        });
        forwarded++;
        changed = true;
        continue;
      }
      if (
        wrappedNumbers !== undefined &&
        rewritten.kind === "general-is" &&
        rewritten.type === "number" &&
        wrappedNumbers.has(rewritten.value)
      ) {
        instructions.push({
          kind: "constant",
          id: rewritten.id,
          value: true,
          start: rewritten.start,
          end: rewritten.end,
          ...(rewritten.inline === undefined
            ? {}
            : { inline: rewritten.inline }),
        });
        if (hasWrap) valueTypes.set(rewritten.id, "boolean");
        forwarded++;
        changed = true;
        continue;
      }
      if (foldGeneralIs && rewritten.kind === "general-equal") {
        const leftTag = knownGeneralTag.get(rewritten.left);
        const rightTag = knownGeneralTag.get(rewritten.right);
        if (leftTag !== undefined && rightTag !== undefined) {
          if (leftTag !== rightTag) {
            instructions.push({
              kind: "constant",
              id: rewritten.id,
              value: false,
              start: rewritten.start,
              end: rewritten.end,
              ...(rewritten.inline === undefined
                ? {}
                : { inline: rewritten.inline }),
            });
            valueTypes.set(rewritten.id, "boolean");
            forwarded++;
            changed = true;
            continue;
          }
          if (leftTag === "undefined" || leftTag === "null") {
            instructions.push({
              kind: "constant",
              id: rewritten.id,
              value: true,
              start: rewritten.start,
              end: rewritten.end,
              ...(rewritten.inline === undefined
                ? {}
                : { inline: rewritten.inline }),
            });
            valueTypes.set(rewritten.id, "boolean");
            forwarded++;
            changed = true;
            continue;
          }
          const lw = wrappedGeneral.get(rewritten.left);
          const rw = wrappedGeneral.get(rewritten.right);
          if (
            lw !== undefined &&
            rw !== undefined &&
            lw.type === rw.type &&
            (lw.type === "boolean" ||
              lw.type === "number" ||
              lw.type === "reference")
          ) {
            instructions.push({
              kind: "binary",
              id: rewritten.id,
              operator: "===",
              left: lw.value,
              right: rw.value,
              start: rewritten.start,
              end: rewritten.end,
              ...(rewritten.inline === undefined
                ? {}
                : { inline: rewritten.inline }),
            });
            valueTypes.set(rewritten.id, "boolean");
            forwarded++;
            changed = true;
            continue;
          }
        } else if (
          leftTag === "undefined" ||
          leftTag === "null" ||
          rightTag === "undefined" ||
          rightTag === "null"
        ) {
          const isLeft = leftTag === "undefined" || leftTag === "null";
          const tag = isLeft ? leftTag : rightTag;
          const other = isLeft ? rewritten.right : rewritten.left;
          if (tag === "undefined" || tag === "null") {
            instructions.push({
              kind: "general-is",
              id: rewritten.id,
              value: other,
              type: tag,
              start: rewritten.start,
              end: rewritten.end,
              ...(rewritten.inline === undefined
                ? {}
                : { inline: rewritten.inline }),
            });
            valueTypes.set(rewritten.id, "boolean");
            forwarded++;
            changed = true;
            continue;
          }
        }
      }
      instructions.push(rewritten);
      if (rewritten !== op) changed = true;
      if (hasWrap) {
        const resultId = instructionResult(rewritten);
        if (resultId !== undefined) {
          const t = knownScalarType(rewritten, valueTypes);
          if (t !== undefined) valueTypes.set(resultId, t);
        }
        if (rewritten.kind === "reference-wrap")
          wrappedReference.set(rewritten.id, rewritten.value);
        else if (rewritten.kind === "general-none") {
          if (foldGeneralIs) knownGeneralTag.set(rewritten.id, "undefined");
        } else if (rewritten.kind === "general-null") {
          if (foldGeneralIs) knownGeneralTag.set(rewritten.id, "null");
        } else if (rewritten.kind === "general-wrap") {
          const t = valueTypes.get(rewritten.value);
          if (
            t === "reference" ||
            t === "number" ||
            t === "boolean" ||
            t === "string"
          ) {
            wrappedGeneral.set(rewritten.id, {
              value: rewritten.value,
              type: t,
            });
            if (foldGeneralIs)
              knownGeneralTag.set(
                rewritten.id,
                t === "reference" ? "object" : t,
              );
          }
        }
      }
      if (numberValues !== undefined) {
        const resultId = instructionResult(rewritten);
        if (resultId !== undefined && producesNumber(rewritten))
          numberValues.add(resultId);
        if (
          rewritten.kind === "general-wrap" &&
          numberValues.has(rewritten.value)
        )
          wrappedNumbers?.set(rewritten.id, rewritten.value);
      }
      if (rewritten.kind === "store") {
        slots[rewritten.slot] = rewritten.value + 1;
        epochs[rewritten.slot] = epoch;
        if (
          wf !== undefined &&
          (rewritten.slot === wf.objSlot || rewritten.slot === wf.valueSlot)
        )
          wf = undefined;
      }
      const effect =
        op.kind === "call"
          ? effects === undefined
            ? effectUnknown
            : (effects[op.target] ?? effectUnknown)
          : instructionEffects(op);
      if ((effect & (effectWriteHeap | effectInvoke)) !== 0) wf = undefined;
      if ((effect & effectInvoke) !== 0) epoch++;
    }
    visitTerminatorOperands(block.terminator, operand);
    if (++visited > budget) return undefined;
    const terminator = substituteTerminatorValues(block.terminator, aliases);
    blocks.push(
      changed || terminator !== block.terminator
        ? { ...block, instructions, terminator }
        : block,
    );
  }
  if (forwarded === 0) return { fn, visited, forwarded };
  // Debug value bindings follow the forwarded values.
  const debug =
    fn.debug === undefined
      ? undefined
      : retainDebugValues(fn, blocks, [], aliases);
  return {
    fn: debug === undefined ? { ...fn, blocks } : { ...fn, blocks, debug },
    visited,
    forwarded,
  };
}

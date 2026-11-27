import { compactReachableBlocks } from "./control-flow.ts";
import type { RemarkSink } from "./observer.ts";
import {
  indirectCallClass,
  indirectCallTargets,
  instructionResult,
  visitInstructionOperands,
  naturalLoops,
  type Block,
  type FunctionIR,
  type IndirectCallTargets,
  type Instruction,
  type ModuleIR,
  type NaturalLoop,
  type ScalarType,
  type Terminator,
} from "../scalar/index.ts";

export interface CellPromotion {
  readonly module: ModuleIR;
  readonly visited: number;
  /** Loop-cell pairs promoted to slots. */
  readonly promoted: number;
}

/** Cell layouts (record IDs) each function may access through a cell
 * operation, itself or through its callees, or undefined when unknown (host
 * calls, imports, and indirect calls unless `targets` resolves them), plus a
 * per-function bit recording whether the function itself has any `record-cell`
 * terminator (independent of its transitive summary). With `targets`, one
 * summary per indirect-call class follows the functions': the union of its
 * members'. */
function cellSummaries(
  module: ModuleIR,
  targets: IndirectCallTargets | undefined,
  budget: number,
):
  | {
      summaries: (Set<number> | undefined)[];
      hasLocalSite: Uint8Array;
      visited: number;
    }
  | undefined {
  const count = module.functions.length,
    summaries: (Set<number> | undefined)[] = [],
    hasLocalSite = new Uint8Array(count),
    callees: number[][] = [];
  let visited = targets?.visited ?? 0;
  for (let fnIndex = 0; fnIndex < count; fnIndex++) {
    const fn = module.functions[fnIndex];
    if (fn === undefined) throw "cell promotion function invariant";
    let own: Set<number> | undefined = new Set<number>();
    const reached: number[] = [];
    if (fn.import === true) own = undefined;
    for (const block of fn.blocks) {
      if (block === undefined) throw "cell promotion block invariant";
      const term = block.terminator;
      if (term.kind === "record-cell") {
        hasLocalSite[fnIndex] = 1;
        if (own !== undefined) own.add(term.record);
      } else if (term.kind === "cell") own = undefined;
      for (const op of block.instructions) {
        if (op === undefined) throw "cell promotion instruction invariant";
        if (++visited > budget) return undefined;
        if (op.kind === "call") reached.push(op.target);
        else if (op.kind === "call-indirect" && targets !== undefined) {
          // A call without a class can only trap.
          const index = indirectCallClass(targets, fn.id, block.id, op);
          if (index >= 0) reached.push(count + index);
        } else if (op.kind === "call-indirect" || op.kind === "host-call")
          own = undefined;
      }
    }
    summaries.push(own);
    callees.push(reached);
  }
  for (const members of targets?.classes ?? []) {
    if (members === undefined) throw "cell promotion class invariant";
    const reached: number[] = [];
    for (const member of members) {
      if (member === undefined) throw "cell promotion class invariant";
      reached.push(member);
    }
    summaries.push(new Set<number>());
    callees.push(reached);
  }
  // Propagate callee sets to callers until stable.
  let changed = true;
  while (changed) {
    changed = false;
    for (let id = 0; id < summaries.length; id++) {
      const own = summaries[id];
      if (own === undefined) continue;
      for (const target of callees[id] ?? []) {
        if (target === undefined) throw "cell promotion callee invariant";
        if (++visited > budget) return undefined;
        const callee = summaries[target];
        if (callee === undefined) {
          summaries[id] = undefined;
          changed = true;
          break;
        }
        for (const record of callee)
          if (record !== undefined && !own.has(record)) {
            own.add(record);
            changed = true;
          }
      }
    }
  }
  return { summaries, hasLocalSite, visited };
}

/** Scalar promotion of captured variables in loops. A cell (a `record-cell`
 * field of a cell object held in a slot the loop never writes) that a loop
 * accesses only through reads and writes proven initialized, with no
 * exception handler in the loop and no call that may access cells of its
 * layout, is read once into a fresh slot before the loop; in the loop its
 * reads and writes copy that slot, and every exit (edges leaving the loop,
 * and returns or throws inside it) first writes the slot back. Nothing else
 * can observe the cell during the loop, so this is exact; traps need no
 * write-back. Proven-initialized accesses inside the loop imply the cell is
 * initialized at loop entry (initialization is permanent and the proof
 * flows from outside the loop), so the entry read needs no state test.
 * One unproven read is also accepted: the loop header's own terminator, when
 * its failure edge leaves the loop and nothing the header does before it can
 * fail or be observed on that edge (see unobservedBefore). Every iteration,
 * the first included, performs that read before any effect, so the entry
 * read takes over its state test and failure edge; once it succeeds the cell
 * stays initialized, which proves the other accesses.
 * Verified IR with dense block IDs only. */
export function promoteLoopCells(
  module: ModuleIR,
  budget: number,
  remarks?: RemarkSink,
  closedCalls: boolean = false,
): CellPromotion | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  const targets = closedCalls
    ? indirectCallTargets(module, true, budget)
    : undefined;
  if (closedCalls && targets === undefined) return undefined;
  const summary = cellSummaries(module, targets, budget);
  if (summary === undefined) return undefined;
  let visited = summary.visited,
    promoted = 0,
    changed = false;
  const functions: FunctionIR[] = [];
  for (let fnIndex = 0; fnIndex < module.functions.length; fnIndex++) {
    const fn = module.functions[fnIndex];
    if (fn === undefined) throw "cell promotion function invariant";
    if (summary.hasLocalSite[fnIndex] !== 1) {
      functions.push(fn);
      continue;
    }
    let current = fn;
    // One cell per loop per round, inner loops first; outer loops see the
    // inner promotions next round.
    for (let round = 0; round < 16; round++) {
      const result = promoteRound(
        current,
        module,
        summary.summaries,
        targets,
        budget - visited,
        remarks,
      );
      if (result === undefined) return undefined;
      visited += result.visited;
      if (result.promoted === 0) break;
      promoted += result.promoted;
      current = result.fn;
    }
    if (current !== fn) changed = true;
    functions.push(current);
  }
  return {
    module: changed ? { ...module, functions } : module,
    visited,
    promoted,
  };
}

interface CellSite {
  readonly block: number;
  readonly record: number;
  readonly field: number;
  readonly objectSlot: number;
  readonly operation: "initialize" | "read" | "write";
  readonly initialized: boolean;
  /** For the loop header's unproven entry read (see promoteLoopCells): its
   * failure target outside the loop; otherwise -1. */
  readonly entryFailure: number;
}

function promoteRound(
  fn: FunctionIR,
  module: ModuleIR,
  summaries: readonly (Set<number> | undefined)[],
  targets: IndirectCallTargets | undefined,
  budget: number,
  remarks: RemarkSink | undefined,
):
  | {
      readonly fn: FunctionIR;
      readonly visited: number;
      readonly promoted: number;
    }
  | undefined {
  const count = fn.blocks.length;
  for (let index = 0; index < count; index++)
    if (fn.blocks[index]?.id !== index) return { fn, visited: 0, promoted: 0 };
  const forest = naturalLoops(fn, budget);
  if (forest === undefined) return undefined;
  let visited = forest.visited;
  const predecessors: number[][] = [];
  for (let index = 0; index < count; index++) predecessors.push([]);
  for (const block of fn.blocks) {
    if (block === undefined) throw "cell promotion block invariant";
    for (const target of successorsOf(block.terminator)) {
      if (target === undefined) throw "cell promotion edge invariant";
      predecessors[target]?.push(block.id);
    }
    const handler = block.exception;
    if (handler !== undefined) predecessors[handler.target]?.push(block.id);
  }
  // Innermost loops first (by body size); one loop per round touches a block.
  const loops: NaturalLoop[] = [];
  for (const loop of forest.loops) {
    if (loop === undefined) throw "cell promotion loop invariant";
    let at = loops.length;
    while (at > 0 && (loops[at - 1]?.body.size ?? 0) > loop.body.size) at--;
    loops.splice(at, 0, loop);
  }
  let nextValue = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "cell promotion block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "cell promotion instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined && id >= nextValue) nextValue = id + 1;
    }
  }
  const functionSlots = singleFunctionSlots(fn);
  const blocks: Block[] = fn.blocks.slice(),
    slots: ScalarType[] = fn.slots.slice(),
    touched = new Uint8Array(count);
  let promoted = 0;
  for (const loop of loops) {
    if (loop === undefined) throw "cell promotion loop invariant";
    let overlap = false;
    for (const id of loop.body)
      if (id !== undefined && touched[id] === 1) overlap = true;
    if (overlap) continue;
    const outside = (predecessors[loop.header] ?? []).filter(
      (id) => !loop.body.has(id),
    );
    const preheaderId = outside[0];
    if (outside.length !== 1 || preheaderId === undefined) continue;
    const preheader = blocks[preheaderId];
    if (
      preheader === undefined ||
      preheader.terminator.kind !== "jump" ||
      preheader.exception !== undefined ||
      touched[preheaderId] === 1
    )
      continue;
    // Loop facts: exception handlers, call targets, cell sites.
    // `strictOnly`: every call is resolved (for cells other functions may
    // share); `indirectSlots`: the slots indirect callees are loaded from.
    let eligible = true,
      strictOnly = true;
    const sites: CellSite[] = [],
      callees: number[] = [],
      indirectSlots: number[] = [];
    for (const id of loop.body) {
      if (id === undefined) throw "cell promotion body invariant";
      const block = blocks[id];
      if (block === undefined) throw "cell promotion block invariant";
      if (block.exception !== undefined) eligible = false;
      for (const op of block.instructions) {
        if (op === undefined) throw "cell promotion instruction invariant";
        if (++visited > budget) return undefined;
        if (op.kind === "call") callees.push(op.target);
        else if (op.kind === "call-indirect") {
          // A local function: the callee slot only ever holds one function.
          const slot = loadedSlot(block, op.callee),
            known = slot === undefined ? undefined : functionSlots[slot];
          indirectSlots.push(slot === undefined ? -1 : slot);
          const index =
            targets === undefined
              ? -1
              : indirectCallClass(targets, fn.id, block.id, op);
          if (known !== undefined && known >= 0) callees.push(known);
          // Otherwise any function of the call's class (none: it traps).
          else if (targets === undefined) strictOnly = false;
          else if (index >= 0) callees.push(module.functions.length + index);
        } else if (op.kind === "host-call") strictOnly = false;
      }
      const term = block.terminator;
      // Thrown values have no slot type here to carry across a write-back.
      if (term.kind === "cell" || term.kind === "throw") eligible = false;
      if (term.kind === "record-cell") {
        const slot = loadedSlot(block, term.object);
        sites.push({
          block: id,
          record: term.record,
          field: term.field,
          objectSlot: slot === undefined || loop.writes.has(slot) ? -1 : slot,
          operation: term.operation,
          initialized: term.initialized === true,
          entryFailure:
            id === loop.header &&
            term.operation === "read" &&
            term.initialized !== true &&
            !loop.body.has(term.alternate) &&
            unobservedBefore(block, blocks[term.alternate])
              ? term.alternate
              : -1,
        });
      }
    }
    if (!eligible || sites.length === 0) continue;
    // Candidate cells: (record, field, object slot), every access a proven
    // read or write through that same slot, the layout untouched by callees.
    const keys: string[] = [];
    for (const site of sites) {
      if (site === undefined) throw "cell promotion site invariant";
      const key =
        String(site.record) +
        ":" +
        String(site.field) +
        ":" +
        String(site.objectSlot);
      if (!keys.includes(key)) keys.push(key);
    }
    for (const key of keys) {
      if (key === undefined) throw "cell promotion key invariant";
      let record = -1,
        field = -1,
        objectSlot = -1,
        entryFailure = -1,
        // Why the cell stays in memory, or "" while it may be promoted.
        missed = "";
      for (const site of sites) {
        if (site === undefined) throw "cell promotion site invariant";
        const siteKey =
          String(site.record) +
          ":" +
          String(site.field) +
          ":" +
          String(site.objectSlot);
        if (siteKey === key) {
          record = site.record;
          field = site.field;
          objectSlot = site.objectSlot;
          if (site.entryFailure >= 0) entryFailure = site.entryFailure;
          else if (site.objectSlot < 0) missed = "changing object";
          else if (site.operation === "initialize" || !site.initialized)
            missed = "unproven access";
        }
      }
      if (objectSlot < 0) missed = "changing object";
      // Another site of the same layout through a different object may alias.
      for (const site of sites) {
        if (site === undefined) throw "cell promotion site invariant";
        if (
          missed === "" &&
          site.record === record &&
          (site.field !== field || site.objectSlot !== objectSlot)
        )
          missed = "possibly aliased site";
      }
      // A cell this function creates and never lets escape is reachable
      // only through closures built over it: no call to one may occur in
      // the loop. Another cell may be shared with any function, possibly
      // under other layout IDs, so callees must not access cells at all.
      const escape = missed === "" ? cellEscape(fn, objectSlot) : undefined;
      if (escape !== undefined && escape.local)
        for (const slot of indirectSlots) {
          if (slot === undefined) throw "cell promotion callee invariant";
          if (slot < 0 || (escape.tainted[slot] ?? 0) !== 0)
            missed = "call to a closure over the cell";
        }
      else if (missed === "") {
        if (!strictOnly) missed = "unresolved call";
        for (const target of callees) {
          if (target === undefined) throw "cell promotion callee invariant";
          const callee = summaries[target];
          if (missed === "" && (callee === undefined || callee.size > 0))
            missed =
              (target < module.functions.length
                ? "call to " + (module.functions[target]?.name ?? "?")
                : "indirect call") +
              (callee === undefined
                ? " with unknown cell accesses"
                : " accessing cells");
        }
      }
      const fieldType = module.records?.[record]?.fields[field]?.type;
      if (missed === "" && fieldType === undefined) missed = "unknown field";
      if (missed !== "" || fieldType === undefined) {
        if (remarks !== undefined)
          remarks({
            pass: "promote-loop-cells",
            outcome: "missed",
            function: fn.name,
            start: blocks[loop.header]?.terminator.start ?? 0,
            end: blocks[loop.header]?.terminator.end ?? 0,
            message: "cell " + key + " stays in memory: " + missed,
          });
        continue;
      }
      // Only a loop that writes the cell needs its value written back.
      let written = false;
      for (const site of sites) {
        if (site === undefined) throw "cell promotion site invariant";
        if (
          site.record === record &&
          site.field === field &&
          site.operation === "write"
        )
          written = true;
      }
      // Promote this cell in this loop.
      const promotedSlot = slots.length;
      slots.push(fieldType);
      let trapBlock = -1;
      const newBlock = (block: Block): number => {
        const id = blocks.length;
        blocks.push({ ...block, id });
        return id;
      };
      const trap = (): number => {
        if (trapBlock < 0)
          trapBlock = newBlock({
            id: 0,
            instructions: [],
            terminator: { kind: "trap", start: 0, end: 0 },
          });
        return trapBlock;
      };
      /** A block writing the promoted slot back, then continuing (the
       * target itself when the loop only reads the cell). */
      const writeBack = (target: number): number => {
        if (!written) return target;
        const object = nextValue++;
        return newBlock({
          id: 0,
          instructions: [
            { kind: "load", id: object, slot: objectSlot, start: 0, end: 0 },
          ],
          terminator: {
            kind: "record-cell",
            object,
            record,
            field,
            operation: "write",
            slot: promotedSlot,
            consequent: target,
            alternate: trap(),
            initialized: true,
            start: 0,
            end: 0,
          },
        });
      };
      // Entry: read the cell into the promoted slot.
      {
        // The preheader's jump targets the header.
        const object = nextValue++,
          header = loop.header;
        const current = blocks[preheaderId];
        if (current === undefined) throw "cell promotion preheader invariant";
        const entry: Instruction[] = current.instructions.slice();
        entry.push({
          kind: "load",
          id: object,
          slot: objectSlot,
          start: 0,
          end: 0,
        });
        blocks[preheaderId] = {
          ...current,
          instructions: entry,
          terminator:
            entryFailure < 0
              ? {
                  kind: "record-cell",
                  object,
                  record,
                  field,
                  operation: "read",
                  slot: promotedSlot,
                  consequent: header,
                  alternate: trap(),
                  initialized: true,
                  start: 0,
                  end: 0,
                }
              : {
                  // The header's checked read, performed once.
                  kind: "record-cell",
                  object,
                  record,
                  field,
                  operation: "read",
                  slot: promotedSlot,
                  consequent: header,
                  alternate: entryFailure,
                  start: blocks[header]?.terminator.start ?? 0,
                  end: blocks[header]?.terminator.end ?? 0,
                },
        };
      }
      // Loop accesses become slot copies; exits write back.
      for (const id of loop.body) {
        if (id === undefined) throw "cell promotion body invariant";
        const block = blocks[id];
        if (block === undefined) throw "cell promotion block invariant";
        let instructions: Instruction[] = block.instructions.slice(),
          term: Terminator = block.terminator;
        if (
          term.kind === "record-cell" &&
          term.record === record &&
          term.field === field
        ) {
          const value = nextValue++;
          if (term.operation === "read") {
            instructions.push({
              kind: "load",
              id: value,
              slot: promotedSlot,
              start: 0,
              end: 0,
            });
            instructions.push({
              kind: "store",
              slot: term.slot,
              value,
              start: 0,
              end: 0,
            });
          } else {
            instructions.push({
              kind: "load",
              id: value,
              slot: term.slot,
              start: 0,
              end: 0,
            });
            instructions.push({
              kind: "store",
              slot: promotedSlot,
              value,
              start: 0,
              end: 0,
            });
          }
          term = {
            kind: "jump",
            target: term.consequent,
            start: term.start,
            end: term.end,
          };
        }
        // Function exits inside the loop write back first.
        if (term.kind === "return") {
          const carried = term.value,
            exitSlot = carried === undefined ? -1 : slots.length;
          let exitBlock: Block;
          if (carried === undefined)
            exitBlock = { id: 0, instructions: [], terminator: term };
          else {
            const type = returnSlotType(fn);
            if (type === undefined) throw "cell promotion return invariant";
            slots.push(type);
            instructions.push({
              kind: "store",
              slot: exitSlot,
              value: carried,
              start: 0,
              end: 0,
            });
            const reloaded = nextValue++;
            exitBlock = {
              id: 0,
              instructions: [
                {
                  kind: "load",
                  id: reloaded,
                  slot: exitSlot,
                  start: 0,
                  end: 0,
                },
              ],
              terminator: {
                kind: "return",
                value: reloaded,
                start: term.start,
                end: term.end,
              },
            };
          }
          term = {
            kind: "jump",
            target: writeBack(newBlock(exitBlock)),
            start: 0,
            end: 0,
          };
        } else if (term.kind === "throw-literal")
          term = {
            kind: "jump",
            target: writeBack(
              newBlock({ id: 0, instructions: [], terminator: term }),
            ),
            start: 0,
            end: 0,
          };
        else term = retargetExits(term, loop, blocks, writeBack);
        blocks[id] = { ...block, instructions, terminator: term };
      }
      promoted++;
      if (remarks !== undefined)
        remarks({
          pass: "promote-loop-cells",
          outcome: "applied",
          function: fn.name,
          start: blocks[preheaderId]?.terminator.start ?? 0,
          end: blocks[preheaderId]?.terminator.end ?? 0,
          message:
            "cell " +
            key +
            (entryFailure < 0 ? "" : " (checked entry read)") +
            (written ? " read and written back" : " read once"),
        });
      for (const id of loop.body) if (id !== undefined) touched[id] = 1;
      touched[preheaderId] = 1;
      break;
    }
  }
  if (promoted === 0) return { fn, visited, promoted: 0 };
  // Replaced accesses leave their failure blocks unreachable.
  const compacted = compactReachableBlocks(
    { ...fn, slots },
    blocks,
    budget - visited,
  );
  if (compacted === undefined) return undefined;
  return {
    fn: compacted.fn,
    visited: visited + compacted.visited,
    promoted,
  };
}

/** Per slot: the function every store to it creates (`function-new` in the
 * storing block, or a copy loaded from such a slot), -1 when stored
 * otherwise or never (or a parameter). */
function singleFunctionSlots(fn: FunctionIR): number[] {
  const count = fn.slots.length,
    // Per store: the created function, or the copied slot + 1 negated.
    sources: number[][] = [],
    opaque = new Uint8Array(count);
  for (let slot = 0; slot < count; slot++) sources.push([]);
  for (const parameter of fn.parameters)
    if (parameter !== undefined) opaque[parameter] = 1;
  if (fn.receiverSlot !== undefined) opaque[fn.receiverSlot] = 1;
  for (const block of fn.blocks) {
    if (block === undefined) throw "cell promotion block invariant";
    const handler = block.exception;
    if (handler !== undefined) opaque[handler.slot] = 1;
    const term = block.terminator;
    if (
      (term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell") &&
      term.operation !== "write"
    )
      opaque[term.slot] = 1;
    const created = new Map<number, number>(),
      loaded = new Map<number, number>();
    for (const op of block.instructions) {
      if (op === undefined) throw "cell promotion instruction invariant";
      if (op.kind === "function-new") created.set(op.id, op.target);
      else if (op.kind === "load") loaded.set(op.id, op.slot);
      else if (op.kind === "store") {
        const target = created.get(op.value),
          copied = loaded.get(op.value),
          list = sources[op.slot];
        if (list === undefined) throw "cell promotion slot invariant";
        if (target !== undefined) list.push(target);
        else if (copied !== undefined) list.push(-copied - 1);
        else opaque[op.slot] = 1;
      }
    }
  }
  const result: number[] = [];
  for (let slot = 0; slot < count; slot++) result.push(-2);
  let changed = true;
  for (let round = 0; changed && round < 64; round++) {
    changed = false;
    for (let slot = 0; slot < count; slot++) {
      let value = -2;
      if (opaque[slot] === 1) value = -1;
      else
        for (const source of sources[slot] ?? []) {
          if (source === undefined) throw "cell promotion source invariant";
          const resolved = source >= 0 ? source : (result[-source - 1] ?? -1);
          if (resolved === -2) continue;
          value =
            resolved === -1 || (value >= 0 && value !== resolved)
              ? -1
              : resolved;
          if (value === -1) break;
        }
      if (value !== result[slot]) {
        result[slot] = value;
        changed = true;
      }
    }
  }
  for (let slot = 0; slot < count; slot++)
    if ((result[slot] ?? -2) < 0 || changed) result[slot] = -1;
  return result;
}

/** Whether the cell object held in `cellSlot` is created in this function
 * (every store to the slot is a fresh `record-new` from the same block) and
 * flows only into slot copies, closure environments, closures over those
 * environments and reads back out of them, never into a call argument, the
 * heap or anything else. `tainted` marks slots that may hold the cell (1)
 * or an object holding it (2). Reading the cell's own field yields its
 * value, not the cell. */
function cellEscape(
  fn: FunctionIR,
  cellSlot: number,
): { readonly local: boolean; readonly tainted: Uint8Array } {
  const tainted = new Uint8Array(fn.slots.length);
  tainted[cellSlot] = 1;
  const fail = { local: false, tainted };
  for (const parameter of fn.parameters)
    if (parameter === cellSlot) return fail;
  if (fn.receiverSlot === cellSlot) return fail;
  for (const block of fn.blocks) {
    if (block === undefined) throw "cell escape block invariant";
    if (block.exception?.slot === cellSlot) return fail;
    const term = block.terminator;
    if (
      (term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell") &&
      term.operation !== "write" &&
      term.slot === cellSlot
    )
      return fail;
    const created = new Set<number>();
    for (const op of block.instructions) {
      if (op === undefined) throw "cell escape instruction invariant";
      if (op.kind === "record-new") created.add(op.id);
      else if (
        op.kind === "store" &&
        op.slot === cellSlot &&
        !created.has(op.value)
      )
        return fail;
    }
  }
  let changed = true;
  for (let round = 0; changed; round++) {
    if (round > 64) return fail;
    changed = false;
    const taint = (slot: number, mask: number): void => {
      const before = tainted[slot] ?? 0;
      if ((before | mask) !== before) {
        tainted[slot] = before | mask;
        changed = true;
      }
    };
    for (const block of fn.blocks) {
      if (block === undefined) throw "cell escape block invariant";
      // Per value: 1 the cell, 2 an object holding it.
      const values = new Map<number, number>();
      for (const op of block.instructions) {
        if (op === undefined) throw "cell escape instruction invariant";
        let mask = 0;
        visitInstructionOperands(op, (operand: number): void => {
          mask = mask | (values.get(operand) ?? 0);
        });
        if (op.kind === "load") {
          const held = tainted[op.slot] ?? 0;
          if (held !== 0) values.set(op.id, held);
        } else if (op.kind === "store") {
          if (mask !== 0) taint(op.slot, mask);
        } else if (op.kind === "record-new" || op.kind === "function-new") {
          // Environments and closures over the cell hold it.
          if (mask !== 0) values.set(op.id, 2);
        } else if (
          op.kind === "reference-value" ||
          op.kind === "reference-wrap"
        ) {
          if (mask !== 0) values.set(op.id, mask);
        } else if (op.kind === "record-read") {
          // A field of a holder may be the cell or another holder.
          const object = values.get(op.object) ?? 0;
          if ((object & 2) !== 0) values.set(op.id, 3);
        } else if (op.kind === "call-indirect") {
          // Calling a closure over the cell is fine; passing it is not.
          for (const argument of op.arguments)
            if (argument !== undefined && values.has(argument)) return fail;
          if (op.receiver !== undefined && values.has(op.receiver)) return fail;
        } else if (mask !== 0) return fail;
      }
      const term = block.terminator;
      if (
        (term.kind === "record" || term.kind === "record-cell") &&
        term.operation !== "write" &&
        ((values.get(term.object) ?? 0) & 2) !== 0
      )
        taint(term.slot, 3);
      // Writing the cell or a holder into a field lets it escape.
      if (
        (term.kind === "record" || term.kind === "record-cell") &&
        term.operation !== "read" &&
        (tainted[term.slot] ?? 0) !== 0
      )
        return fail;
      if (
        (term.kind === "return" || term.kind === "throw") &&
        term.value !== undefined &&
        values.has(term.value)
      )
        return fail;
      if (term.kind === "branch" && values.has(term.condition)) return fail;
    }
  }
  return { local: true, tainted };
}

/** The slot type carrying a function's return value. */
function returnSlotType(fn: FunctionIR): ScalarType | undefined {
  const type = fn.returnType;
  return type === "void" ? undefined : type;
}

/** Whether nothing `block`'s instructions do can fail or be observed on
 * its terminator's failure edge into `failure`: they only load slots and
 * materialize constants, or also store slots when the failure traps. */
function unobservedBefore(block: Block, failure: Block | undefined): boolean {
  const traps =
    failure !== undefined &&
    failure.instructions.length === 0 &&
    failure.terminator.kind === "trap";
  for (const op of block.instructions) {
    if (op === undefined) throw "cell promotion instruction invariant";
    if (
      op.kind === "store"
        ? !traps
        : op.kind !== "load" && op.kind !== "constant"
    )
      return false;
  }
  return true;
}

/** The slot `value` was loaded from in `block` (unchanged since), if any. */
function loadedSlot(block: Block, value: number): number | undefined {
  let slot: number | undefined;
  for (const op of block.instructions) {
    if (op === undefined) throw "cell promotion instruction invariant";
    if (op.kind === "load" && op.id === value) slot = op.slot;
    else if (op.kind === "store" && slot !== undefined && op.slot === slot)
      return undefined;
  }
  return slot;
}

function successorsOf(term: Terminator): number[] {
  if (term.kind === "jump") return [term.target];
  if (
    term.kind === "branch" ||
    term.kind === "record" ||
    term.kind === "record-cell" ||
    term.kind === "cell"
  )
    return term.consequent === term.alternate
      ? [term.consequent]
      : [term.consequent, term.alternate];
  return [];
}

/** `term` with each edge leaving the loop sent through a write-back block,
 * except edges into trapping blocks. */
function retargetExits(
  term: Terminator,
  loop: NaturalLoop,
  blocks: readonly Block[],
  writeBack: (target: number) => number,
): Terminator {
  const route = (target: number): number => {
    if (loop.body.has(target)) return target;
    const block = blocks[target];
    if (
      block !== undefined &&
      block.instructions.length === 0 &&
      block.terminator.kind === "trap"
    )
      return target;
    return writeBack(target);
  };
  if (term.kind === "jump") return { ...term, target: route(term.target) };
  if (term.kind === "branch") {
    const consequent = route(term.consequent),
      alternate =
        term.alternate === term.consequent ? consequent : route(term.alternate);
    return { ...term, consequent, alternate };
  }
  if (
    term.kind === "record" ||
    term.kind === "record-cell" ||
    term.kind === "cell"
  ) {
    const consequent = route(term.consequent),
      alternate =
        term.alternate === term.consequent ? consequent : route(term.alternate);
    return { ...term, consequent, alternate };
  }
  return term;
}

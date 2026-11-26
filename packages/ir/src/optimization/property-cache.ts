import {
  activationFieldType,
  blockSuccessors,
  instructionResult,
  naturalLoops,
  provenRecordReads,
  stableDescriptors,
  substituteInstructionValues,
  substituteTerminatorValues,
  verifierRecordWork,
  visitInstructionOperands,
  visitTerminatorOperands,
  type Block,
  type FunctionIR,
  type Instruction,
  type ModuleIR,
  type NaturalLoop,
  type ScalarType,
} from "../scalar/index.ts";
import { foreignCallTypes, foreignMemoryTypes } from "../scalar/foreign.ts";
import { hostReturnType } from "../scalar/host.ts";
import { hasScriptOperations } from "./control-flow.ts";
import type { RemarkSink } from "./observer.ts";

export interface LoopPropertyCaching {
  readonly fn: FunctionIR;
  readonly visited: number;
  readonly rewritten: number;
}

export interface ModulePropertySites {
  readonly mutatedRecordFields: ReadonlySet<string>;
  readonly siteFieldName: ReadonlyMap<string, string>;
  readonly visited: number;
}

interface SiteTableInfo {
  readonly record: number;
  readonly names: readonly (string | undefined)[];
}

/** Cap cached globals/properties per loop to keep register pressure bounded. */
const maxCachedGlobalsPerLoop = 12;
const maxCachedPropertiesPerLoop = 16;
const maxInvariantChainDepth = 8;

/** Scan the module once to collect mutated record fields and map immutable
 * `$pc` record fields initialized from `createScriptPropertyCache` calls to
 * their static property names for `property-store` disambiguation. */
export function analyzeModulePropertySites(
  module: ModuleIR,
  budget: number,
): ModulePropertySites | undefined {
  let hasScript = false;
  const siteRecords = new Set<number>();
  for (const fn of module.functions) {
    if (fn === undefined || fn.import === true) continue;
    if (!hasScript && hasScriptOperations(fn)) hasScript = true;
    for (const block of fn.blocks) {
      if (block === undefined) continue;
      for (const op of block.instructions) {
        if (
          op !== undefined &&
          (op.kind === "property-load" || op.kind === "property-store")
        )
          siteRecords.add(op.siteRecord);
      }
    }
  }
  const mutatedRecordFields = new Set<string>();
  const siteFieldName = new Map<string, string>();
  if (!hasScript) return { mutatedRecordFields, siteFieldName, visited: 0 };

  // Identify property-cache factory functions (`createScriptPropertyCache` and
  // its mangled/specialized direct twins) by IR shape: takes a `string` or
  // `optional-string` key as parameter 0 and constructs a `siteRecords` record
  // (or delegates to another factory function).
  const siteFactoryFunctions = new Set<number>();
  for (const fn of module.functions) {
    if (fn === undefined || fn.import === true) continue;
    if (fn.name.includes("createScriptPropertyCache")) {
      siteFactoryFunctions.add(fn.id);
      continue;
    }
    if (fn.returnType !== "reference" || fn.parameters.length === 0) continue;
    const p0 = fn.parameters[0];
    const p0Type = p0 === undefined ? undefined : fn.slots[p0];
    if (p0Type !== "string" && p0Type !== "optional-string") continue;
    let constructsSite = false;
    for (const block of fn.blocks) {
      if (block === undefined) continue;
      for (const op of block.instructions) {
        if (
          op !== undefined &&
          op.kind === "record-new" &&
          siteRecords.has(op.record)
        ) {
          constructsSite = true;
          break;
        }
      }
      if (constructsSite) break;
    }
    if (constructsSite) siteFactoryFunctions.add(fn.id);
  }
  // One extra pass to catch wrapper functions delegating directly to a factory.
  if (siteFactoryFunctions.size > 0) {
    for (const fn of module.functions) {
      if (
        fn === undefined ||
        fn.import === true ||
        siteFactoryFunctions.has(fn.id)
      )
        continue;
      if (fn.returnType !== "reference" || fn.parameters.length === 0) continue;
      const p0 = fn.parameters[0];
      const p0Type = p0 === undefined ? undefined : fn.slots[p0];
      if (p0Type !== "string" && p0Type !== "optional-string") continue;
      let callsFactory = false;
      for (const block of fn.blocks) {
        if (block === undefined) continue;
        for (const op of block.instructions) {
          if (
            op !== undefined &&
            op.kind === "call" &&
            siteFactoryFunctions.has(op.target)
          ) {
            callsFactory = true;
            break;
          }
        }
        if (callsFactory) break;
      }
      if (callsFactory) siteFactoryFunctions.add(fn.id);
    }
  }

  const siteFieldAmbiguous = new Set<string>();
  const writtenRecordFields = new Set<string>();
  let visited = 0;
  for (const other of module.functions) {
    if (other === undefined || other.import === true) continue;
    let hasSiteFactoryCall = false;
    for (const block of other.blocks) {
      if (block === undefined) continue;
      if (++visited > budget) return undefined;
      const term = block.terminator;
      if (
        (term.kind === "record" || term.kind === "record-cell") &&
        term.operation !== "read"
      ) {
        const fk = String(term.record) + ":" + String(term.field);
        mutatedRecordFields.add(fk);
        if (term.operation === "write") writtenRecordFields.add(fk);
      }
      if (!hasSiteFactoryCall) {
        for (const op of block.instructions) {
          if (
            op !== undefined &&
            op.kind === "call" &&
            siteFactoryFunctions.has(op.target)
          ) {
            hasSiteFactoryCall = true;
            break;
          }
        }
      }
    }
    if (!hasSiteFactoryCall) continue;
    // Propagate string literals, property-cache factory results, and chunked
    // `$pc` table field-name maps forward in RPO. Recording both leaf keys
    // (`pcRec:field`) and 2-level container keys (`envRec:envField->pcRec:field`)
    // preserves exact property names across 24-slot `$pc` chunks that share a
    // structural `RecordLayout`.
    function recordSiteField(fk: string, name: string | undefined): void {
      if (siteFieldAmbiguous.has(fk)) return;
      if (name !== undefined) {
        const prev = siteFieldName.get(fk);
        if (prev === undefined) siteFieldName.set(fk, name);
        else if (prev !== name) {
          siteFieldName.delete(fk);
          siteFieldAmbiguous.add(fk);
        }
      } else if (siteFieldName.has(fk)) {
        siteFieldName.delete(fk);
        siteFieldAmbiguous.add(fk);
      }
    }
    function recordNestedTable(
      containerRec: number,
      containerField: number,
      table: SiteTableInfo,
    ): void {
      const prefix =
        String(containerRec) +
        ":" +
        String(containerField) +
        "->" +
        String(table.record) +
        ":";
      for (let f = 0; f < table.names.length; f++) {
        recordSiteField(prefix + String(f), table.names[f]);
      }
    }
    const nBlocks = other.blocks.length;
    const seenBlk = new Uint8Array(nBlocks);
    const post: number[] = [];
    const sBlk: number[] = [other.entry];
    const sIdx: number[] = [0];
    seenBlk[other.entry] = 1;
    while (sBlk.length > 0) {
      const top = sBlk.length - 1;
      const bid = sBlk[top];
      const ni = sIdx[top];
      if (bid === undefined || ni === undefined) break;
      const blk = other.blocks[bid];
      if (blk === undefined) {
        sBlk.pop();
        sIdx.pop();
        continue;
      }
      const succs = blockSuccessors(blk);
      if (ni < succs.length) {
        sIdx[top] = ni + 1;
        const s = succs[ni];
        if (s !== undefined && seenBlk[s] === 0) {
          seenBlk[s] = 1;
          sBlk.push(s);
          sIdx.push(0);
        }
      } else {
        sBlk.pop();
        sIdx.pop();
        post.push(bid);
      }
    }
    const order: number[] = [];
    const predsOf: number[][] = [];
    for (let i = 0; i < nBlocks; i++) predsOf.push([]);
    for (let i = post.length - 1; i >= 0; i--) {
      const bid = post[i];
      if (bid !== undefined) order.push(bid);
    }
    for (const bid of order) {
      const blk = other.blocks[bid];
      if (blk === undefined) continue;
      for (const s of blockSuccessors(blk)) {
        if (s !== undefined && seenBlk[s] === 1) {
          const list = predsOf[s];
          if (list !== undefined && list.indexOf(bid) < 0) list.push(bid);
        }
      }
    }
    const outStr = new Map<number, Map<number, string>>();
    const outSite = new Map<number, Map<number, string>>();
    const outTable = new Map<number, Map<number, SiteTableInfo>>();
    for (const bid of order) {
      const blk = other.blocks[bid];
      if (blk === undefined) continue;
      if (++visited > budget) return undefined;
      const curSlotStr = new Map<number, string>();
      const curSlotSite = new Map<number, string>();
      const curSlotTable = new Map<number, SiteTableInfo>();
      const ps = predsOf[bid];
      if (bid !== other.entry && ps !== undefined && ps.length > 0) {
        const ready: number[] = [];
        for (const p of ps)
          if (p !== undefined && outSite.has(p)) ready.push(p);
        const first = ready[0];
        if (first !== undefined) {
          const fStr = outStr.get(first);
          const fSite = outSite.get(first);
          const fTable = outTable.get(first);
          if (fStr !== undefined) {
            for (const [k, v] of fStr) {
              let ok = true;
              for (let j = 1; j < ready.length; j++) {
                const p = ready[j];
                if (p === undefined || outStr.get(p)?.get(k) !== v) {
                  ok = false;
                  break;
                }
              }
              if (ok) curSlotStr.set(k, v);
            }
          }
          if (fSite !== undefined) {
            for (const [k, v] of fSite) {
              let ok = true;
              for (let j = 1; j < ready.length; j++) {
                const p = ready[j];
                if (p === undefined || outSite.get(p)?.get(k) !== v) {
                  ok = false;
                  break;
                }
              }
              if (ok) curSlotSite.set(k, v);
            }
          }
          if (fTable !== undefined) {
            for (const [k, v] of fTable) {
              let ok = true;
              for (let j = 1; j < ready.length; j++) {
                const p = ready[j];
                if (p === undefined || outTable.get(p)?.get(k) !== v) {
                  ok = false;
                  break;
                }
              }
              if (ok) curSlotTable.set(k, v);
            }
          }
        }
      }
      const strLits = new Map<number, string>();
      const valSiteName = new Map<number, string>();
      const valSiteTable = new Map<number, SiteTableInfo>();
      for (const op of blk.instructions) {
        if (op === undefined) continue;
        if (op.kind === "string-literal") {
          strLits.set(op.id, op.value);
        } else if (op.kind === "string-wrap") {
          const s = strLits.get(op.value);
          if (s !== undefined) strLits.set(op.id, s);
        } else if (op.kind === "load") {
          const s = curSlotStr.get(op.slot);
          if (s !== undefined) strLits.set(op.id, s);
          const sn = curSlotSite.get(op.slot);
          if (sn !== undefined) valSiteName.set(op.id, sn);
          const tbl = curSlotTable.get(op.slot);
          if (tbl !== undefined) valSiteTable.set(op.id, tbl);
        } else if (op.kind === "call") {
          const callId = op.id;
          if (siteFactoryFunctions.has(op.target) && callId !== undefined) {
            const arg0 = op.arguments[0];
            const lit = arg0 === undefined ? undefined : strLits.get(arg0);
            if (lit !== undefined) valSiteName.set(callId, lit);
          }
        } else if (op.kind === "store") {
          const s = strLits.get(op.value);
          if (s !== undefined) curSlotStr.set(op.slot, s);
          else curSlotStr.delete(op.slot);
          const sn = valSiteName.get(op.value);
          if (sn !== undefined) curSlotSite.set(op.slot, sn);
          else curSlotSite.delete(op.slot);
          const tbl = valSiteTable.get(op.value);
          if (tbl !== undefined) curSlotTable.set(op.slot, tbl);
          else curSlotTable.delete(op.slot);
        } else if (op.kind === "record-new") {
          const names: (string | undefined)[] = [];
          let hasSiteArg = false;
          for (let f = 0; f < op.arguments.length; f++) {
            const argId = op.arguments[f];
            const name =
              argId === undefined ? undefined : valSiteName.get(argId);
            names.push(name);
            if (name !== undefined) hasSiteArg = true;
            recordSiteField(String(op.record) + ":" + String(f), name);
            const nested =
              argId === undefined ? undefined : valSiteTable.get(argId);
            if (nested !== undefined) recordNestedTable(op.record, f, nested);
          }
          if (hasSiteArg) valSiteTable.set(op.id, { record: op.record, names });
        }
      }
      const term = blk.terminator;
      if (
        (term.kind === "record" ||
          term.kind === "record-cell" ||
          term.kind === "cell") &&
        term.operation === "read"
      ) {
        curSlotStr.delete(term.slot);
        curSlotSite.delete(term.slot);
        curSlotTable.delete(term.slot);
      } else if (
        (term.kind === "record" || term.kind === "record-cell") &&
        term.operation !== "read"
      ) {
        const tbl = curSlotTable.get(term.slot);
        if (tbl !== undefined) recordNestedTable(term.record, term.field, tbl);
      }
      outStr.set(bid, curSlotStr);
      outSite.set(bid, curSlotSite);
      outTable.set(bid, curSlotTable);
    }
  }
  for (const fk of mutatedRecordFields) siteFieldName.delete(fk);
  if (writtenRecordFields.size > 0) {
    const staleKeys: string[] = [];
    for (const [key] of siteFieldName) {
      const arrow = key.indexOf("->");
      if (arrow > 0) {
        const parent = key.slice(0, arrow);
        const child = key.slice(arrow + 2);
        if (writtenRecordFields.has(parent) || mutatedRecordFields.has(child))
          staleKeys.push(key);
      }
    }
    for (const key of staleKeys) siteFieldName.delete(key);
  }
  return { mutatedRecordFields, siteFieldName, visited };
}

/** Property keys that cannot alias another distinct named property via an
 * inline `property-store` (which only writes/adds a single writable own data
 * property on a non-dictionary, non-prototype ordinary object). Excludes
 * `"length"`, `"__proto__"`, and canonical array-index strings. */
function isSafeDisambiguatedKey(key: string): boolean {
  if (key.length === 0 || key === "length" || key === "__proto__") return false;
  let allDigits = true;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code < 48 || code > 57) {
      allDigits = false;
      break;
    }
  }
  return !allDigits;
}

function storeConflictsWithLoad(
  storeKey: string | undefined,
  loadKey: string | undefined,
): boolean {
  if (
    storeKey === undefined ||
    loadKey === undefined ||
    !isSafeDisambiguatedKey(storeKey) ||
    !isSafeDisambiguatedKey(loadKey)
  )
    return true;
  return storeKey === loadKey;
}

/** A pure, non-trapping expression traceable to loop-invariant slots. */
type InvariantExpr =
  | { readonly kind: "slot"; readonly slot: number; readonly type: ScalarType }
  | {
      readonly kind: "constant";
      readonly value: number | boolean;
    }
  | { readonly kind: "closure-env" }
  | { readonly kind: "function-env"; readonly callee: InvariantExpr }
  | {
      readonly kind: "record-read";
      readonly object: InvariantExpr;
      readonly record: number;
      readonly field: number;
      readonly fieldType: ScalarType;
      readonly proven: boolean;
    };

function exprKey(expr: InvariantExpr): string {
  switch (expr.kind) {
    case "slot":
      return "s" + String(expr.slot);
    case "constant": {
      const val = expr.value;
      return (
        "c" +
        (typeof val === "boolean" ? (val ? "true" : "false") : String(val))
      );
    }
    case "closure-env":
      return "ce";
    case "function-env":
      return "e(" + exprKey(expr.callee) + ")";
    case "record-read":
      return (
        "r(" +
        exprKey(expr.object) +
        "," +
        String(expr.record) +
        "," +
        String(expr.field) +
        ")"
      );
  }
}

interface GlobalCellOp {
  readonly kind: "global-cell";
  readonly id: number;
  readonly scope: number;
  readonly cache: number;
  readonly scopeRecord: number;
  readonly declarativeField: number;
  readonly objectField: number;
  readonly globalField: number;
  readonly globalRecord: number;
  readonly lexicalEpochField: number;
  readonly globalObjectField: number;
  readonly globalObjectRecord: number;
  readonly propertyEpochField: number;
  readonly cacheRecord: number;
  readonly cacheGlobalField: number;
  readonly cacheLexicalEpochField: number;
  readonly cacheObjectEpochField: number;
  readonly cacheCellField: number;
  readonly start: number;
  readonly end: number;
}

interface PropertyLoadOp {
  readonly kind: "property-load";
  readonly id: number;
  readonly object: number;
  readonly site: number;
  readonly record: number;
  readonly field: number;
  readonly count: number;
  readonly siteRecord: number;
  readonly siteField: number;
  readonly inherited: boolean;
  readonly entries: number;
  readonly epochRecord: number;
  readonly epochField: number;
  readonly spillRecord?: number;
  readonly spillField?: number;
  readonly start: number;
  readonly end: number;
}

interface CachedGlobal {
  readonly key: string;
  readonly template: GlobalCellOp;
  readonly scope: InvariantExpr;
  readonly cache: InvariantExpr;
  readonly cellSlot: number;
  /** Optional cached `GlobalCell.value` field read when the loop reads the
   * cell's general value (enables chaining into `property-load`, e.g. Math.*). */
  cellRecord?: number;
  valueField?: number;
  valSlot?: number;
}

interface LoopStoreOp {
  readonly op: Instruction;
  readonly blockId: number;
  readonly key: string | undefined;
}

interface CachedProperty {
  readonly key: string;
  readonly template: PropertyLoadOp;
  /** Either a direct loop-invariant general slot, a cold-written general slot
   * refreshed on every in-loop store, a cached global's valSlot, or a parent
   * cached property's propSlot. */
  readonly objectSlot: number;
  readonly fromGlobal: CachedGlobal | undefined;
  readonly fromProp: CachedProperty | undefined;
  /** When `objectSlot` is written only on cold branches in the loop, the store
   * instructions after which `propSlot` must be refreshed. */
  readonly objectWriteOps: readonly Instruction[] | undefined;
  /** Conflicting `property-store` instructions inside the loop after which
   * `propSlot` must be refreshed. */
  readonly storeRefreshOps: readonly Instruction[];
  readonly propKey: string | undefined;
  readonly site: InvariantExpr;
  readonly propSlot: number;
}

interface LoopInfo {
  readonly preheader: Block;
  readonly invalidatingOps: ReadonlySet<Instruction>;
  readonly invalidatingTerminators: ReadonlySet<number>;
  readonly invalidatingBlocks: ReadonlySet<number>;
  /** Direct `property-store` instructions in the loop (disambiguated by static
   * property name; never invalidate `global-cell` because `global-cell` only
   * caches on `internalDictionary` global objects where `property-store`
   * always misses). */
  readonly storeOps: readonly LoopStoreOp[];
  readonly writtenSlots: ReadonlySet<number>;
  /** For slots written by exactly one `store` instruction in the loop (and no
   * terminator writes), maps `slot -> stored SSA value id`. */
  readonly singleStoreValue: ReadonlyMap<number, number>;
  /** For slots written by exactly one `record` read terminator in the loop
   * (and no other writes), maps `slot -> { object, record, field }`. */
  readonly singleRecordRead: ReadonlyMap<
    number,
    { readonly object: number; readonly record: number; readonly field: number }
  >;
}

interface GlobalCountEntry {
  count: number;
  template: GlobalCellOp;
  scope: InvariantExpr;
  cache: InvariantExpr;
}

interface PropCountEntry {
  count: number;
  template: PropertyLoadOp;
  objectSlot: number;
  fromGlobal: CachedGlobal | undefined;
  fromProp: CachedProperty | undefined;
  objectWriteOps: readonly Instruction[] | undefined;
  storeRefreshOps: readonly Instruction[];
  propKey: string | undefined;
  site: InvariantExpr;
}

interface InitEdge {
  readonly from: number;
  readonly exceptional: boolean;
  readonly excSlot: number | undefined;
  readonly termReadSlot: number | undefined;
}

interface RefreshSet {
  readonly globals: CachedGlobal[];
  readonly props: CachedProperty[];
  readonly seenGlobals: Set<CachedGlobal>;
  readonly seenProps: Set<CachedProperty>;
}

/**
 * Caches loop-invariant `global-cell` and `property-load` results (plus
 * `GlobalCell.value` for chained loads like `Math.floor`) in natural-loop
 * preheaders, refreshing them immediately after any cold property-invalidating
 * call or store inside the loop.
 *
 * Both `global-cell` and `property-load` are pure, side-effect-free probes
 * that return `undefined` / `absent` on miss without invoking getters or
 * throwing. Refreshing after cold invalidation sites both preserves exact
 * mutation semantics and immediately warms the cache after iteration-0 cold
 * IC misses.
 *
 * Direct calls whose transitive call graph never executes an indirect call,
 * host call, property store, or write to any record read by `global-cell` /
 * `property-load` (such as `ScriptMap` helpers) do not invalidate cached
 * properties.
 */
export function cacheLoopProperties(
  fn: FunctionIR,
  module: ModuleIR,
  budget: number,
  remarks?: RemarkSink,
  shared?: ModulePropertySites,
): LoopPropertyCaching | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  if (fn.import === true || fn.blocks.length === 0 || !hasScriptOperations(fn))
    return { fn, visited: 0, rewritten: 0 };

  let visited = 0,
    candidates = 0,
    nextValue = 0,
    nextBlock = fn.blocks.length;
  const watchedRecords = new Set<number>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "property cache block invariant";
    if (block.id >= nextBlock) nextBlock = block.id + 1;
    for (const op of block.instructions) {
      if (op === undefined) throw "property cache instruction invariant";
      if (++visited > budget) return undefined;
      const id = instructionResult(op);
      if (id !== undefined && id >= nextValue) nextValue = id + 1;
      if (op.kind === "global-cell") {
        candidates++;
        watchedRecords.add(op.scopeRecord);
        watchedRecords.add(op.globalRecord);
        watchedRecords.add(op.globalObjectRecord);
        watchedRecords.add(op.cacheRecord);
      } else if (op.kind === "property-load") {
        candidates++;
        watchedRecords.add(op.record);
        watchedRecords.add(op.siteRecord);
        watchedRecords.add(op.epochRecord);
        if (op.spillRecord !== undefined) watchedRecords.add(op.spillRecord);
      }
    }
  }
  if (candidates === 0) return { fn, visited, rewritten: 0 };

  const forest = naturalLoops(fn, Math.max(1, budget - visited));
  if (forest === undefined) return undefined;
  visited += forest.visited;
  if (forest.loops.length === 0) return { fn, visited, rewritten: 0 };

  const predecessors = new Map<number, number[]>();
  const definitions = new Map<number, Instruction>();
  const blockOfDef = new Map<number, number>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "property cache block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "property cache instruction invariant";
      visited++;
      const id = instructionResult(op);
      if (id !== undefined) {
        definitions.set(id, op);
        blockOfDef.set(id, block.id);
      }
    }
    for (const target of blockSuccessors(block)) {
      if (target === undefined) throw "property cache successor invariant";
      let list = predecessors.get(target);
      if (list === undefined) {
        list = [];
        predecessors.set(target, list);
      }
      list.push(block.id);
    }
  }
  if (visited > budget) return undefined;

  // Exact definite-initialization analysis at block exits (matching verify())
  // so hoisted preheader loads never read a slot uninitialized on any incoming
  // path reaching the loop preheader.
  const blockCount = fn.blocks.length;
  const paramSlots = new Uint8Array(fn.slots.length);
  for (const p of fn.parameters) {
    if (p !== undefined) paramSlots[p] = 1;
  }
  if (fn.receiverSlot !== undefined) paramSlots[fn.receiverSlot] = 1;
  const fnReachable = new Uint8Array(blockCount);
  const incomingEdges: InitEdge[][] = [];
  for (let i = 0; i < blockCount; i++) incomingEdges.push([]);
  {
    const rq: number[] = [fn.entry];
    fnReachable[fn.entry] = 1;
    for (let cursor = 0; cursor < rq.length; cursor++) {
      const id = rq[cursor];
      if (id === undefined) continue;
      const b = fn.blocks[id];
      if (b === undefined) continue;
      for (const next of blockSuccessors(b)) {
        if (next !== undefined && fnReachable[next] === 0) {
          fnReachable[next] = 1;
          rq.push(next);
        }
      }
      const bExc = b.exception;
      if (bExc !== undefined && fnReachable[bExc.target] === 0) {
        fnReachable[bExc.target] = 1;
        rq.push(bExc.target);
      }
    }
    for (const b of fn.blocks) {
      if (b === undefined || fnReachable[b.id] === 0) continue;
      const t = b.terminator;
      if (t.kind === "jump") {
        incomingEdges[t.target]?.push({
          from: b.id,
          exceptional: false,
          excSlot: undefined,
          termReadSlot: undefined,
        });
      } else if (
        t.kind === "branch" ||
        t.kind === "cell" ||
        t.kind === "record" ||
        t.kind === "record-cell"
      ) {
        const readSlot =
          t.kind !== "branch" &&
          t.operation === "read" &&
          t.consequent !== t.alternate
            ? t.slot
            : undefined;
        incomingEdges[t.consequent]?.push({
          from: b.id,
          exceptional: false,
          excSlot: undefined,
          termReadSlot: readSlot,
        });
        incomingEdges[t.alternate]?.push({
          from: b.id,
          exceptional: false,
          excSlot: undefined,
          termReadSlot: undefined,
        });
      }
      const bExc = b.exception;
      if (bExc !== undefined) {
        incomingEdges[bExc.target]?.push({
          from: b.id,
          exceptional: true,
          excSlot: bExc.slot,
          termReadSlot: undefined,
        });
      }
    }
  }
  const slotInitCache: (Uint8Array | undefined)[] = [];
  for (let s = 0; s < fn.slots.length; s++) slotInitCache.push(undefined);
  function isSlotInitAtExit(blockId: number, slot: number): boolean {
    if (paramSlots[slot] === 1) return true;
    let outInit = slotInitCache[slot];
    if (outInit === undefined) {
      const inInit = new Uint8Array(blockCount);
      outInit = new Uint8Array(blockCount);
      const writes = new Uint8Array(blockCount);
      for (let i = 0; i < blockCount; i++) {
        if (fnReachable[i] === 0) continue;
        const b = fn.blocks[i];
        if (b !== undefined) {
          for (const op of b.instructions) {
            if (op !== undefined && op.kind === "store" && op.slot === slot) {
              writes[i] = 1;
              break;
            }
          }
        }
        inInit[i] = i === fn.entry ? 0 : 1;
        outInit[i] = inInit[i] === 1 || writes[i] === 1 ? 1 : 0;
      }
      let changed = true;
      for (let iter = 0; changed && iter <= blockCount + 1; iter++) {
        changed = false;
        for (let i = 0; i < blockCount; i++) {
          if (fnReachable[i] === 0 || i === fn.entry || inInit[i] === 0)
            continue;
          const edges = incomingEdges[i];
          if (edges === undefined || edges.length === 0) {
            inInit[i] = 0;
            outInit[i] = writes[i] ?? 0;
            changed = true;
            continue;
          }
          for (const e of edges) {
            if (e === undefined) continue;
            const ok = e.exceptional
              ? e.excSlot === slot
              : outInit[e.from] === 1 || e.termReadSlot === slot;
            if (!ok) {
              inInit[i] = 0;
              outInit[i] = writes[i] ?? 0;
              changed = true;
              break;
            }
          }
        }
      }
      slotInitCache[slot] = outInit;
    }
    return outInit[blockId] === 1;
  }
  function exprInitAtExit(blockId: number, expr: InvariantExpr): boolean {
    switch (expr.kind) {
      case "slot":
        return isSlotInitAtExit(blockId, expr.slot);
      case "constant":
      case "closure-env":
        return true;
      case "function-env":
        return exprInitAtExit(blockId, expr.callee);
      case "record-read":
        return exprInitAtExit(blockId, expr.object);
    }
  }

  // Include GlobalCell record descriptors read from global-cell results in
  // watchedRecords so any callee that writes a GlobalCell invalidates caches.
  const globalCellIds = new Set<number>();
  const globalCellSlots = new Set<number>();
  for (const block of fn.blocks) {
    if (block === undefined) continue;
    for (const op of block.instructions) {
      if (op === undefined) continue;
      if (op.kind === "global-cell") globalCellIds.add(op.id);
      else if (op.kind === "store" && globalCellIds.has(op.value))
        globalCellSlots.add(op.slot);
    }
  }
  function derivesFromGlobalCell(valueId: number): boolean {
    let cur = valueId;
    for (let depth = 0; depth < 6; depth++) {
      if (globalCellIds.has(cur)) return true;
      const def = definitions.get(cur);
      if (def === undefined) return false;
      if (def.kind === "reference-value") cur = def.value;
      else if (def.kind === "load") return globalCellSlots.has(def.slot);
      else return false;
    }
    return false;
  }
  for (const block of fn.blocks) {
    if (block === undefined) continue;
    for (const op of block.instructions) {
      if (
        op !== undefined &&
        op.kind === "record-read" &&
        derivesFromGlobalCell(op.object)
      )
        watchedRecords.add(op.record);
    }
    const term = block.terminator;
    if (
      term.kind === "record" &&
      term.operation === "read" &&
      derivesFromGlobalCell(term.object)
    )
      watchedRecords.add(term.record);
  }

  const sites =
    shared ?? analyzeModulePropertySites(module, Math.max(1, budget - visited));
  if (sites === undefined) return undefined;
  if (shared === undefined) visited += sites.visited;
  const mutatedRecordFields = sites.mutatedRecordFields;
  const siteFieldName = sites.siteFieldName;

  function siteExprPropName(expr: InvariantExpr): string | undefined {
    if (expr.kind !== "record-read") return undefined;
    const leaf = String(expr.record) + ":" + String(expr.field);
    const parent = expr.object;
    if (parent.kind === "record-read") {
      const nested = siteFieldName.get(
        String(parent.record) + ":" + String(parent.field) + "->" + leaf,
      );
      if (nested !== undefined) return nested;
    }
    return siteFieldName.get(leaf);
  }

  // Whole-module call-effect memoization: a direct callee is property-safe iff
  // neither it nor any transitive callee can execute an indirect/host/callback
  // call, property-store, or write to any record in watchedRecords.
  // 0 = computing, 1 = clean, 2 = invalidates.
  const callState = new Map<number, number>();
  const callReason = new Map<number, string>();
  let effectBudgetExhausted = false;
  function calleeInvalidates(targetId: number): boolean {
    const cached = callState.get(targetId);
    if (cached === 1) return false;
    if (cached === 2) return true;
    if (cached === 0) return false; // recursion cycle without other effects
    const target = module.functions[targetId];
    if (target === undefined || target.import === true) {
      callState.set(targetId, 2);
      callReason.set(targetId, "import:" + (target?.name ?? String(targetId)));
      return true;
    }
    callState.set(targetId, 0);
    const directCallees: number[] = [];
    for (const block of target.blocks) {
      if (block === undefined) continue;
      if (++visited > budget) {
        effectBudgetExhausted = true;
        callState.set(targetId, 2);
        callReason.set(targetId, "budget");
        return true;
      }
      const term = block.terminator;
      if (
        (term.kind === "record" || term.kind === "record-cell") &&
        term.operation !== "read" &&
        watchedRecords.has(term.record)
      ) {
        callState.set(targetId, 2);
        callReason.set(
          targetId,
          "write-rec:" + String(term.record) + "@" + target.name,
        );
        return true;
      }
      for (const op of block.instructions) {
        if (op === undefined) continue;
        if (
          op.kind === "call-indirect" ||
          op.kind === "host-call" ||
          op.kind === "property-store" ||
          (op.kind === "c-call" && op.call.mayCallback === true)
        ) {
          callState.set(targetId, 2);
          callReason.set(targetId, op.kind + "@" + target.name);
          return true;
        }
        if (op.kind === "call") directCallees.push(op.target);
      }
    }
    for (const sub of directCallees) {
      if (sub === undefined) continue;
      if (calleeInvalidates(sub)) {
        callState.set(targetId, 2);
        callReason.set(
          targetId,
          target.name + "->" + (callReason.get(sub) ?? "?"),
        );
        return true;
      }
    }
    callState.set(targetId, 1);
    return false;
  }

  function mayHardInvalidateProperties(op: Instruction): boolean {
    if (
      op.kind === "call-indirect" ||
      op.kind === "host-call" ||
      (op.kind === "c-call" && op.call.mayCallback === true)
    )
      return true;
    if (op.kind === "call") return calleeInvalidates(op.target);
    return false;
  }

  // Enclosing loops ordered outermost to innermost.
  const sortedLoops = forest.loops.slice();
  sortedLoops.sort((a, b) => b.body.size - a.body.size);
  const enclosing = new Map<number, NaturalLoop[]>();
  for (const loop of sortedLoops) {
    if (loop === undefined) throw "property cache loop invariant";
    for (const id of loop.body) {
      let list = enclosing.get(id);
      if (list === undefined) {
        list = [];
        enclosing.set(id, list);
      }
      list.push(loop);
    }
  }

  function hasCleanIteration(
    loop: NaturalLoop,
    invalidatingBlocks: ReadonlySet<number>,
    hitBlockers?: Set<number>,
  ): boolean {
    if (invalidatingBlocks.size === 0) return true;
    if (invalidatingBlocks.has(loop.header)) {
      hitBlockers?.add(loop.header);
      return false;
    }
    const latches = new Set<number>();
    for (const latch of loop.latches)
      if (latch !== undefined) latches.add(latch);
    const seen = new Set<number>();
    seen.add(loop.header);
    const queue: number[] = [loop.header];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor];
      if (id === undefined) continue;
      visited++;
      if (latches.has(id)) return true;
      const block = fn.blocks[id];
      if (block === undefined) continue;
      for (const next of blockSuccessors(block)) {
        if (next === undefined) continue;
        if (!loop.body.has(next) || seen.has(next)) continue;
        if (invalidatingBlocks.has(next)) {
          hitBlockers?.add(next);
          continue;
        }
        seen.add(next);
        queue.push(next);
      }
    }
    return false;
  }

  function preheader(loop: NaturalLoop): Block | undefined {
    const outside: number[] = [];
    for (const id of predecessors.get(loop.header) ?? [])
      if (!loop.body.has(id)) outside.push(id);
    const id = outside[0];
    if (outside.length !== 1 || id === undefined) return undefined;
    const block = fn.blocks[id];
    return block !== undefined &&
      block.terminator.kind === "jump" &&
      block.exception === undefined
      ? block
      : undefined;
  }

  const loopInfo = new Map<NaturalLoop, LoopInfo | undefined>();
  const loopRejectReason = new Map<NaturalLoop, string>();
  function inspectLoop(loop: NaturalLoop): LoopInfo | undefined {
    if (loopInfo.has(loop)) return loopInfo.get(loop);
    const entry = preheader(loop);
    if (entry === undefined) {
      loopInfo.set(loop, undefined);
      loopRejectReason.set(loop, "no-preheader");
      return undefined;
    }
    const invalidatingOps = new Set<Instruction>();
    const invalidatingTerminators = new Set<number>();
    const invalidatingBlocks = new Set<number>();
    const rawStoreOps: {
      readonly op: Instruction;
      readonly blockId: number;
      readonly site: number;
    }[] = [];
    const writtenSlots = new Set<number>();
    for (const w of loop.writes) writtenSlots.add(w);
    const singleStoreValue = new Map<number, number>();
    const singleRecordRead = new Map<
      number,
      {
        readonly object: number;
        readonly record: number;
        readonly field: number;
      }
    >();
    const multiWriteSlots = new Set<number>();
    function markWrite(
      slot: number,
      storeVal?: number,
      recRead?: {
        readonly object: number;
        readonly record: number;
        readonly field: number;
      },
    ): void {
      if (multiWriteSlots.has(slot)) return;
      if (singleStoreValue.has(slot) || singleRecordRead.has(slot)) {
        singleStoreValue.delete(slot);
        singleRecordRead.delete(slot);
        multiWriteSlots.add(slot);
        return;
      }
      if (storeVal !== undefined) singleStoreValue.set(slot, storeVal);
      else if (recRead !== undefined) singleRecordRead.set(slot, recRead);
      else multiWriteSlots.add(slot);
    }
    for (const id of loop.body) {
      const block = fn.blocks[id];
      if (block === undefined) {
        loopInfo.set(loop, undefined);
        loopRejectReason.set(loop, "missing-block");
        return undefined;
      }
      // Reject irreducible loops (including cycles covering fn.entry).
      if (id === fn.entry) {
        loopInfo.set(loop, undefined);
        loopRejectReason.set(loop, "irreducible");
        return undefined;
      }
      if (id !== loop.header) {
        for (const from of predecessors.get(id) ?? []) {
          if (!loop.body.has(from)) {
            loopInfo.set(loop, undefined);
            loopRejectReason.set(loop, "irreducible");
            return undefined;
          }
        }
      }
      // Reject loops with an internal exception handler.
      if (
        block.exception !== undefined &&
        loop.body.has(block.exception.target)
      ) {
        loopInfo.set(loop, undefined);
        loopRejectReason.set(loop, "internal-exception");
        return undefined;
      }
      const term = block.terminator;
      if (
        term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell"
      ) {
        if (term.operation === "read") {
          writtenSlots.add(term.slot);
          if (term.kind === "record") {
            markWrite(term.slot, undefined, {
              object: term.object,
              record: term.record,
              field: term.field,
            });
          } else {
            markWrite(term.slot);
          }
        } else if (term.kind !== "record" || watchedRecords.has(term.record)) {
          invalidatingTerminators.add(id);
          invalidatingBlocks.add(id);
        }
      }
      for (const op of block.instructions) {
        if (op === undefined) throw "property cache instruction invariant";
        visited++;
        if (op.kind === "store") markWrite(op.slot, op.value);
        if (op.kind === "property-store") {
          rawStoreOps.push({ op, blockId: id, site: op.site });
        } else if (mayHardInvalidateProperties(op)) {
          invalidatingOps.add(op);
          invalidatingBlocks.add(id);
        }
      }
    }
    for (const slot of multiWriteSlots) {
      singleStoreValue.delete(slot);
      singleRecordRead.delete(slot);
    }
    if (effectBudgetExhausted) return undefined;
    const hitBlockers = new Set<number>();
    if (!hasCleanIteration(loop, invalidatingBlocks, hitBlockers)) {
      loopInfo.set(loop, undefined);
      const reasons: string[] = [];
      for (const bId of hitBlockers) {
        if (reasons.length >= 4) break;
        const b = fn.blocks[bId];
        if (b === undefined) continue;
        for (const op of b.instructions) {
          if (op !== undefined && invalidatingOps.has(op)) {
            reasons.push(
              op.kind === "call"
                ? "b" +
                    String(bId) +
                    ":call(" +
                    (callReason.get(op.target) ?? "?") +
                    ")"
                : "b" + String(bId) + ":" + op.kind,
            );
          }
        }
        if (invalidatingTerminators.has(bId))
          reasons.push("b" + String(bId) + ":write-term");
      }
      loopRejectReason.set(loop, "no-clean-iter:" + reasons.join(","));
      return undefined;
    }
    const storeOps: LoopStoreOp[] = [];
    const info: LoopInfo = {
      preheader: entry,
      invalidatingOps,
      invalidatingTerminators,
      invalidatingBlocks,
      storeOps,
      writtenSlots,
      singleStoreValue,
      singleRecordRead,
    };
    for (const raw of rawStoreOps) {
      const siteExpr = traceInvariant(raw.site, info, true);
      const key =
        siteExpr === undefined ? undefined : siteExprPropName(siteExpr);
      storeOps.push({ op: raw.op, blockId: raw.blockId, key });
    }
    loopInfo.set(loop, info);
    return info;
  }

  function traceRecordField(
    objectId: number,
    record: number,
    fieldIdx: number,
    proven: boolean,
    info: LoopInfo,
    requireNonNullRef: boolean,
    depth: number,
  ): InvariantExpr | undefined {
    const field = module.records?.[record]?.fields[fieldIdx];
    if (field === undefined) return undefined;
    const immutable =
      !field.mutable ||
      !mutatedRecordFields.has(String(record) + ":" + String(fieldIdx));
    if (!immutable) return undefined;
    if (requireNonNullRef && field.type !== "reference") return undefined;
    const object = traceInvariant(objectId, info, true, depth + 1);
    return object === undefined
      ? undefined
      : {
          kind: "record-read",
          object,
          record,
          field: fieldIdx,
          fieldType: field.type,
          proven,
        };
  }

  /** Trace a non-trapping, loop-invariant expression whose root slots are
   * non-optional references (for record-read chains) or invariant slots.
   * Resolves same-block and single-predecessor temp slot spills created by
   * `compact-slots` or `record` read terminators. */
  function traceInvariant(
    valueId: number,
    info: LoopInfo,
    requireNonNullRef: boolean,
    depth: number = 0,
  ): InvariantExpr | undefined {
    if (depth > maxInvariantChainDepth) return undefined;
    const def = definitions.get(valueId);
    if (def === undefined) return undefined;
    if (def.kind === "closure-environment") {
      return { kind: "closure-env" };
    }
    if (def.kind === "load") {
      const type = fn.slots[def.slot];
      if (type === undefined) return undefined;
      if (requireNonNullRef && type !== "reference") return undefined;
      if (!info.writtenSlots.has(def.slot))
        return { kind: "slot", slot: def.slot, type };
      // Walk backward in the defining block, and through up to 2 unique
      // single-predecessor blocks (e.g. a `record` read terminator whose
      // consequent immediately loads its result slot).
      let curBlockId = blockOfDef.get(valueId);
      let scanFromDef = true;
      for (let hop = 0; hop < 3 && curBlockId !== undefined; hop++) {
        const curBlock = fn.blocks[curBlockId];
        if (curBlock === undefined) break;
        let startIdx = curBlock.instructions.length - 1;
        if (scanFromDef) {
          startIdx = -1;
          for (let i = 0; i < curBlock.instructions.length; i++) {
            if (curBlock.instructions[i] === def) {
              startIdx = i - 1;
              break;
            }
          }
          scanFromDef = false;
        }
        for (let i = startIdx; i >= 0; i--) {
          const prev = curBlock.instructions[i];
          if (
            prev !== undefined &&
            prev.kind === "store" &&
            prev.slot === def.slot
          ) {
            return traceInvariant(
              prev.value,
              info,
              requireNonNullRef,
              depth + 1,
            );
          }
        }
        const preds = predecessors.get(curBlockId);
        if (preds === undefined || preds.length !== 1) break;
        const predId = preds[0];
        if (predId === undefined) break;
        const predBlock = fn.blocks[predId];
        if (predBlock === undefined) break;
        const pTerm = predBlock.terminator;
        if (
          pTerm.kind === "record" &&
          pTerm.operation === "read" &&
          pTerm.slot === def.slot &&
          pTerm.consequent === curBlockId
        ) {
          return traceRecordField(
            pTerm.object,
            pTerm.record,
            pTerm.field,
            false,
            info,
            requireNonNullRef,
            depth,
          );
        }
        if (pTerm.kind !== "jump" && pTerm.kind !== "record") break;
        curBlockId = predId;
      }
      const single = info.singleStoreValue.get(def.slot);
      if (single !== undefined)
        return traceInvariant(single, info, requireNonNullRef, depth + 1);
      const singleRec = info.singleRecordRead.get(def.slot);
      if (singleRec !== undefined)
        return traceRecordField(
          singleRec.object,
          singleRec.record,
          singleRec.field,
          false,
          info,
          requireNonNullRef,
          depth,
        );
      return undefined;
    }
    if (def.kind === "constant" && !requireNonNullRef)
      return { kind: "constant", value: def.value };
    if (def.kind === "function-environment") {
      if (requireNonNullRef) return undefined;
      const callee = traceInvariant(def.callee, info, true, depth + 1);
      return callee === undefined
        ? undefined
        : { kind: "function-env", callee };
    }
    if (def.kind === "record-read") {
      return traceRecordField(
        def.object,
        def.record,
        def.field,
        true,
        info,
        requireNonNullRef,
        depth,
      );
    }
    return undefined;
  }

  const slots: ScalarType[] = fn.slots.slice();

  // Phase 1: Select loop-invariant global-cell candidates per loop.
  const globalCounts = new Map<NaturalLoop, Map<string, GlobalCountEntry>>();
  const globalOpTarget = new Map<
    GlobalCellOp,
    { readonly loop: NaturalLoop; readonly key: string }
  >();

  for (const block of fn.blocks) {
    if (block === undefined) continue;
    const loops = enclosing.get(block.id);
    if (loops === undefined) continue;
    const weight = loops.length <= 1 ? 1 : loops.length === 2 ? 4 : 16;
    for (const op of block.instructions) {
      if (op === undefined || op.kind !== "global-cell") continue;
      for (const loop of loops) {
        if (loop === undefined) continue;
        const info = inspectLoop(loop);
        if (info === undefined) {
          remarks?.({
            pass: "cache-loop-properties",
            outcome: "missed",
            function: fn.name,
            start: op.start,
            end: op.end,
            message:
              "global-cell loop rejected (no preheader or no clean iteration)",
          });
          continue;
        }
        const scope = traceInvariant(op.scope, info, true);
        const cache = traceInvariant(op.cache, info, true);
        if (
          scope === undefined ||
          cache === undefined ||
          !exprInitAtExit(info.preheader.id, scope) ||
          !exprInitAtExit(info.preheader.id, cache)
        ) {
          remarks?.({
            pass: "cache-loop-properties",
            outcome: "missed",
            function: fn.name,
            start: op.start,
            end: op.end,
            message:
              "global-cell operand not invariant: scope=" +
              (scope === undefined
                ? (definitions.get(op.scope)?.kind ?? "?")
                : "ok") +
              " cache=" +
              (cache === undefined
                ? (definitions.get(op.cache)?.kind ?? "?")
                : "ok"),
          });
          continue;
        }
        const key =
          exprKey(scope) +
          "|" +
          exprKey(cache) +
          "|" +
          String(op.scopeRecord) +
          "|" +
          String(op.cacheRecord);
        let map = globalCounts.get(loop);
        if (map === undefined) {
          map = new Map<string, GlobalCountEntry>();
          globalCounts.set(loop, map);
        }
        const entry = map.get(key);
        if (entry === undefined)
          map.set(key, { count: weight, template: op, scope, cache });
        else entry.count += weight;
        globalOpTarget.set(op, { loop, key });
        break;
      }
    }
  }
  if (effectBudgetExhausted) return undefined;

  const selectedGlobals = new Map<NaturalLoop, Map<string, CachedGlobal>>();
  for (const [loop, counts] of globalCounts) {
    const entries: { readonly key: string; readonly item: GlobalCountEntry }[] =
      [];
    for (const [k, v] of counts) entries.push({ key: k, item: v });
    entries.sort((a, b) => b.item.count - a.item.count);
    const limit = Math.min(entries.length, maxCachedGlobalsPerLoop);
    const chosen = new Map<string, CachedGlobal>();
    for (let i = 0; i < limit; i++) {
      const pair = entries[i];
      if (pair === undefined) continue;
      const key = pair.key;
      const item = pair.item;
      const cellSlot = slots.length;
      slots.push("optional-reference");
      chosen.set(key, {
        key,
        template: item.template,
        scope: item.scope,
        cache: item.cache,
        cellSlot,
      });
    }
    if (chosen.size > 0) selectedGlobals.set(loop, chosen);
  }

  // Detect GlobalCell.value reads and general slots fed solely by a cached
  // global-cell's value (+ cold invalidating fallbacks), so chained
  // property-loads (e.g. `Math.floor`) can hoist too!
  const loopGlobalValSlots = new Map<NaturalLoop, Map<number, CachedGlobal>>();
  // Also track GlobalCell `record` read terminators we can bypass inside loops.
  const bypassedGlobalReadTerms = new Map<number, CachedGlobal>();
  // Track `record-read` instructions reading GlobalCell.value we can bypass.
  const bypassedGlobalReadOps = new Map<Instruction, CachedGlobal>();

  for (const [loop, globals] of selectedGlobals) {
    const info = loopInfo.get(loop);
    if (info === undefined) continue;
    // Map each SSA value / slot inside the loop to the CachedGlobal it holds
    // (only when every write to that slot in the loop comes from that global).
    const idToGlobal = new Map<number, CachedGlobal>();
    const slotGlobalWriters = new Map<number, CachedGlobal>();
    const slotGlobalMixed = new Set<number>();
    for (const id of loop.body) {
      const block = fn.blocks[id];
      if (block === undefined) continue;
      for (const op of block.instructions) {
        if (op === undefined) continue;
        if (op.kind === "global-cell") {
          const target = globalOpTarget.get(op);
          if (target !== undefined && target.loop === loop) {
            const cg = globals.get(target.key);
            if (cg !== undefined) idToGlobal.set(op.id, cg);
          }
        }
      }
    }
    // Propagate through stores to temp slots (single-global-cell slots).
    for (const id of loop.body) {
      const block = fn.blocks[id];
      if (block === undefined) continue;
      for (const op of block.instructions) {
        if (op !== undefined && op.kind === "store") {
          if (slotGlobalMixed.has(op.slot)) continue;
          const cg = idToGlobal.get(op.value);
          const prev = slotGlobalWriters.get(op.slot);
          if (cg === undefined || (prev !== undefined && prev !== cg)) {
            slotGlobalMixed.add(op.slot);
            slotGlobalWriters.delete(op.slot);
          } else if (prev === undefined) {
            slotGlobalWriters.set(op.slot, cg);
          }
        }
      }
      const term = block.terminator;
      if (
        (term.kind === "record" ||
          term.kind === "record-cell" ||
          term.kind === "cell") &&
        term.operation === "read"
      ) {
        slotGlobalMixed.add(term.slot);
        slotGlobalWriters.delete(term.slot);
      }
    }
    function globalOfCellValue(valueId: number): CachedGlobal | undefined {
      let cur = valueId;
      for (let depth = 0; depth < 6; depth++) {
        const direct = idToGlobal.get(cur);
        if (direct !== undefined) return direct;
        const def = definitions.get(cur);
        if (def === undefined) return undefined;
        if (def.kind === "reference-value") cur = def.value;
        else if (def.kind === "load") {
          return slotGlobalMixed.has(def.slot)
            ? undefined
            : slotGlobalWriters.get(def.slot);
        } else return undefined;
      }
      return undefined;
    }

    // Find reads of `GlobalCell.value` (general field) from cached global cells,
    // and track which general slots receive that value.
    const valSlotCandidates = new Map<number, CachedGlobal>();
    const valSlotMixed = new Set<number>();
    function recordValWrite(slot: number, cg: CachedGlobal | undefined): void {
      if (valSlotMixed.has(slot)) return;
      const prev = valSlotCandidates.get(slot);
      if (cg === undefined || (prev !== undefined && prev !== cg)) {
        valSlotMixed.add(slot);
        valSlotCandidates.delete(slot);
      } else if (prev === undefined) {
        valSlotCandidates.set(slot, cg);
      }
    }
    const readValIds = new Map<number, CachedGlobal>();
    const candidateReadTerms: { blockId: number; cg: CachedGlobal }[] = [];
    const candidateReadOps: { op: Instruction; cg: CachedGlobal }[] = [];

    for (const id of loop.body) {
      const block = fn.blocks[id];
      if (block === undefined) continue;
      const isColdBlock = info.invalidatingBlocks.has(id);
      for (const op of block.instructions) {
        if (op === undefined) continue;
        if (op.kind === "record-read") {
          const cg = globalOfCellValue(op.object);
          const field = module.records?.[op.record]?.fields[op.field];
          if (
            cg !== undefined &&
            field !== undefined &&
            field.type === "general" &&
            (cg.cellRecord === undefined ||
              (cg.cellRecord === op.record && cg.valueField === op.field))
          ) {
            cg.cellRecord = op.record;
            cg.valueField = op.field;
            readValIds.set(op.id, cg);
            candidateReadOps.push({ op, cg });
          }
        } else if (op.kind === "store") {
          if (fn.slots[op.slot] === "general") {
            const fromRead = readValIds.get(op.value);
            if (fromRead !== undefined) {
              recordValWrite(op.slot, fromRead);
            } else {
              // Also allow a copy from another general slot that came from the
              // same global read (e.g. temp slot -> result slot).
              const srcDef = definitions.get(op.value);
              const fromCopy =
                srcDef !== undefined &&
                srcDef.kind === "load" &&
                !valSlotMixed.has(srcDef.slot)
                  ? valSlotCandidates.get(srcDef.slot)
                  : undefined;
              if (fromCopy !== undefined) {
                recordValWrite(op.slot, fromCopy);
              } else if (!isColdBlock) {
                recordValWrite(op.slot, undefined);
              }
            }
          }
        }
      }
      const term = block.terminator;
      if (term.kind === "record" && term.operation === "read") {
        const cg = globalOfCellValue(term.object);
        const field = module.records?.[term.record]?.fields[term.field];
        if (
          cg !== undefined &&
          field !== undefined &&
          field.type === "general" &&
          fn.slots[term.slot] === "general" &&
          (cg.cellRecord === undefined ||
            (cg.cellRecord === term.record && cg.valueField === term.field))
        ) {
          cg.cellRecord = term.record;
          cg.valueField = term.field;
          recordValWrite(term.slot, cg);
          candidateReadTerms.push({ blockId: id, cg });
        } else if (!isColdBlock && fn.slots[term.slot] === "general") {
          recordValWrite(term.slot, undefined);
        }
      } else if (
        (term.kind === "record-cell" || term.kind === "cell") &&
        term.operation === "read" &&
        !isColdBlock &&
        fn.slots[term.slot] === "general"
      ) {
        recordValWrite(term.slot, undefined);
      }
    }

    // Second pass to pick up one-hop slot copies (`tempSlot -> exprSlot`) in
    // blocks that may have appeared earlier in block-ID order.
    for (let pass = 0; pass < 2; pass++) {
      for (const id of loop.body) {
        const block = fn.blocks[id];
        if (block === undefined || info.invalidatingBlocks.has(id)) continue;
        for (const op of block.instructions) {
          if (op === undefined || op.kind !== "store") continue;
          if (fn.slots[op.slot] !== "general") continue;
          if (readValIds.has(op.value)) continue;
          const srcDef = definitions.get(op.value);
          if (
            srcDef !== undefined &&
            srcDef.kind === "load" &&
            !valSlotMixed.has(srcDef.slot)
          ) {
            const srcCg = valSlotCandidates.get(srcDef.slot);
            if (srcCg !== undefined && !valSlotMixed.has(op.slot)) {
              // Only upgrade if not written by anything else in non-cold blocks.
              const cur = valSlotCandidates.get(op.slot);
              if (cur === undefined) valSlotCandidates.set(op.slot, srcCg);
            }
          }
        }
      }
    }

    // Re-verify: any general slot written in a non-cold block by something
    // OTHER than a GlobalCell.value read (or copy of one) must be marked mixed!
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of loop.body) {
        const block = fn.blocks[id];
        if (block === undefined || info.invalidatingBlocks.has(id)) continue;
        for (const op of block.instructions) {
          if (op === undefined || op.kind !== "store") continue;
          if (valSlotMixed.has(op.slot)) continue;
          const cur = valSlotCandidates.get(op.slot);
          if (cur === undefined) continue;
          const direct = readValIds.get(op.value);
          if (direct === cur) continue;
          const srcDef = definitions.get(op.value);
          if (
            srcDef !== undefined &&
            srcDef.kind === "load" &&
            !valSlotMixed.has(srcDef.slot) &&
            valSlotCandidates.get(srcDef.slot) === cur
          )
            continue;
          valSlotMixed.add(op.slot);
          valSlotCandidates.delete(op.slot);
          changed = true;
        }
        const term = block.terminator;
        if (
          (term.kind === "record" ||
            term.kind === "record-cell" ||
            term.kind === "cell") &&
          term.operation === "read"
        ) {
          if (valSlotMixed.has(term.slot)) continue;
          const cur = valSlotCandidates.get(term.slot);
          if (cur === undefined) continue;
          const isMatchedRead =
            term.kind === "record" &&
            candidateReadTerms.some(
              (entry) => entry.blockId === id && entry.cg === cur,
            );
          if (!isMatchedRead) {
            valSlotMixed.add(term.slot);
            valSlotCandidates.delete(term.slot);
            changed = true;
          }
        }
      }
    }

    const validMap = new Map<number, CachedGlobal>();
    for (const [slot, cg] of valSlotCandidates) {
      if (!valSlotMixed.has(slot) && cg.cellRecord !== undefined) {
        if (cg.valSlot === undefined) {
          cg.valSlot = slots.length;
          slots.push("general");
        }
        validMap.set(slot, cg);
      }
    }
    // Also allocate valSlot for any CachedGlobal whose GlobalCell.value read
    // was found even if compact-slots reused the destination slot later in the
    // loop, so local reaching-diamond matching can still chain property-loads!
    for (const item of candidateReadTerms) {
      if (item.cg.cellRecord !== undefined && item.cg.valSlot === undefined) {
        item.cg.valSlot = slots.length;
        slots.push("general");
      }
      if (item.cg.valSlot !== undefined)
        bypassedGlobalReadTerms.set(item.blockId, item.cg);
    }
    for (const item of candidateReadOps) {
      if (item.cg.cellRecord !== undefined && item.cg.valSlot === undefined) {
        item.cg.valSlot = slots.length;
        slots.push("general");
      }
      if (item.cg.valSlot !== undefined)
        bypassedGlobalReadOps.set(item.op, item.cg);
    }
    if (validMap.size > 0) loopGlobalValSlots.set(loop, validMap);
  }

  /** Local backward reaching-definition check for `slot` at `op` inside
   * `block`: resolves `compact-slots` reuse by tracing through local slot
   * copies and a `if (cell) GlobalCell.value else coldFallback` join diamond! */
  function reachingCachedGlobal(
    block: Block,
    op: Instruction,
    slot: number,
    loop: NaturalLoop,
    info: LoopInfo,
  ): CachedGlobal | undefined {
    const loopWide = loopGlobalValSlots.get(loop)?.get(slot);
    if (loopWide !== undefined) return loopWide;
    const globals = selectedGlobals.get(loop);
    if (globals === undefined || globals.size === 0) return undefined;

    let curSlot = slot;
    let curBlock = block;
    let startIdx = -1;
    for (let i = 0; i < curBlock.instructions.length; i++) {
      if (curBlock.instructions[i] === op) {
        startIdx = i - 1;
        break;
      }
    }
    for (let step = 0; step < 6; step++) {
      // Scan backwards in curBlock for writes to curSlot.
      let foundInBlock = false;
      for (let i = startIdx; i >= 0; i--) {
        const prev = curBlock.instructions[i];
        if (
          prev === undefined ||
          prev.kind !== "store" ||
          prev.slot !== curSlot
        )
          continue;
        const valDef = definitions.get(prev.value);
        if (valDef === undefined) return undefined;
        const readCg = bypassedGlobalReadOps.get(valDef);
        if (readCg !== undefined) return readCg;
        if (valDef.kind === "load") {
          curSlot = valDef.slot;
          startIdx = i - 1;
          foundInBlock = true;
          break;
        }
        return undefined;
      }
      if (foundInBlock) continue;
      // Not written earlier in curBlock: inspect predecessors.
      const preds = predecessors.get(curBlock.id);
      if (preds === undefined || preds.length === 0) return undefined;
      if (preds.length === 1) {
        const predId = preds[0];
        if (predId === undefined || !loop.body.has(predId)) return undefined;
        const pred = fn.blocks[predId];
        if (pred === undefined) return undefined;
        const pTerm = pred.terminator;
        if (
          pTerm.kind === "record" &&
          pTerm.operation === "read" &&
          pTerm.consequent === curBlock.id
        ) {
          if (pTerm.slot === curSlot)
            return bypassedGlobalReadTerms.get(predId);
          curBlock = pred;
          startIdx = curBlock.instructions.length - 1;
          continue;
        }
        if (pTerm.kind !== "jump" && pTerm.kind !== "branch") return undefined;
        curBlock = pred;
        startIdx = curBlock.instructions.length - 1;
        continue;
      }
      // Join block (e.g. `if (cell !== undefined) GlobalCell.value else getIdentifierValue`):
      // Every predecessor must be either a cold invalidating branch OR a
      // GlobalCell.value read of the SAME CachedGlobal into curSlot.
      function isColdBranch(blockId: number, depth: number = 0): boolean {
        if (info.invalidatingBlocks.has(blockId)) return true;
        if (depth >= 3) return false;
        const p = predecessors.get(blockId);
        if (p === undefined || p.length !== 1) return false;
        const only = p[0];
        return (
          only !== undefined &&
          loop.body.has(only) &&
          isColdBranch(only, depth + 1)
        );
      }
      let matchedCg: CachedGlobal | undefined = undefined;
      for (const predId of preds) {
        if (predId === undefined || !loop.body.has(predId)) return undefined;
        if (isColdBranch(predId)) continue;
        const pred = fn.blocks[predId];
        if (pred === undefined) return undefined;
        const predCg = predWritesSlotFromGlobal(
          pred,
          curBlock.id,
          curSlot,
          loop,
          info,
        );
        if (predCg === undefined) return undefined;
        if (matchedCg === undefined) matchedCg = predCg;
        else if (matchedCg !== predCg) return undefined;
      }
      return matchedCg;
    }
    return undefined;
  }

  /** Whether `pred` (ending into `targetId`) writes `slot` solely from a
   * cached GlobalCell.value read (directly or via 1-hop jump/store copy). */
  function predWritesSlotFromGlobal(
    pred: Block,
    targetId: number,
    slot: number,
    loop: NaturalLoop,
    info: LoopInfo,
    depth: number = 0,
  ): CachedGlobal | undefined {
    if (depth > 3) return undefined;
    if (info.invalidatingBlocks.has(pred.id)) return undefined;
    const pTerm = pred.terminator;
    if (
      pTerm.kind === "record" &&
      pTerm.operation === "read" &&
      pTerm.slot === slot &&
      pTerm.consequent === targetId
    ) {
      return bypassedGlobalReadTerms.get(pred.id);
    }
    if (
      pTerm.kind !== "jump" &&
      pTerm.kind !== "branch" &&
      !(
        pTerm.kind === "record" &&
        pTerm.operation === "read" &&
        pTerm.consequent === targetId
      )
    )
      return undefined;
    let curSlot = slot;
    for (let i = pred.instructions.length - 1; i >= 0; i--) {
      const prev = pred.instructions[i];
      if (prev === undefined || prev.kind !== "store" || prev.slot !== curSlot)
        continue;
      const valDef = definitions.get(prev.value);
      if (valDef === undefined) return undefined;
      const readCg = bypassedGlobalReadOps.get(valDef);
      if (readCg !== undefined) return readCg;
      if (valDef.kind === "load") {
        curSlot = valDef.slot;
        continue;
      }
      return undefined;
    }
    const preds = predecessors.get(pred.id);
    if (preds !== undefined && preds.length === 1) {
      const prevId = preds[0];
      if (prevId !== undefined && loop.body.has(prevId)) {
        const prevBlock = fn.blocks[prevId];
        if (prevBlock !== undefined)
          return predWritesSlotFromGlobal(
            prevBlock,
            pred.id,
            curSlot,
            loop,
            info,
            depth + 1,
          );
      }
    }
    return undefined;
  }

  // Phase 2: Select loop-invariant property-load candidates per loop.
  const propCounts = new Map<NaturalLoop, Map<string, PropCountEntry>>();
  const propOpTarget = new Map<
    PropertyLoadOp,
    { readonly loop: NaturalLoop; readonly key: string }
  >();

  for (const block of fn.blocks) {
    if (block === undefined) continue;
    const loops = enclosing.get(block.id);
    if (loops === undefined) continue;
    const weight = loops.length <= 1 ? 1 : loops.length === 2 ? 4 : 16;
    for (const op of block.instructions) {
      if (op === undefined || op.kind !== "property-load") continue;
      const objDef = definitions.get(op.object);
      if (
        objDef === undefined ||
        objDef.kind !== "load" ||
        fn.slots[objDef.slot] !== "general"
      ) {
        remarks?.({
          pass: "cache-loop-properties",
          outcome: "missed",
          function: fn.name,
          start: op.start,
          end: op.end,
          message:
            "property-load object not general load: " +
            (objDef === undefined ? "undef" : objDef.kind),
        });
        continue;
      }
      for (const loop of loops) {
        if (loop === undefined) continue;
        const info = inspectLoop(loop);
        if (info === undefined) {
          remarks?.({
            pass: "cache-loop-properties",
            outcome: "missed",
            function: fn.name,
            start: op.start,
            end: op.end,
            message:
              "property-load loop rejected: " +
              (loopRejectReason.get(loop) ?? "?"),
          });
          continue;
        }
        const site = traceInvariant(op.site, info, true);
        if (site === undefined || !exprInitAtExit(info.preheader.id, site)) {
          remarks?.({
            pass: "cache-loop-properties",
            outcome: "missed",
            function: fn.name,
            start: op.start,
            end: op.end,
            message:
              "property-load site not invariant: " +
              (definitions.get(op.site)?.kind ?? "?"),
          });
          continue;
        }
        let fromGlobal: CachedGlobal | undefined = undefined;
        let objectWriteOps: readonly Instruction[] | undefined = undefined;
        let objSlot = objDef.slot;
        const loadKey = siteExprPropName(site);
        const combinedBlockers = new Set<number>();
        for (const b of info.invalidatingBlocks) combinedBlockers.add(b);
        const storeRefreshOps: Instruction[] = [];
        for (const s of info.storeOps) {
          if (storeConflictsWithLoad(s.key, loadKey)) {
            combinedBlockers.add(s.blockId);
            storeRefreshOps.push(s.op);
          }
        }
        if (info.writtenSlots.has(objDef.slot)) {
          const cg = reachingCachedGlobal(block, op, objDef.slot, loop, info);
          const cgValSlot = cg !== undefined ? cg.valSlot : undefined;
          if (cg !== undefined && cgValSlot !== undefined) {
            fromGlobal = cg;
            objSlot = cgValSlot;
          } else {
            // If `objDef.slot` is only reassigned on cold branches inside the
            // loop (e.g. `if (values.length === 64) values = []`), cache the
            // property and refresh immediately after each store to `objDef.slot`.
            const writeOps: Instruction[] = [];
            let termWritesSlot = false;
            for (const bId of loop.body) {
              const b = fn.blocks[bId];
              if (b === undefined) continue;
              const bTerm = b.terminator;
              if (
                (bTerm.kind === "record" ||
                  bTerm.kind === "record-cell" ||
                  bTerm.kind === "cell") &&
                bTerm.operation === "read" &&
                bTerm.slot === objDef.slot
              ) {
                termWritesSlot = true;
                break;
              }
              for (const bOp of b.instructions) {
                if (
                  bOp !== undefined &&
                  bOp.kind === "store" &&
                  bOp.slot === objDef.slot
                ) {
                  writeOps.push(bOp);
                  combinedBlockers.add(bId);
                }
              }
            }
            if (termWritesSlot || writeOps.length === 0) {
              remarks?.({
                pass: "cache-loop-properties",
                outcome: "missed",
                function: fn.name,
                start: op.start,
                end: op.end,
                message:
                  "property-load object slot written in loop (slot " +
                  String(objDef.slot) +
                  ")",
              });
              continue;
            }
            objectWriteOps = writeOps;
          }
        }
        if (!hasCleanIteration(loop, combinedBlockers)) {
          remarks?.({
            pass: "cache-loop-properties",
            outcome: "missed",
            function: fn.name,
            start: op.start,
            end: op.end,
            message:
              "property-load blocked by conflicting store or object write",
          });
          continue;
        }
        if (
          fromGlobal === undefined &&
          !isSlotInitAtExit(info.preheader.id, objSlot)
        )
          continue;
        const key =
          String(objSlot) +
          "|" +
          exprKey(site) +
          "|" +
          String(op.record) +
          "|" +
          String(op.siteRecord) +
          "|" +
          String(op.inherited ? 1 : 0);
        let map = propCounts.get(loop);
        if (map === undefined) {
          map = new Map<string, PropCountEntry>();
          propCounts.set(loop, map);
        }
        const entry = map.get(key);
        if (entry === undefined)
          map.set(key, {
            count: weight,
            template: op,
            objectSlot: objSlot,
            fromGlobal,
            fromProp: undefined,
            objectWriteOps,
            storeRefreshOps,
            propKey: loadKey,
            site,
          });
        else entry.count += weight;
        propOpTarget.set(op, { loop, key });
        break;
      }
    }
  }
  if (effectBudgetExhausted) return undefined;

  const selectedProps = new Map<NaturalLoop, Map<string, CachedProperty>>();
  for (const [loop, counts] of propCounts) {
    const entries: { readonly key: string; readonly item: PropCountEntry }[] =
      [];
    for (const [k, v] of counts) entries.push({ key: k, item: v });
    entries.sort((a, b) => b.item.count - a.item.count);
    const limit = Math.min(entries.length, maxCachedPropertiesPerLoop);
    const chosen = new Map<string, CachedProperty>();
    for (let i = 0; i < limit; i++) {
      const pair = entries[i];
      if (pair === undefined) continue;
      const key = pair.key;
      const item = pair.item;
      const propSlot = slots.length;
      slots.push("general");
      chosen.set(key, {
        key,
        template: item.template,
        objectSlot: item.objectSlot,
        fromGlobal: item.fromGlobal,
        fromProp: item.fromProp,
        objectWriteOps: item.objectWriteOps,
        storeRefreshOps: item.storeRefreshOps,
        propKey: item.propKey,
        site: item.site,
        propSlot,
      });
    }
    if (chosen.size > 0) selectedProps.set(loop, chosen);
  }

  // Phase 2b: 1-hop chained property-loads whose object comes from an already
  // selected CachedProperty (e.g. `this.v.elms`, `this.v.size`, `this.options.x`).
  // On miss of the outer CachedProperty, `outer.propSlot` holds `absent` whose
  // tag fails the inner `property-load` guard cleanly without dereferencing.
  for (const [loop, chosen] of selectedProps) {
    if (chosen.size >= maxCachedPropertiesPerLoop) continue;
    const info = loopInfo.get(loop);
    if (info === undefined) continue;
    const propIdToCp = new Map<number, CachedProperty>();
    for (const id of loop.body) {
      const b = fn.blocks[id];
      if (b === undefined) continue;
      for (const op of b.instructions) {
        if (op === undefined || op.kind !== "property-load") continue;
        const target = propOpTarget.get(op);
        if (target !== undefined && target.loop === loop) {
          const cp = chosen.get(target.key);
          if (cp !== undefined && cp.fromProp === undefined)
            propIdToCp.set(op.id, cp);
        }
      }
    }
    if (propIdToCp.size === 0) continue;

    function predWritesSlotFromProp(
      pred: Block,
      slot: number,
      depth: number = 0,
    ): CachedProperty | undefined {
      if (depth > 3) return undefined;
      if (info === undefined || info.invalidatingBlocks.has(pred.id))
        return undefined;
      const pTerm = pred.terminator;
      if (
        pTerm.kind !== "jump" &&
        pTerm.kind !== "branch" &&
        pTerm.kind !== "record"
      )
        return undefined;
      let curSlot = slot;
      for (let i = pred.instructions.length - 1; i >= 0; i--) {
        const prev = pred.instructions[i];
        if (
          prev === undefined ||
          prev.kind !== "store" ||
          prev.slot !== curSlot
        )
          continue;
        const direct = propIdToCp.get(prev.value);
        if (direct !== undefined) return direct;
        const valDef = definitions.get(prev.value);
        if (valDef !== undefined && valDef.kind === "load") {
          curSlot = valDef.slot;
          continue;
        }
        return undefined;
      }
      const preds = predecessors.get(pred.id);
      if (preds !== undefined && preds.length === 1) {
        const prevId = preds[0];
        if (prevId !== undefined && loop.body.has(prevId)) {
          const prevBlock = fn.blocks[prevId];
          if (prevBlock !== undefined)
            return predWritesSlotFromProp(prevBlock, curSlot, depth + 1);
        }
      }
      return undefined;
    }

    function reachingCachedProp(
      block: Block,
      op: Instruction,
      slot: number,
    ): CachedProperty | undefined {
      if (info === undefined) return undefined;
      let curSlot = slot;
      let curBlock = block;
      let startIdx = -1;
      for (let i = 0; i < curBlock.instructions.length; i++) {
        if (curBlock.instructions[i] === op) {
          startIdx = i - 1;
          break;
        }
      }
      for (let step = 0; step < 6; step++) {
        let foundInBlock = false;
        for (let i = startIdx; i >= 0; i--) {
          const prev = curBlock.instructions[i];
          if (
            prev === undefined ||
            prev.kind !== "store" ||
            prev.slot !== curSlot
          )
            continue;
          const direct = propIdToCp.get(prev.value);
          if (direct !== undefined) return direct;
          const valDef = definitions.get(prev.value);
          if (valDef !== undefined && valDef.kind === "load") {
            curSlot = valDef.slot;
            startIdx = i - 1;
            foundInBlock = true;
            break;
          }
          return undefined;
        }
        if (foundInBlock) continue;
        const preds = predecessors.get(curBlock.id);
        if (preds === undefined || preds.length === 0) return undefined;
        if (preds.length === 1) {
          const predId = preds[0];
          if (predId === undefined || !loop.body.has(predId)) return undefined;
          const pred = fn.blocks[predId];
          if (pred === undefined) return undefined;
          const pTerm = pred.terminator;
          if (
            pTerm.kind === "record" &&
            pTerm.operation === "read" &&
            pTerm.slot === curSlot
          )
            return undefined;
          if (
            pTerm.kind !== "jump" &&
            pTerm.kind !== "branch" &&
            pTerm.kind !== "record"
          )
            return undefined;
          curBlock = pred;
          startIdx = curBlock.instructions.length - 1;
          continue;
        }
        function isColdPropBranch(blockId: number, depth: number = 0): boolean {
          if (info !== undefined && info.invalidatingBlocks.has(blockId))
            return true;
          if (depth >= 3) return false;
          const p = predecessors.get(blockId);
          if (p === undefined || p.length !== 1) return false;
          const only = p[0];
          return (
            only !== undefined &&
            loop.body.has(only) &&
            isColdPropBranch(only, depth + 1)
          );
        }
        let matchedCp: CachedProperty | undefined = undefined;
        for (const predId of preds) {
          if (predId === undefined || !loop.body.has(predId)) return undefined;
          if (isColdPropBranch(predId)) continue;
          const pred = fn.blocks[predId];
          if (pred === undefined) return undefined;
          const predCp = predWritesSlotFromProp(pred, curSlot);
          if (predCp === undefined) return undefined;
          if (matchedCp === undefined) matchedCp = predCp;
          else if (matchedCp !== predCp) return undefined;
        }
        return matchedCp;
      }
      return undefined;
    }

    const chainedCounts = new Map<string, PropCountEntry>();
    const chainedTargets: {
      readonly op: PropertyLoadOp;
      readonly key: string;
    }[] = [];
    for (const id of loop.body) {
      const b = fn.blocks[id];
      if (b === undefined) continue;
      for (const op of b.instructions) {
        if (op === undefined || op.kind !== "property-load") continue;
        if (propOpTarget.has(op)) continue;
        const objDef = definitions.get(op.object);
        if (
          objDef === undefined ||
          objDef.kind !== "load" ||
          fn.slots[objDef.slot] !== "general"
        )
          continue;
        const outerCp = reachingCachedProp(b, op, objDef.slot);
        if (outerCp === undefined) continue;
        const site = traceInvariant(op.site, info, true);
        if (site === undefined || !exprInitAtExit(info.preheader.id, site))
          continue;
        const innerKey = siteExprPropName(site);
        const cpBlockers = new Set<number>();
        for (const blk of info.invalidatingBlocks) cpBlockers.add(blk);
        const storeRefreshSet = new Set<Instruction>();
        const storeRefreshOps: Instruction[] = [];
        for (const s of info.storeOps) {
          if (
            storeConflictsWithLoad(s.key, outerCp.propKey) ||
            storeConflictsWithLoad(s.key, innerKey)
          ) {
            cpBlockers.add(s.blockId);
            if (!storeRefreshSet.has(s.op)) {
              storeRefreshSet.add(s.op);
              storeRefreshOps.push(s.op);
            }
          }
        }
        if (outerCp.objectWriteOps !== undefined) {
          for (const wOp of outerCp.objectWriteOps) {
            const wId = instructionResult(wOp);
            const wBlk = wId !== undefined ? blockOfDef.get(wId) : undefined;
            if (wBlk !== undefined) cpBlockers.add(wBlk);
            else {
              for (const bId of loop.body) {
                const blk = fn.blocks[bId];
                if (blk !== undefined && blk.instructions.includes(wOp)) {
                  cpBlockers.add(bId);
                  break;
                }
              }
            }
          }
        }
        if (!hasCleanIteration(loop, cpBlockers)) continue;
        const key =
          "p" +
          String(outerCp.propSlot) +
          "|" +
          exprKey(site) +
          "|" +
          String(op.record) +
          "|" +
          String(op.siteRecord) +
          "|" +
          String(op.inherited ? 1 : 0);
        const existing = chainedCounts.get(key);
        if (existing === undefined)
          chainedCounts.set(key, {
            count: 1,
            template: op,
            objectSlot: outerCp.propSlot,
            fromGlobal: undefined,
            fromProp: outerCp,
            objectWriteOps: outerCp.objectWriteOps,
            storeRefreshOps,
            propKey: innerKey,
            site,
          });
        else existing.count++;
        chainedTargets.push({ op, key });
      }
    }
    if (chainedCounts.size > 0) {
      const entries: { readonly key: string; readonly item: PropCountEntry }[] =
        [];
      for (const [k, v] of chainedCounts) entries.push({ key: k, item: v });
      entries.sort((a, b) => b.item.count - a.item.count);
      const remaining = maxCachedPropertiesPerLoop - chosen.size;
      const limit = Math.min(entries.length, remaining);
      for (let i = 0; i < limit; i++) {
        const pair = entries[i];
        if (pair === undefined) continue;
        const propSlot = slots.length;
        slots.push("general");
        chosen.set(pair.key, {
          key: pair.key,
          template: pair.item.template,
          objectSlot: pair.item.objectSlot,
          fromGlobal: undefined,
          fromProp: pair.item.fromProp,
          objectWriteOps: pair.item.objectWriteOps,
          storeRefreshOps: pair.item.storeRefreshOps,
          propKey: pair.item.propKey,
          site: pair.item.site,
          propSlot,
        });
      }
      for (const t of chainedTargets) {
        if (chosen.has(t.key)) propOpTarget.set(t.op, { loop, key: t.key });
      }
    }
  }

  if (selectedGlobals.size === 0 && selectedProps.size === 0)
    return { fn, visited, rewritten: 0 };

  // Collect all loops that have at least one selected cache.
  const activeLoops = new Set<NaturalLoop>();
  for (const [loop, _v] of selectedGlobals) activeLoops.add(loop);
  for (const [loop, _v] of selectedProps) activeLoops.add(loop);

  // Phase 3: Rewrite in-loop global-cell, GlobalCell.value reads, and
  // property-load instructions to loads of their cached slots.
  const replaced = new Map<number, Block>();
  let rewritten = 0;
  for (const block of fn.blocks) {
    if (block === undefined) throw "property cache block invariant";
    if (!enclosing.has(block.id)) continue;
    let instructions: Instruction[] | undefined;
    for (let at = 0; at < block.instructions.length; at++) {
      const op = block.instructions[at];
      if (op === undefined) throw "property cache instruction invariant";
      if (op.kind === "global-cell") {
        const target = globalOpTarget.get(op);
        const cg =
          target === undefined
            ? undefined
            : selectedGlobals.get(target.loop)?.get(target.key);
        if (cg !== undefined) {
          if (instructions === undefined)
            instructions = block.instructions.slice(0, at);
          instructions.push({
            kind: "load",
            id: op.id,
            slot: cg.cellSlot,
            start: op.start,
            end: op.end,
          });
          rewritten++;
          continue;
        }
      } else if (op.kind === "property-load") {
        const target = propOpTarget.get(op);
        const cp =
          target === undefined
            ? undefined
            : selectedProps.get(target.loop)?.get(target.key);
        if (cp !== undefined) {
          if (instructions === undefined)
            instructions = block.instructions.slice(0, at);
          instructions.push({
            kind: "load",
            id: op.id,
            slot: cp.propSlot,
            start: op.start,
            end: op.end,
          });
          rewritten++;
          continue;
        }
      } else if (op.kind === "record-read") {
        const cg = bypassedGlobalReadOps.get(op);
        const cgValSlot = cg !== undefined ? cg.valSlot : undefined;
        if (cg !== undefined && cgValSlot !== undefined) {
          if (instructions === undefined)
            instructions = block.instructions.slice(0, at);
          instructions.push({
            kind: "load",
            id: op.id,
            slot: cgValSlot,
            start: op.start,
            end: op.end,
          });
          rewritten++;
          continue;
        }
      }
      if (instructions !== undefined) instructions.push(op);
    }
    const bypassedTerm = bypassedGlobalReadTerms.get(block.id);
    const bypassedValSlot =
      bypassedTerm !== undefined ? bypassedTerm.valSlot : undefined;
    const blockTerm = block.terminator;
    if (
      bypassedTerm !== undefined &&
      bypassedValSlot !== undefined &&
      blockTerm.kind === "record" &&
      blockTerm.operation === "read"
    ) {
      if (instructions === undefined) instructions = block.instructions.slice();
      const loaded = nextValue++;
      instructions.push(
        {
          kind: "load",
          id: loaded,
          slot: bypassedValSlot,
          start: blockTerm.start,
          end: blockTerm.end,
        },
        {
          kind: "store",
          slot: blockTerm.slot,
          value: loaded,
          start: blockTerm.start,
          end: blockTerm.end,
        },
      );
      replaced.set(block.id, {
        ...block,
        instructions,
        terminator: {
          kind: "jump",
          target: blockTerm.consequent,
          start: blockTerm.start,
          end: blockTerm.end,
        },
      });
      rewritten++;
    } else if (instructions !== undefined) {
      replaced.set(block.id, { ...block, instructions });
    }
  }
  if (rewritten === 0) return { fn, visited, rewritten: 0 };

  // Phase 4: Build refresh helper that emits fresh global-cell, optional
  // GlobalCell.value diamond, and property-load instructions into a sequence
  // of blocks jumping to `continuation`.
  const added: Block[] = [];

  function recordReadDirectlyProven(
    expr: InvariantExpr & { readonly kind: "record-read" },
  ): boolean {
    return (
      expr.proven &&
      expr.object.kind === "closure-env" &&
      !fn.exported &&
      fn.closureEnvironment === expr.record
    );
  }

  function exprNeedsBranch(expr: InvariantExpr): boolean {
    switch (expr.kind) {
      case "slot":
      case "constant":
      case "closure-env":
        return false;
      case "function-env":
        return exprNeedsBranch(expr.callee);
      case "record-read":
        return !recordReadDirectlyProven(expr) || exprNeedsBranch(expr.object);
    }
  }

  function emitExprStraight(expr: InvariantExpr, into: Instruction[]): number {
    switch (expr.kind) {
      case "slot": {
        const id = nextValue++;
        into.push({ kind: "load", id, slot: expr.slot, start: 0, end: 0 });
        return id;
      }
      case "constant": {
        const id = nextValue++;
        into.push({
          kind: "constant",
          id,
          value: expr.value,
          start: 0,
          end: 0,
        });
        return id;
      }
      case "closure-env": {
        const id = nextValue++;
        into.push({ kind: "closure-environment", id, start: 0, end: 0 });
        return id;
      }
      case "function-env": {
        const callee = emitExprStraight(expr.callee, into);
        const id = nextValue++;
        into.push({
          kind: "function-environment",
          id,
          callee,
          start: 0,
          end: 0,
        });
        return id;
      }
      case "record-read": {
        const object = emitExprStraight(expr.object, into);
        const id = nextValue++;
        into.push({
          kind: "record-read",
          id,
          object,
          record: expr.record,
          field: expr.field,
          start: 0,
          end: 0,
        });
        return id;
      }
    }
  }

  /** Build a refresh chain starting at a new entry block and jumping to
   * `continuation`, refreshing `globals` (and their `valSlot`s) first, then
   * `props`. Returns the entry block ID. */
  function buildRefreshChain(
    globals: readonly CachedGlobal[],
    props: readonly CachedProperty[],
    continuation: number,
  ): number {
    const entryId = nextBlock++;
    let curId = entryId;
    let curOps: Instruction[] = [];
    function flush(terminator: Block["terminator"]): void {
      added.push({ id: curId, instructions: curOps, terminator });
    }
    function emitChainExpr(expr: InvariantExpr): number {
      switch (expr.kind) {
        case "slot": {
          const id = nextValue++;
          curOps.push({ kind: "load", id, slot: expr.slot, start: 0, end: 0 });
          return id;
        }
        case "constant": {
          const id = nextValue++;
          curOps.push({
            kind: "constant",
            id,
            value: expr.value,
            start: 0,
            end: 0,
          });
          return id;
        }
        case "closure-env": {
          const id = nextValue++;
          curOps.push({ kind: "closure-environment", id, start: 0, end: 0 });
          return id;
        }
        case "function-env": {
          const callee = emitChainExpr(expr.callee);
          const id = nextValue++;
          curOps.push({
            kind: "function-environment",
            id,
            callee,
            start: 0,
            end: 0,
          });
          return id;
        }
        case "record-read": {
          const object = emitChainExpr(expr.object);
          if (recordReadDirectlyProven(expr)) {
            const id = nextValue++;
            curOps.push({
              kind: "record-read",
              id,
              object,
              record: expr.record,
              field: expr.field,
              start: 0,
              end: 0,
            });
            return id;
          }
          const tmpSlot = slots.length;
          slots.push(expr.fieldType);
          const nextId = nextBlock++;
          const trapId = nextBlock++;
          flush({
            kind: "record",
            operation: "read",
            object,
            record: expr.record,
            field: expr.field,
            slot: tmpSlot,
            consequent: nextId,
            alternate: trapId,
            start: 0,
            end: 0,
          });
          added.push({
            id: trapId,
            instructions: [],
            terminator: { kind: "trap", start: 0, end: 0 },
          });
          curId = nextId;
          curOps = [];
          const loaded = nextValue++;
          curOps.push({
            kind: "load",
            id: loaded,
            slot: tmpSlot,
            start: 0,
            end: 0,
          });
          return loaded;
        }
      }
    }

    for (const cg of globals) {
      if (cg === undefined) continue;
      // If cache needs a checked record terminator, spill scope across blocks.
      const scopeNeedsSpill = exprNeedsBranch(cg.cache);
      let scope = emitChainExpr(cg.scope);
      let scopeSpillSlot = -1;
      if (scopeNeedsSpill) {
        scopeSpillSlot = slots.length;
        slots.push("reference");
        curOps.push({
          kind: "store",
          slot: scopeSpillSlot,
          value: scope,
          start: 0,
          end: 0,
        });
      }
      const cache = emitChainExpr(cg.cache);
      if (scopeSpillSlot >= 0) {
        scope = nextValue++;
        curOps.push({
          kind: "load",
          id: scope,
          slot: scopeSpillSlot,
          start: 0,
          end: 0,
        });
      }
      const cell = nextValue++;
      const t = cg.template;
      curOps.push(
        {
          kind: "global-cell",
          id: cell,
          scope,
          cache,
          scopeRecord: t.scopeRecord,
          declarativeField: t.declarativeField,
          objectField: t.objectField,
          globalField: t.globalField,
          globalRecord: t.globalRecord,
          lexicalEpochField: t.lexicalEpochField,
          globalObjectField: t.globalObjectField,
          globalObjectRecord: t.globalObjectRecord,
          propertyEpochField: t.propertyEpochField,
          cacheRecord: t.cacheRecord,
          cacheGlobalField: t.cacheGlobalField,
          cacheLexicalEpochField: t.cacheLexicalEpochField,
          cacheObjectEpochField: t.cacheObjectEpochField,
          cacheCellField: t.cacheCellField,
          start: 0,
          end: 0,
        },
        { kind: "store", slot: cg.cellSlot, value: cell, start: 0, end: 0 },
      );
      const cgValSlot = cg.valSlot;
      const cgCellRecord = cg.cellRecord;
      const cgValueField = cg.valueField;
      if (
        cgValSlot !== undefined &&
        cgCellRecord !== undefined &&
        cgValueField !== undefined
      ) {
        const noneRef = nextValue++,
          present = nextValue++;
        curOps.push(
          { kind: "reference-none", id: noneRef, start: 0, end: 0 },
          {
            kind: "binary",
            id: present,
            operator: "!==",
            left: cell,
            right: noneRef,
            start: 0,
            end: 0,
          },
        );
        const hitId = nextBlock++;
        const missId = nextBlock++;
        const joinId = nextBlock++;
        flush({
          kind: "branch",
          condition: present,
          consequent: hitId,
          alternate: missId,
          start: 0,
          end: 0,
        });
        // Hit: unwrap GlobalCell and read its general value field via a checked
        // `record` read terminator (no separate layout proof required; any
        // unexpected mismatch falls cleanly to `missId` -> undefined).
        const loadedCell = nextValue++,
          refCell = nextValue++;
        added.push({
          id: hitId,
          instructions: [
            {
              kind: "load",
              id: loadedCell,
              slot: cg.cellSlot,
              start: 0,
              end: 0,
            },
            {
              kind: "reference-value",
              id: refCell,
              value: loadedCell,
              start: 0,
              end: 0,
            },
          ],
          terminator: {
            kind: "record",
            operation: "read",
            object: refCell,
            record: cgCellRecord,
            field: cgValueField,
            slot: cgValSlot,
            consequent: joinId,
            alternate: missId,
            start: 0,
            end: 0,
          },
        });
        // Miss: store undefined so chained property-loads return absent.
        const none = nextValue++;
        added.push({
          id: missId,
          instructions: [
            { kind: "general-none", id: none, start: 0, end: 0 },
            { kind: "store", slot: cgValSlot, value: none, start: 0, end: 0 },
          ],
          terminator: { kind: "jump", target: joinId, start: 0, end: 0 },
        });
        curId = joinId;
        curOps = [];
      }
    }

    // Refresh root cached properties before 1-hop chained properties so
    // `outer.propSlot` is populated before any chained `inner` probes it.
    for (let pass = 0; pass < 2; pass++) {
      for (const cp of props) {
        if (cp === undefined) continue;
        if ((cp.fromProp !== undefined) !== (pass === 1)) continue;
        const site = emitChainExpr(cp.site);
        const obj = nextValue++;
        curOps.push({
          kind: "load",
          id: obj,
          slot: cp.objectSlot,
          start: 0,
          end: 0,
        });
        const prop = nextValue++;
        const t = cp.template;
        const spillRecord = t.spillRecord;
        const spillField = t.spillField;
        const loadOp: Instruction =
          spillRecord !== undefined && spillField !== undefined
            ? {
                kind: "property-load",
                id: prop,
                object: obj,
                site,
                record: t.record,
                field: t.field,
                count: t.count,
                siteRecord: t.siteRecord,
                siteField: t.siteField,
                inherited: t.inherited,
                entries: t.entries,
                epochRecord: t.epochRecord,
                epochField: t.epochField,
                spillRecord,
                spillField,
                start: 0,
                end: 0,
              }
            : {
                kind: "property-load",
                id: prop,
                object: obj,
                site,
                record: t.record,
                field: t.field,
                count: t.count,
                siteRecord: t.siteRecord,
                siteField: t.siteField,
                inherited: t.inherited,
                entries: t.entries,
                epochRecord: t.epochRecord,
                epochField: t.epochField,
                start: 0,
                end: 0,
              };
        curOps.push(loadOp, {
          kind: "store",
          slot: cp.propSlot,
          value: prop,
          start: 0,
          end: 0,
        });
      }
    }

    flush({ kind: "jump", target: continuation, start: 0, end: 0 });
    return entryId;
  }

  // Group invalidations per op and per terminator across all active loops.
  function addRefresh(
    map: Map<Instruction, RefreshSet>,
    key: Instruction,
    globals: readonly CachedGlobal[],
    props: readonly CachedProperty[],
  ): void {
    let set = map.get(key);
    if (set === undefined) {
      set = {
        globals: [],
        props: [],
        seenGlobals: new Set<CachedGlobal>(),
        seenProps: new Set<CachedProperty>(),
      };
      map.set(key, set);
    }
    for (const g of globals)
      if (!set.seenGlobals.has(g)) {
        set.seenGlobals.add(g);
        set.globals.push(g);
      }
    for (const p of props)
      if (!set.seenProps.has(p)) {
        set.seenProps.add(p);
        set.props.push(p);
      }
  }
  function addTermRefresh(
    map: Map<number, RefreshSet>,
    key: number,
    globals: readonly CachedGlobal[],
    props: readonly CachedProperty[],
  ): void {
    let set = map.get(key);
    if (set === undefined) {
      set = {
        globals: [],
        props: [],
        seenGlobals: new Set<CachedGlobal>(),
        seenProps: new Set<CachedProperty>(),
      };
      map.set(key, set);
    }
    for (const g of globals)
      if (!set.seenGlobals.has(g)) {
        set.seenGlobals.add(g);
        set.globals.push(g);
      }
    for (const p of props)
      if (!set.seenProps.has(p)) {
        set.seenProps.add(p);
        set.props.push(p);
      }
  }

  const opRefreshes = new Map<Instruction, RefreshSet>();
  const termRefreshes = new Map<number, RefreshSet>();
  for (const loop of activeLoops) {
    const info = loopInfo.get(loop);
    if (info === undefined) continue;
    const gMap = selectedGlobals.get(loop);
    const pMap = selectedProps.get(loop);
    const gList: CachedGlobal[] = [];
    if (gMap !== undefined) for (const [_k, g] of gMap) gList.push(g);
    const pList: CachedProperty[] = [];
    if (pMap !== undefined) for (const [_k, p] of pMap) pList.push(p);
    for (const op of info.invalidatingOps)
      addRefresh(opRefreshes, op, gList, pList);
    for (const blockId of info.invalidatingTerminators)
      addTermRefresh(termRefreshes, blockId, gList, pList);
    for (const cp of pList) {
      const writeOps = cp.objectWriteOps;
      if (writeOps !== undefined) {
        for (const writeOp of writeOps)
          addRefresh(opRefreshes, writeOp, [], [cp]);
      }
      for (const storeOp of cp.storeRefreshOps)
        addRefresh(opRefreshes, storeOp, [], [cp]);
    }
  }

  function opResultType(
    op: Instruction,
    knownTypes: Map<number, ScalarType>,
  ): ScalarType | undefined {
    switch (op.kind) {
      case "constant":
        return typeof op.value === "number" ? "number" : "boolean";
      case "string-literal":
      case "string-concat":
      case "string-slice":
      case "string-from-code-units":
      case "string-from-latin1":
      case "string-from-utf8":
      case "string-ascii-case":
      case "number-string-cached":
      case "string-allocate":
      case "error-message":
      case "general-kind":
        return "string";
      case "load":
        return slots[op.slot];
      case "unary":
        return op.operator === "!" ||
          op.operator === "truthy" ||
          op.operator === "is-integer"
          ? "boolean"
          : "number";
      case "binary":
        return op.operator === "===" ||
          op.operator === "!==" ||
          op.operator === "==" ||
          op.operator === "!=" ||
          op.operator === "<" ||
          op.operator === ">" ||
          op.operator === "<=" ||
          op.operator === ">="
          ? "boolean"
          : "number";
      case "call":
      case "call-indirect": {
        const ret = module.functions[op.target]?.returnType;
        return ret === undefined || ret === "void" ? undefined : ret;
      }
      case "host-call": {
        const ret = hostReturnType(op.operation);
        return ret === undefined || ret === "void" ? undefined : ret;
      }
      case "c-call": {
        const types = foreignCallTypes(op.call);
        if (!types.ok) return undefined;
        const result = types.value.result;
        return result === "void" ? undefined : result;
      }
      case "c-memory": {
        const types = foreignMemoryTypes(op.access);
        if (!types.ok) return undefined;
        const result = types.value.result;
        return result === "void" ? undefined : result;
      }
      case "activation-read":
        return activationFieldType(op.field);
      case "property-load":
      case "element-load":
      case "general-element-load":
      case "general-slot-load":
      case "record-slot-read":
      case "general-none":
      case "general-null":
      case "general-wrap":
      case "script-argument":
      case "weak-slot-new":
      case "weak-slot-key":
      case "weak-slot-value":
        return "general";
      case "property-store":
      case "element-store":
      case "general-element-store":
      case "general-slot-store":
      case "general-equal":
      case "general-is":
      case "general-record-is":
      case "optional-present":
      case "boolean-present":
      case "string-present":
      case "error-is":
      case "record-has":
      case "array-valid":
      case "array-copy":
      case "reference-vector-is":
      case "string-starts-with":
      case "string-two-byte":
        return "boolean";
      case "global-cell":
      case "script-entry":
      case "element-storage":
      case "string-split-cached":
      case "reference-none":
      case "reference-wrap":
      case "string-reference":
      case "reference-vector-read":
      case "function-environment":
        return "optional-reference";
      case "reference-value":
        return op.type ?? "reference";
      case "closure-environment":
      case "record-new":
      case "function-new":
      case "error-new":
      case "array-buffer":
      case "primitive-reference":
      case "reference-vector-new":
        return "reference";
      case "primitive-wrap":
        return "primitive";
      case "record-read":
        return module.records?.[op.record]?.fields[op.field]?.type;
      case "element-count":
      case "element-length":
      case "script-argument-count":
      case "array-length":
      case "array-byte-offset":
      case "array-byte-length":
      case "array-element":
      case "string-length":
      case "string-code-unit":
      case "string-index-of":
      case "string-copy-latin1":
      case "string-ascii-prefix":
      case "bytes-ascii-prefix":
      case "string-utf8-length":
      case "string-write-utf8":
      case "string-flat":
      case "string-flatten-into":
      case "string-index-cached":
      case "optional-value":
      case "optional-value-or":
      case "function-address":
      case "record-descriptor-address":
      case "general-record-descriptor":
      case "reference-vector-length":
        return "number";
      case "general-value":
        return op.type;
      case "undefined":
      case "optional-wrap":
      case "array-read":
        return "optional-number";
      case "boolean-none":
      case "boolean-wrap":
        return "optional-boolean";
      case "boolean-value":
      case "array-word64-read":
        return "boolean";
      case "string-none":
      case "string-wrap":
      case "reference-string":
        return "optional-string";
      case "string-value":
        return "string";
      case "array-new":
        return op.type;
      case "array-subarray":
        return knownTypes.get(op.array);
      case "store":
      case "array-write":
      case "array-store":
      case "array-fill":
      case "array-word64-write":
      case "array-word64-fill":
      case "array-atomic-word64":
      case "string-write":
      case "number-string-cache":
      case "string-index-cache":
      case "string-split-cache":
      case "weak-slot-set-value":
      case "weak-slot-clear":
      case "reference-vector-write":
      case "reference-vector-copy":
        return undefined;
    }
  }

  function refreshNeedsBranch(
    globals: readonly CachedGlobal[],
    props: readonly CachedProperty[],
  ): boolean {
    for (const cg of globals) {
      if (cg === undefined) continue;
      if (
        (cg.valSlot !== undefined &&
          cg.cellRecord !== undefined &&
          cg.valueField !== undefined) ||
        exprNeedsBranch(cg.scope) ||
        exprNeedsBranch(cg.cache)
      )
        return true;
    }
    for (const cp of props) {
      if (cp !== undefined && exprNeedsBranch(cp.site)) return true;
    }
    return false;
  }

  function emitStraightLineRefresh(
    globals: readonly CachedGlobal[],
    props: readonly CachedProperty[],
    into: Instruction[],
  ): void {
    for (const cg of globals) {
      if (cg === undefined) continue;
      const scope = emitExprStraight(cg.scope, into);
      const cache = emitExprStraight(cg.cache, into);
      const cell = nextValue++;
      const t = cg.template;
      into.push(
        {
          kind: "global-cell",
          id: cell,
          scope,
          cache,
          scopeRecord: t.scopeRecord,
          declarativeField: t.declarativeField,
          objectField: t.objectField,
          globalField: t.globalField,
          globalRecord: t.globalRecord,
          lexicalEpochField: t.lexicalEpochField,
          globalObjectField: t.globalObjectField,
          globalObjectRecord: t.globalObjectRecord,
          propertyEpochField: t.propertyEpochField,
          cacheRecord: t.cacheRecord,
          cacheGlobalField: t.cacheGlobalField,
          cacheLexicalEpochField: t.cacheLexicalEpochField,
          cacheObjectEpochField: t.cacheObjectEpochField,
          cacheCellField: t.cacheCellField,
          start: 0,
          end: 0,
        },
        { kind: "store", slot: cg.cellSlot, value: cell, start: 0, end: 0 },
      );
    }
    for (let pass = 0; pass < 2; pass++) {
      for (const cp of props) {
        if (cp === undefined) continue;
        if ((cp.fromProp !== undefined) !== (pass === 1)) continue;
        const obj = nextValue++;
        into.push({
          kind: "load",
          id: obj,
          slot: cp.objectSlot,
          start: 0,
          end: 0,
        });
        const site = emitExprStraight(cp.site, into);
        const prop = nextValue++;
        const t = cp.template;
        into.push(
          {
            kind: "property-load",
            id: prop,
            object: obj,
            site,
            record: t.record,
            field: t.field,
            count: t.count,
            siteRecord: t.siteRecord,
            siteField: t.siteField,
            inherited: t.inherited,
            entries: t.entries,
            epochRecord: t.epochRecord,
            epochField: t.epochField,
            ...(t.spillRecord === undefined
              ? {}
              : { spillRecord: t.spillRecord }),
            ...(t.spillField === undefined ? {} : { spillField: t.spillField }),
            start: 0,
            end: 0,
          },
          { kind: "store", slot: cp.propSlot, value: prop, start: 0, end: 0 },
        );
      }
    }
  }

  // Insert refreshes after each cold invalidating instruction. When a refresh
  // has no GlobalCell.value diamond, emit it inline in the same block (zero
  // block split). When it needs a diamond, split the block and spill any
  // block-local SSA value defined before the split and used after it.
  for (const block of fn.blocks) {
    if (block === undefined) throw "property cache block invariant";
    const current = replaced.get(block.id) ?? block;
    let hasAnyRefresh = false;
    for (const op of current.instructions) {
      if (op !== undefined && opRefreshes.has(op)) {
        hasAnyRefresh = true;
        break;
      }
    }
    if (!hasAnyRefresh) continue;

    // First expand inline straight-line refreshes and collect remaining split
    // points (only those requiring a GlobalCell.value branch diamond).
    const expanded: Instruction[] = [];
    const splitPoints: { index: number; refresh: RefreshSet }[] = [];
    for (let at = 0; at < current.instructions.length; at++) {
      const op = current.instructions[at];
      if (op === undefined) throw "property cache instruction invariant";
      expanded.push(op);
      const refresh = opRefreshes.get(op);
      if (refresh === undefined) continue;
      if (!refreshNeedsBranch(refresh.globals, refresh.props)) {
        emitStraightLineRefresh(refresh.globals, refresh.props, expanded);
      } else {
        splitPoints.push({ index: expanded.length - 1, refresh });
      }
    }

    if (splitPoints.length === 0) {
      replaced.set(current.id, { ...current, instructions: expanded });
      continue;
    }

    // Split sequentially at each diamond refresh point, spilling any SSA value
    // defined in the prefix and used in the suffix/terminator.
    let segId = current.id;
    let remaining = expanded;
    let carriedTerminator = current.terminator;
    let offset = 0;
    for (let s = 0; s < splitPoints.length; s++) {
      const point = splitPoints[s];
      if (point === undefined) throw "property cache split point invariant";
      const localCut = point.index - offset;
      const prefix = remaining.slice(0, localCut + 1);
      let suffix = remaining.slice(localCut + 1);
      offset = point.index + 1;

      const definedTypes = new Map<number, ScalarType>();
      for (const pOp of prefix) {
        if (pOp === undefined) continue;
        const id = instructionResult(pOp);
        if (id !== undefined) {
          const t = opResultType(pOp, definedTypes);
          if (t !== undefined) definedTypes.set(id, t);
        }
      }
      const usedAfter = new Set<number>();
      for (const sOp of suffix) {
        if (sOp !== undefined)
          visitInstructionOperands(sOp, (id) => {
            if (definedTypes.has(id)) usedAfter.add(id);
          });
      }
      visitTerminatorOperands(carriedTerminator, (id) => {
        if (definedTypes.has(id)) usedAfter.add(id);
      });

      const reloadMap = new Map<number, number>();
      const reloadOps: Instruction[] = [];
      for (const id of usedAfter) {
        const type = definedTypes.get(id);
        if (type === undefined) throw "property cache spill type invariant";
        const spillSlot = slots.length;
        slots.push(type);
        prefix.push({
          kind: "store",
          slot: spillSlot,
          value: id,
          start: 0,
          end: 0,
        });
        const reloaded = nextValue++;
        reloadOps.push({
          kind: "load",
          id: reloaded,
          slot: spillSlot,
          start: 0,
          end: 0,
        });
        reloadMap.set(id, reloaded);
      }
      if (reloadMap.size > 0) {
        let maxOld = 0;
        for (const [id, _v] of reloadMap) if (id > maxOld) maxOld = id;
        const subs = new Uint32Array(maxOld + 1);
        for (const [oldId, newId] of reloadMap) subs[oldId] = newId + 1;
        const nextSuffix: Instruction[] = [];
        for (const rOp of reloadOps) nextSuffix.push(rOp);
        for (const sOp of suffix) {
          if (sOp === undefined) continue;
          nextSuffix.push(substituteInstructionValues(sOp, subs));
        }
        suffix = nextSuffix;
        carriedTerminator = substituteTerminatorValues(carriedTerminator, subs);
      }
      const nextSegId = nextBlock++;
      const refreshEntry = buildRefreshChain(
        point.refresh.globals,
        point.refresh.props,
        nextSegId,
      );
      const exc = current.exception;
      const segBlock: Block =
        exc !== undefined
          ? {
              id: segId,
              instructions: prefix,
              terminator: {
                kind: "jump",
                target: refreshEntry,
                start: 0,
                end: 0,
              },
              exception: exc,
            }
          : {
              id: segId,
              instructions: prefix,
              terminator: {
                kind: "jump",
                target: refreshEntry,
                start: 0,
                end: 0,
              },
            };
      if (segId === current.id) replaced.set(current.id, segBlock);
      else added.push(segBlock);

      // Adjust remaining split indices by reloadOps.length if more splits follow.
      if (reloadOps.length > 0) {
        for (let k = s + 1; k < splitPoints.length; k++) {
          const nextPt = splitPoints[k];
          if (nextPt !== undefined) nextPt.index += reloadOps.length;
        }
      }
      segId = nextSegId;
      remaining = suffix;
    }
    const tailExc = current.exception;
    added.push(
      tailExc !== undefined
        ? {
            id: segId,
            instructions: remaining,
            terminator: carriedTerminator,
            exception: tailExc,
          }
        : {
            id: segId,
            instructions: remaining,
            terminator: carriedTerminator,
          },
    );
  }

  // Insert refresh chains on edges of invalidating terminators (record/cell
  // writes). Note: if the block was split above, its terminator now lives in
  // the last added segment; find it cleanly.
  for (const [blockId, refresh] of termRefreshes) {
    // Check replaced[blockId] first; if split, its original terminator moved to
    // the last segment in `added`. Actually, if a block had an invalidating
    // terminator AND was split, the terminator is on the last segment whose
    // terminator matches `fn.blocks[blockId].terminator`.
    const origTerm = fn.blocks[blockId]?.terminator;
    if (
      origTerm === undefined ||
      (origTerm.kind !== "record" &&
        origTerm.kind !== "record-cell" &&
        origTerm.kind !== "cell")
    )
      continue;
    let targetBlock = replaced.get(blockId) ?? fn.blocks[blockId];
    let inAddedIndex = -1;
    if (targetBlock === undefined || targetBlock.terminator !== origTerm) {
      for (let i = added.length - 1; i >= 0; i--) {
        if (added[i]?.terminator === origTerm) {
          targetBlock = added[i];
          inAddedIndex = i;
          break;
        }
      }
    }
    if (targetBlock === undefined) continue;
    const term = targetBlock.terminator;
    if (
      term.kind !== "record" &&
      term.kind !== "record-cell" &&
      term.kind !== "cell"
    )
      continue;
    const updated: Block = {
      ...targetBlock,
      terminator: {
        ...term,
        consequent: buildRefreshChain(
          refresh.globals,
          refresh.props,
          term.consequent,
        ),
        alternate: buildRefreshChain(
          refresh.globals,
          refresh.props,
          term.alternate,
        ),
      },
    };
    if (inAddedIndex >= 0) added[inAddedIndex] = updated;
    else replaced.set(blockId, updated);
  }

  // Phase 5: Wire preheader initialization for every active loop!
  // Preheader currently ends in `jump(loop.header)`; redirect it to a refresh
  // chain that jumps to `loop.header` (chaining cleanly if one preheader feeds
  // a loop whose header is shared — note preheaders are unique per loop!).
  for (const loop of activeLoops) {
    const info = loopInfo.get(loop);
    if (info === undefined) continue;
    const origTerm = info.preheader.terminator;
    let entry: Block = replaced.get(info.preheader.id) ?? info.preheader;
    let inAddedIndex = -1;
    if (entry.terminator !== origTerm) {
      for (let i = added.length - 1; i >= 0; i--) {
        const cand = added[i];
        if (cand !== undefined && cand.terminator === origTerm) {
          entry = cand;
          inAddedIndex = i;
          break;
        }
      }
    }
    const entryTerm = entry.terminator;
    if (entryTerm.kind !== "jump") continue;
    const gMap = selectedGlobals.get(loop);
    const pMap = selectedProps.get(loop);
    const gList: CachedGlobal[] = [];
    if (gMap !== undefined) for (const [_k, g] of gMap) gList.push(g);
    const pList: CachedProperty[] = [];
    if (pMap !== undefined) for (const [_k, p] of pMap) pList.push(p);
    const refreshEntry = buildRefreshChain(gList, pList, entryTerm.target);
    const updated: Block = {
      ...entry,
      terminator: { ...entryTerm, target: refreshEntry },
    };
    if (inAddedIndex >= 0) added[inAddedIndex] = updated;
    else replaced.set(entry.id, updated);
  }

  const allBlocks: Block[] = [];
  for (const block of fn.blocks) {
    if (block === undefined) throw "property cache block invariant";
    allBlocks.push(replaced.get(block.id) ?? block);
  }
  added.sort((a, b) => a.id - b.id);
  for (const block of added) {
    if (block === undefined) throw "property cache added block invariant";
    allBlocks.push(block);
  }

  // Prune any blocks made unreachable (e.g. trap blocks of bypassed GlobalCell
  // record-read terminators) and compact block IDs densely.
  const reachable = new Uint8Array(allBlocks.length);
  const queue: number[] = [fn.entry];
  reachable[fn.entry] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    if (id === undefined) continue;
    const block = allBlocks[id];
    if (block === undefined) continue;
    for (const next of blockSuccessors(block)) {
      if (next !== undefined && reachable[next] === 0) {
        reachable[next] = 1;
        queue.push(next);
      }
    }
    if (
      block.exception !== undefined &&
      reachable[block.exception.target] === 0
    ) {
      reachable[block.exception.target] = 1;
      queue.push(block.exception.target);
    }
  }
  let blocks = allBlocks;
  let entry = fn.entry;
  if (queue.length < allBlocks.length) {
    const remap = new Uint32Array(allBlocks.length);
    let nextId = 0;
    for (let i = 0; i < allBlocks.length; i++)
      if (reachable[i] === 1) remap[i] = ++nextId;
    function mapTarget(target: number): number {
      const mapped = remap[target];
      if (mapped === undefined || mapped === 0)
        throw "property cache remap invariant";
      return mapped - 1;
    }
    const compacted: Block[] = [];
    for (let i = 0; i < allBlocks.length; i++) {
      if (reachable[i] !== 1) continue;
      const block = allBlocks[i];
      if (block === undefined) continue;
      const t = block.terminator;
      let terminator: Block["terminator"] = t;
      if (t.kind === "jump") terminator = { ...t, target: mapTarget(t.target) };
      else if (
        t.kind === "branch" ||
        t.kind === "record" ||
        t.kind === "record-cell" ||
        t.kind === "cell"
      )
        terminator = {
          ...t,
          consequent: mapTarget(t.consequent),
          alternate: mapTarget(t.alternate),
        };
      compacted.push({
        ...block,
        id: mapTarget(block.id),
        terminator,
        ...(block.exception === undefined
          ? {}
          : {
              exception: {
                ...block.exception,
                target: mapTarget(block.exception.target),
              },
            }),
      });
    }
    blocks = compacted;
    entry = mapTarget(fn.entry);
  }

  let resultFn: FunctionIR = { ...fn, entry, slots, blocks };
  let hasRecordRead = false;
  for (const block of resultFn.blocks) {
    if (block === undefined) continue;
    for (const op of block.instructions) {
      if (op !== undefined && op.kind === "record-read") {
        hasRecordRead = true;
        break;
      }
    }
    if (hasRecordRead) break;
  }
  if (hasRecordRead) {
    const stable = stableDescriptors(module);
    const proofs = provenRecordReads(resultFn, verifierRecordWork, stable);
    if (proofs === undefined) return { fn, visited, rewritten: 0 };
    let needsRepair = false;
    for (const block of resultFn.blocks) {
      if (block === undefined) continue;
      for (const op of block.instructions) {
        if (
          op !== undefined &&
          op.kind === "record-read" &&
          proofs[op.id] !== 1
        ) {
          needsRepair = true;
          break;
        }
      }
      if (needsRepair) break;
    }
    if (needsRepair) {
      // Refresh diamonds inserted inside loops can sever unique-predecessor
      // proof chains for pre-existing `record-read` instructions. Restore only
      // the affected reads to checked `record` terminators (codegen's forward
      // dataflow still eliminates their guards across joins).
      const repaired: Block[] = resultFn.blocks.slice();
      const extra: Block[] = [];
      let nextRepairedBlock = repaired.length;
      for (let bi = 0; bi < resultFn.blocks.length; bi++) {
        const block = resultFn.blocks[bi];
        if (block === undefined) continue;
        const badIndices: number[] = [];
        for (let ii = 0; ii < block.instructions.length; ii++) {
          const op = block.instructions[ii];
          if (
            op !== undefined &&
            op.kind === "record-read" &&
            proofs[op.id] !== 1
          )
            badIndices.push(ii);
        }
        if (badIndices.length === 0) continue;
        let segId = block.id;
        let remaining = block.instructions.slice();
        let carriedTerm = block.terminator;
        const exc = block.exception;
        let cutOffset = 0;
        for (let k = 0; k < badIndices.length; k++) {
          const origIdx = badIndices[k];
          if (origIdx === undefined) continue;
          const localCut = origIdx - cutOffset;
          const badOp = remaining[localCut];
          if (badOp === undefined || badOp.kind !== "record-read") continue;
          const rec = module.records?.[badOp.record];
          const field = rec?.fields[badOp.field];
          if (field === undefined) return { fn, visited, rewritten: 0 };
          const prefix = remaining.slice(0, localCut);
          let suffix = remaining.slice(localCut + 1);
          cutOffset = origIdx + 1;

          const definedTypes = new Map<number, ScalarType>();
          for (const pOp of prefix) {
            if (pOp === undefined) continue;
            const id = instructionResult(pOp);
            if (id !== undefined) {
              const t = opResultType(pOp, definedTypes);
              if (t !== undefined) definedTypes.set(id, t);
            }
          }
          const usedAfter = new Set<number>();
          for (const sOp of suffix) {
            if (sOp !== undefined)
              visitInstructionOperands(sOp, (id) => {
                if (definedTypes.has(id)) usedAfter.add(id);
              });
          }
          visitTerminatorOperands(carriedTerm, (id) => {
            if (definedTypes.has(id)) usedAfter.add(id);
          });
          const reloadMap = new Map<number, number>();
          const reloadOps: Instruction[] = [];
          for (const id of usedAfter) {
            const type = definedTypes.get(id);
            if (type === undefined) return { fn, visited, rewritten: 0 };
            const spillSlot = slots.length;
            slots.push(type);
            prefix.push({
              kind: "store",
              slot: spillSlot,
              value: id,
              start: 0,
              end: 0,
            });
            const reloaded = nextValue++;
            reloadOps.push({
              kind: "load",
              id: reloaded,
              slot: spillSlot,
              start: 0,
              end: 0,
            });
            reloadMap.set(id, reloaded);
          }
          const resSlot = slots.length;
          slots.push(field.type);
          const loadRes: Instruction = {
            kind: "load",
            id: badOp.id,
            slot: resSlot,
            start: badOp.start,
            end: badOp.end,
          };
          if (reloadMap.size > 0) {
            let maxOld = 0;
            for (const [id, _v] of reloadMap) if (id > maxOld) maxOld = id;
            const subs = new Uint32Array(maxOld + 1);
            for (const [oldId, newId] of reloadMap) subs[oldId] = newId + 1;
            const nextSuffix: Instruction[] = [loadRes];
            for (const rOp of reloadOps) nextSuffix.push(rOp);
            for (const sOp of suffix) {
              if (sOp === undefined) continue;
              nextSuffix.push(substituteInstructionValues(sOp, subs));
            }
            suffix = nextSuffix;
            carriedTerm = substituteTerminatorValues(carriedTerm, subs);
            for (let m = k + 1; m < badIndices.length; m++) {
              const nextBad = badIndices[m];
              if (nextBad !== undefined)
                badIndices[m] = nextBad + reloadOps.length + 1;
            }
          } else {
            const nextSuffix: Instruction[] = [loadRes];
            for (const sOp of suffix) {
              if (sOp !== undefined) nextSuffix.push(sOp);
            }
            suffix = nextSuffix;
            for (let m = k + 1; m < badIndices.length; m++) {
              const nextBad = badIndices[m];
              if (nextBad !== undefined) badIndices[m] = nextBad + 1;
            }
          }
          const trapId = nextRepairedBlock++;
          const nextSegId = nextRepairedBlock++;
          const segTerm: Block["terminator"] = {
            kind: "record",
            operation: "read",
            object: badOp.object,
            record: badOp.record,
            field: badOp.field,
            slot: resSlot,
            consequent: nextSegId,
            alternate: trapId,
            start: badOp.start,
            end: badOp.end,
          };
          const segBlock: Block =
            exc !== undefined
              ? {
                  id: segId,
                  instructions: prefix,
                  terminator: segTerm,
                  exception: exc,
                }
              : { id: segId, instructions: prefix, terminator: segTerm };
          if (segId < repaired.length) repaired[segId] = segBlock;
          else extra.push(segBlock);
          extra.push({
            id: trapId,
            instructions: [],
            terminator: { kind: "trap", start: badOp.start, end: badOp.end },
          });
          segId = nextSegId;
          remaining = suffix;
        }
        extra.push(
          exc !== undefined
            ? {
                id: segId,
                instructions: remaining,
                terminator: carriedTerm,
                exception: exc,
              }
            : { id: segId, instructions: remaining, terminator: carriedTerm },
        );
      }
      extra.sort((a, b) => a.id - b.id);
      for (const b of extra) {
        if (b !== undefined) repaired.push(b);
      }
      resultFn = { ...resultFn, slots, blocks: repaired };
      const recheck = provenRecordReads(resultFn, verifierRecordWork, stable);
      if (recheck === undefined) return { fn, visited, rewritten: 0 };
      for (const block of resultFn.blocks) {
        if (block === undefined) continue;
        for (const op of block.instructions) {
          if (
            op !== undefined &&
            op.kind === "record-read" &&
            recheck[op.id] !== 1
          )
            return { fn, visited, rewritten: 0 };
        }
      }
    }
  }

  const first = fn.blocks[fn.entry];
  remarks?.({
    pass: "cache-loop-properties",
    outcome: "applied",
    function: fn.name,
    start: first?.terminator.start ?? 0,
    end: first?.terminator.end ?? 0,
    message: String(rewritten) + " loop global/property accesses cached",
  });
  return { fn: resultFn, visited, rewritten };
}

interface PropDef {
  readonly id: number;
  readonly kind: "property-load" | "global-cell";
  readonly blockId: number;
  readonly opIndex: number;
  readonly propOp: PropertyLoadOp | undefined;
  readonly globalOp: GlobalCellOp | undefined;
  /** Receiver slot for `property-load`, or scope slot (`-1` when from an
   * immutable expression) for `global-cell`. */
  readonly objSlot: number;
  readonly propKey: string;
  readonly key: string;
  readonly selfMissBlock: number | undefined;
}

/**
 * Eliminates redundant same-receiver `property-load` and `global-cell` probes
 * across dominating paths (including across sibling cold miss blocks by
 * refreshing on those cold blocks).
 *
 * Every dominating `property-load` (or `global-cell`) stores its raw result
 * (`V` on hit, `absent`/`undefined` on miss) into a dedicated `probeSlot`.
 * Because `probeSlot` is initialized at the dominating producer, every
 * dominated redundant probe for the same receiver/key can load `probeSlot`
 * directly: on the fast path it sees the cached hit without re-probing; on a
 * miss of the producer (e.g. a getter or proxy) it sees `absent`/`undefined`
 * and takes its own slow path. Any cold miss block of an unrelated access
 * between producer and use refreshes `probeSlot`, preserving exact mutation
 * semantics even if that unrelated slow path invoked a mutating getter.
 */
export function forwardDominatingProperties(
  fn: FunctionIR,
  module: ModuleIR,
  budget: number,
  remarks?: RemarkSink,
  shared?: ModulePropertySites,
): LoopPropertyCaching | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  if (fn.import === true || fn.blocks.length === 0 || !hasScriptOperations(fn))
    return { fn, visited: 0, rewritten: 0 };

  let visited = 0,
    propLoadCount = 0,
    globalCellCount = 0,
    nextValue = 0;
  const watchedRecords = new Set<number>();
  for (const block of fn.blocks) {
    if (block === undefined) throw "property cse block invariant";
    for (const op of block.instructions) {
      if (op === undefined) throw "property cse instruction invariant";
      if (++visited > budget) return undefined;
      const resId = instructionResult(op);
      if (resId !== undefined && resId >= nextValue) nextValue = resId + 1;
      if (op.kind === "property-load") {
        propLoadCount++;
        watchedRecords.add(op.record);
        watchedRecords.add(op.siteRecord);
        watchedRecords.add(op.epochRecord);
        if (op.spillRecord !== undefined) watchedRecords.add(op.spillRecord);
      } else if (op.kind === "global-cell") {
        globalCellCount++;
        watchedRecords.add(op.scopeRecord);
        watchedRecords.add(op.globalRecord);
        watchedRecords.add(op.globalObjectRecord);
        watchedRecords.add(op.cacheRecord);
      }
    }
  }
  if (propLoadCount + globalCellCount < 2) return { fn, visited, rewritten: 0 };

  const sites =
    shared ?? analyzeModulePropertySites(module, Math.max(1, budget - visited));
  if (sites === undefined) return undefined;
  if (shared === undefined) visited += sites.visited;
  const siteFieldName = sites.siteFieldName;
  const mutatedRecordFields = sites.mutatedRecordFields;

  // Whole-module call-effect memoization (0 = computing, 1 = clean, 2 = invalidates).
  const callState = new Map<number, number>();
  let effectBudgetExhausted = false;
  function calleeInvalidates(targetId: number): boolean {
    const cached = callState.get(targetId);
    if (cached === 1) return false;
    if (cached === 2) return true;
    if (cached === 0) return false;
    const target = module.functions[targetId];
    if (target === undefined || target.import === true) {
      callState.set(targetId, 2);
      return true;
    }
    callState.set(targetId, 0);
    const directCallees: number[] = [];
    for (const block of target.blocks) {
      if (block === undefined) continue;
      if (++visited > budget) {
        effectBudgetExhausted = true;
        callState.set(targetId, 2);
        return true;
      }
      const term = block.terminator;
      if (
        (term.kind === "record" || term.kind === "record-cell") &&
        term.operation !== "read" &&
        watchedRecords.has(term.record)
      ) {
        callState.set(targetId, 2);
        return true;
      }
      for (const op of block.instructions) {
        if (op === undefined) continue;
        if (
          op.kind === "call-indirect" ||
          op.kind === "host-call" ||
          op.kind === "property-store" ||
          (op.kind === "c-call" && op.call.mayCallback === true)
        ) {
          callState.set(targetId, 2);
          return true;
        }
        if (op.kind === "call") directCallees.push(op.target);
      }
    }
    for (const sub of directCallees) {
      if (sub === undefined) continue;
      if (calleeInvalidates(sub)) {
        callState.set(targetId, 2);
        return true;
      }
    }
    callState.set(targetId, 1);
    return false;
  }

  function mayHardInvalidate(op: Instruction): boolean {
    if (
      op.kind === "call-indirect" ||
      op.kind === "host-call" ||
      (op.kind === "c-call" && op.call.mayCallback === true)
    )
      return true;
    if (op.kind === "call") return calleeInvalidates(op.target);
    return false;
  }

  // Reachable blocks in reverse postorder, predecessors, exception targets,
  // and immediate dominators (Cooper-Harvey-Kennedy).
  const blockCount = fn.blocks.length;
  const visitedBlock = new Uint8Array(blockCount);
  const postorder: number[] = [];
  const stackBlock: number[] = [fn.entry];
  const stackNext: number[] = [0];
  visitedBlock[fn.entry] = 1;
  while (stackBlock.length > 0) {
    const topIdx = stackBlock.length - 1;
    const bid = stackBlock[topIdx];
    const nextIdx = stackNext[topIdx];
    if (bid === undefined || nextIdx === undefined)
      throw "property cse stack invariant";
    const blk = fn.blocks[bid];
    if (blk === undefined) throw "property cse block invariant";
    const succs = blockSuccessors(blk);
    if (nextIdx < succs.length) {
      stackNext[topIdx] = nextIdx + 1;
      const s = succs[nextIdx];
      if (s !== undefined && visitedBlock[s] === 0) {
        visitedBlock[s] = 1;
        stackBlock.push(s);
        stackNext.push(0);
      }
    } else {
      stackBlock.pop();
      stackNext.pop();
      postorder.push(bid);
    }
  }
  const rpo: number[] = [];
  const rpoIndex = new Int32Array(blockCount);
  for (let i = 0; i < blockCount; i++) rpoIndex[i] = -1;
  for (let i = postorder.length - 1; i >= 0; i--) {
    const bid = postorder[i];
    if (bid === undefined) continue;
    rpoIndex[bid] = rpo.length;
    rpo.push(bid);
  }
  const preds: number[][] = [];
  for (let i = 0; i < blockCount; i++) preds.push([]);
  const exceptionTargets = new Set<number>();
  for (const bid of rpo) {
    const blk = fn.blocks[bid];
    if (blk === undefined) continue;
    if (blk.exception !== undefined) exceptionTargets.add(blk.exception.target);
    for (const s of blockSuccessors(blk)) {
      if (s !== undefined && (rpoIndex[s] ?? -1) >= 0) {
        const list = preds[s];
        if (list !== undefined && list.indexOf(bid) < 0) list.push(bid);
      }
    }
  }
  const idom = new Int32Array(blockCount);
  for (let i = 0; i < blockCount; i++) idom[i] = -1;
  idom[fn.entry] = fn.entry;
  function intersectDom(a: number, b: number): number {
    let f1 = a,
      f2 = b;
    while (f1 !== f2) {
      while ((rpoIndex[f1] ?? -1) > (rpoIndex[f2] ?? -1)) f1 = idom[f1] ?? -1;
      while ((rpoIndex[f2] ?? -1) > (rpoIndex[f1] ?? -1)) f2 = idom[f2] ?? -1;
    }
    return f1;
  }
  let domChanged = true;
  while (domChanged) {
    domChanged = false;
    for (let i = 1; i < rpo.length; i++) {
      const bid = rpo[i];
      if (bid === undefined) continue;
      const ps = preds[bid];
      if (ps === undefined) continue;
      let newIdom = -1;
      for (const p of ps) {
        if (p !== undefined && (idom[p] ?? -1) >= 0) {
          newIdom = newIdom < 0 ? p : intersectDom(p, newIdom);
        }
      }
      if (newIdom >= 0 && idom[bid] !== newIdom) {
        idom[bid] = newIdom;
        domChanged = true;
      }
    }
  }
  function dominates(a: number, b: number): boolean {
    if (a === b) return true;
    let cur = b;
    while (cur !== fn.entry && cur >= 0) {
      const next = idom[cur] ?? -1;
      if (next === a) return true;
      if (next === cur) break;
      cur = next;
    }
    return a === fn.entry;
  }

  // Forward must-dataflow for:
  //  - `refField`: reference slot -> immutable `"record:field"` key (resolving
  //    `$pc` property-cache and `$gc` global-cache sites even through reused
  //    temporary slots).
  //  - `genAlias`: general slot -> canonical root general slot (copy aliasing
  //    across inlined method receiver/parameter copies).
  function cloneStrMap(src: Map<number, string>): Map<number, string> {
    const out = new Map<number, string>();
    for (const [k, v] of src) out.set(k, v);
    return out;
  }
  function strMapsEqual(
    a: Map<number, string> | undefined,
    b: Map<number, string>,
  ): boolean {
    if (a === undefined || a.size !== b.size) return false;
    for (const [k, v] of a) if (b.get(k) !== v) return false;
    return true;
  }
  function cloneNumMap(src: Map<number, number>): Map<number, number> {
    const out = new Map<number, number>();
    for (const [k, v] of src) out.set(k, v);
    return out;
  }
  function numMapsEqual(
    a: Map<number, number> | undefined,
    b: Map<number, number>,
  ): boolean {
    if (a === undefined || a.size !== b.size) return false;
    for (const [k, v] of a) if (b.get(k) !== v) return false;
    return true;
  }
  function resolveAlias(slot: number, alias: Map<number, number>): number {
    let cur = slot;
    for (let hop = 0; hop < 6; hop++) {
      const next = alias.get(cur);
      if (next === undefined || next === cur) return cur;
      cur = next;
    }
    return cur;
  }
  function killAliasSlot(slot: number, alias: Map<number, number>): void {
    alias.delete(slot);
    for (const [k, r] of alias) if (r === slot) alias.delete(k);
  }
  function immutableFieldKey(
    record: number,
    field: number,
    parentFk?: string,
  ): string | undefined {
    const layoutField = module.records?.[record]?.fields[field];
    const leaf = String(record) + ":" + String(field);
    const immutable =
      (layoutField !== undefined && !layoutField.mutable) ||
      !mutatedRecordFields.has(leaf);
    if (!immutable) return undefined;
    return parentFk !== undefined ? parentFk + "->" + leaf : leaf;
  }
  function lookupPropSiteName(fk: string | undefined): string | undefined {
    if (fk === undefined) return undefined;
    const direct = siteFieldName.get(fk);
    if (direct !== undefined) return direct;
    const arrow = fk.lastIndexOf("->");
    if (arrow > 0) {
      const twoLevel = fk.indexOf("->", 0);
      if (twoLevel !== arrow) {
        const suffix = siteFieldName.get(fk.slice(twoLevel + 2));
        if (suffix !== undefined) return suffix;
      }
      return siteFieldName.get(fk.slice(arrow + 2));
    }
    return undefined;
  }

  const refFieldIn = new Map<number, Map<number, string>>();
  const refFieldOut = new Map<number, Map<number, string>>();
  const aliasIn = new Map<number, Map<number, number>>();
  const aliasOut = new Map<number, Map<number, number>>();
  let metaChanged = true;
  let metaIters = 0;
  const maxMetaIters = Math.max(8, rpo.length * 2);
  while (metaChanged && metaIters < maxMetaIters) {
    metaChanged = false;
    metaIters++;
    for (const bid of rpo) {
      let curRef: Map<number, string>;
      let curAlias: Map<number, number>;
      if (bid === fn.entry || exceptionTargets.has(bid)) {
        curRef = new Map<number, string>();
        curAlias = new Map<number, number>();
      } else {
        curRef = new Map<number, string>();
        curAlias = new Map<number, number>();
        const ps = preds[bid];
        if (ps !== undefined && ps.length > 0) {
          let firstRef: Map<number, string> | undefined;
          let firstAlias: Map<number, number> | undefined;
          const readyPreds: number[] = [];
          for (const p of ps) {
            if (p === undefined) continue;
            const ro = refFieldOut.get(p);
            const ao = aliasOut.get(p);
            if (ro !== undefined && ao !== undefined) {
              readyPreds.push(p);
              if (firstRef === undefined) {
                firstRef = ro;
                firstAlias = ao;
              }
            }
          }
          if (firstRef !== undefined) {
            for (const [s, fk] of firstRef) {
              let ok = true;
              for (let j = 1; j < readyPreds.length; j++) {
                const p = readyPreds[j];
                if (p === undefined || refFieldOut.get(p)?.get(s) !== fk) {
                  ok = false;
                  break;
                }
              }
              if (ok) curRef.set(s, fk);
            }
          }
          if (firstAlias !== undefined) {
            for (const [s, r] of firstAlias) {
              let ok = true;
              for (let j = 1; j < readyPreds.length; j++) {
                const p = readyPreds[j];
                if (p === undefined || aliasOut.get(p)?.get(s) !== r) {
                  ok = false;
                  break;
                }
              }
              if (ok) curAlias.set(s, r);
            }
          }
        }
      }
      refFieldIn.set(bid, cloneStrMap(curRef));
      aliasIn.set(bid, cloneNumMap(curAlias));
      const blk = fn.blocks[bid];
      if (blk !== undefined) {
        const valRefField = new Map<number, string>();
        const valGenSlot = new Map<number, number>();
        for (const op of blk.instructions) {
          if (op === undefined) continue;
          if (++visited > budget) return undefined;
          if (op.kind === "record-read") {
            const fk = immutableFieldKey(
              op.record,
              op.field,
              valRefField.get(op.object),
            );
            if (fk !== undefined) valRefField.set(op.id, fk);
          } else if (op.kind === "load") {
            const fk = curRef.get(op.slot);
            if (fk !== undefined) valRefField.set(op.id, fk);
            if (fn.slots[op.slot] === "general") valGenSlot.set(op.id, op.slot);
          } else if (op.kind === "store") {
            const fk = valRefField.get(op.value);
            if (fk !== undefined) curRef.set(op.slot, fk);
            else curRef.delete(op.slot);
            const srcSlot = valGenSlot.get(op.value);
            const srcRoot =
              srcSlot !== undefined && fn.slots[op.slot] === "general"
                ? resolveAlias(srcSlot, curAlias)
                : undefined;
            killAliasSlot(op.slot, curAlias);
            if (srcRoot !== undefined && srcRoot !== op.slot)
              curAlias.set(op.slot, srcRoot);
          }
        }
        const term = blk.terminator;
        if (
          (term.kind === "record" ||
            term.kind === "record-cell" ||
            term.kind === "cell") &&
          term.operation === "read"
        ) {
          const fk =
            term.kind === "record" || term.kind === "record-cell"
              ? immutableFieldKey(
                  term.record,
                  term.field,
                  valRefField.get(term.object),
                )
              : undefined;
          if (fk !== undefined) curRef.set(term.slot, fk);
          else curRef.delete(term.slot);
          killAliasSlot(term.slot, curAlias);
        }
      }
      if (!strMapsEqual(refFieldOut.get(bid), curRef)) {
        refFieldOut.set(bid, curRef);
        metaChanged = true;
      }
      if (!numMapsEqual(aliasOut.get(bid), curAlias)) {
        aliasOut.set(bid, curAlias);
        metaChanged = true;
      }
    }
  }
  if (metaChanged) return { fn, visited, rewritten: 0 };

  // Identify dedicated cold miss edges from property/element/global-cell probes.
  const missEdges = new Set<string>();
  const loadSelfMiss = new Map<number, number>();
  for (const bid of rpo) {
    const blk = fn.blocks[bid];
    if (blk === undefined) continue;
    const term = blk.terminator;
    if (term.kind !== "branch") continue;
    let lastLoadId = -1;
    let lastLoadIsProp = false;
    let lastStoreId = -1;
    let lastGlobalId = -1;
    const loadAliases = new Set<number>();
    const loadAliasSlots = new Set<number>();
    const storeAliases = new Set<number>();
    const storeAliasSlots = new Set<number>();
    const globalAliases = new Set<number>();
    const globalAliasSlots = new Set<number>();
    const refNones = new Set<number>();
    const absentVals = new Set<number>();
    const notAbsentVals = new Set<number>();
    const notStoreVals = new Set<number>();
    const globalMissVals = new Set<number>();
    const globalHitVals = new Set<number>();
    for (const op of blk.instructions) {
      if (op === undefined) continue;
      if (
        op.kind === "property-load" ||
        op.kind === "element-load" ||
        op.kind === "general-element-load" ||
        op.kind === "element-length"
      ) {
        lastLoadId = op.id;
        lastLoadIsProp = op.kind === "property-load";
        loadAliases.clear();
        loadAliasSlots.clear();
        absentVals.clear();
        notAbsentVals.clear();
        loadAliases.add(op.id);
      } else if (
        op.kind === "property-store" ||
        op.kind === "element-store" ||
        op.kind === "general-element-store"
      ) {
        lastStoreId = op.id;
        storeAliases.clear();
        storeAliasSlots.clear();
        notStoreVals.clear();
        storeAliases.add(op.id);
      } else if (op.kind === "global-cell") {
        lastGlobalId = op.id;
        globalAliases.clear();
        globalAliasSlots.clear();
        globalMissVals.clear();
        globalHitVals.clear();
        globalAliases.add(op.id);
      } else if (op.kind === "reference-none") {
        refNones.add(op.id);
      } else if (op.kind === "store") {
        if (loadAliases.has(op.value)) loadAliasSlots.add(op.slot);
        else loadAliasSlots.delete(op.slot);
        if (storeAliases.has(op.value)) storeAliasSlots.add(op.slot);
        else storeAliasSlots.delete(op.slot);
        if (globalAliases.has(op.value)) globalAliasSlots.add(op.slot);
        else globalAliasSlots.delete(op.slot);
      } else if (op.kind === "load") {
        if (loadAliasSlots.has(op.slot)) loadAliases.add(op.id);
        if (storeAliasSlots.has(op.slot)) storeAliases.add(op.id);
        if (globalAliasSlots.has(op.slot)) globalAliases.add(op.id);
      } else if (
        op.kind === "general-is" &&
        op.type === "absent" &&
        loadAliases.has(op.value)
      ) {
        absentVals.add(op.id);
      } else if (
        op.kind === "binary" &&
        (op.operator === "===" || op.operator === "!==")
      ) {
        const cmpGlobal =
          (globalAliases.has(op.left) && refNones.has(op.right)) ||
          (globalAliases.has(op.right) && refNones.has(op.left));
        if (cmpGlobal) {
          if (op.operator === "===") globalMissVals.add(op.id);
          else globalHitVals.add(op.id);
        }
      } else if (op.kind === "unary" && op.operator === "!") {
        if (absentVals.has(op.operand)) notAbsentVals.add(op.id);
        if (storeAliases.has(op.operand)) notStoreVals.add(op.id);
        if (globalMissVals.has(op.operand)) globalHitVals.add(op.id);
        if (globalHitVals.has(op.operand)) globalMissVals.add(op.id);
      }
    }
    let missTarget: number | undefined;
    let selfProbeId = -1;
    if (lastLoadId >= 0 && absentVals.has(term.condition)) {
      missTarget = term.consequent;
      if (lastLoadIsProp) selfProbeId = lastLoadId;
    } else if (lastLoadId >= 0 && notAbsentVals.has(term.condition)) {
      missTarget = term.alternate;
      if (lastLoadIsProp) selfProbeId = lastLoadId;
    } else if (lastStoreId >= 0 && storeAliases.has(term.condition)) {
      missTarget = term.alternate;
    } else if (lastStoreId >= 0 && notStoreVals.has(term.condition)) {
      missTarget = term.consequent;
    } else if (lastGlobalId >= 0 && globalMissVals.has(term.condition)) {
      missTarget = term.consequent;
      selfProbeId = lastGlobalId;
    } else if (lastGlobalId >= 0 && globalHitVals.has(term.condition)) {
      missTarget = term.alternate;
      selfProbeId = lastGlobalId;
    }
    if (missTarget !== undefined) {
      missEdges.add(String(bid) + "->" + String(missTarget));
      if (selfProbeId >= 0) loadSelfMiss.set(selfProbeId, missTarget);
    }
  }

  // A block is a cold miss block iff all of its incoming edges are miss edges
  // or originate from already-classified cold miss blocks, and its terminator
  // is a plain control transfer (not a record write or return/throw).
  const coldMissBlocks = new Set<number>();
  let coldChanged = true;
  while (coldChanged) {
    coldChanged = false;
    for (const bid of rpo) {
      if (bid === fn.entry || coldMissBlocks.has(bid)) continue;
      if (exceptionTargets.has(bid)) continue;
      const blk = fn.blocks[bid];
      if (blk === undefined) continue;
      const tk = blk.terminator.kind;
      if (tk !== "jump" && tk !== "branch") continue;
      const ps = preds[bid];
      if (ps === undefined || ps.length === 0) continue;
      let allCold = true;
      for (const p of ps) {
        if (
          p === undefined ||
          (!missEdges.has(String(p) + "->" + String(bid)) &&
            !coldMissBlocks.has(p))
        ) {
          allCold = false;
          break;
        }
      }
      if (allCold) {
        coldMissBlocks.add(bid);
        coldChanged = true;
      }
    }
  }

  // Pre-scan per-block `property-load` and `global-cell` descriptors,
  // `property-store` keys, and written slots.
  const defs: PropDef[] = [];
  const opToDef = new Map<number, number>();
  const storeOpKey = new Map<number, string>();
  const blockWrittenSlots = new Map<number, Set<number>>();
  for (const bid of rpo) {
    const blk = fn.blocks[bid];
    if (blk === undefined) continue;
    const curRef = cloneStrMap(
      refFieldIn.get(bid) ?? new Map<number, string>(),
    );
    const curAlias = cloneNumMap(aliasIn.get(bid) ?? new Map<number, number>());
    const valGenSlot = new Map<number, number>();
    const valRefSlot = new Map<number, number>();
    const valRefField = new Map<number, string>();
    const valIsClosureEnv = new Set<number>();
    const written = new Set<number>();
    for (let idx = 0; idx < blk.instructions.length; idx++) {
      const op = blk.instructions[idx];
      if (op === undefined) continue;
      if (op.kind === "closure-environment") {
        valIsClosureEnv.add(op.id);
      } else if (op.kind === "load") {
        if (fn.slots[op.slot] === "general") valGenSlot.set(op.id, op.slot);
        if (fn.slots[op.slot] === "reference") valRefSlot.set(op.id, op.slot);
        const fk = curRef.get(op.slot);
        if (fk !== undefined) valRefField.set(op.id, fk);
      } else if (op.kind === "record-read") {
        const fk = immutableFieldKey(
          op.record,
          op.field,
          valRefField.get(op.object),
        );
        if (fk !== undefined) valRefField.set(op.id, fk);
      } else if (op.kind === "store") {
        written.add(op.slot);
        const fk = valRefField.get(op.value);
        if (fk !== undefined) curRef.set(op.slot, fk);
        else curRef.delete(op.slot);
        const srcSlot = valGenSlot.get(op.value);
        const srcRoot =
          srcSlot !== undefined && fn.slots[op.slot] === "general"
            ? resolveAlias(srcSlot, curAlias)
            : undefined;
        killAliasSlot(op.slot, curAlias);
        if (srcRoot !== undefined && srcRoot !== op.slot)
          curAlias.set(op.slot, srcRoot);
      } else if (op.kind === "property-load") {
        const rawSlot = valGenSlot.get(op.object);
        const fk = valRefField.get(op.site);
        const propKey = lookupPropSiteName(fk);
        if (
          rawSlot !== undefined &&
          propKey !== undefined &&
          isSafeDisambiguatedKey(propKey)
        ) {
          const objSlot = resolveAlias(rawSlot, curAlias);
          const defId = defs.length;
          const selfMiss = loadSelfMiss.get(op.id);
          defs.push({
            id: defId,
            kind: "property-load",
            blockId: bid,
            opIndex: idx,
            propOp: op,
            globalOp: undefined,
            objSlot,
            propKey,
            key:
              "p:" +
              String(objSlot) +
              ":" +
              propKey +
              (op.inherited ? ":i" : ":o"),
            selfMissBlock:
              selfMiss !== undefined && coldMissBlocks.has(selfMiss)
                ? selfMiss
                : undefined,
          });
          opToDef.set(op.id, defId);
        }
      } else if (op.kind === "global-cell") {
        const cacheFk = valRefField.get(op.cache);
        if (cacheFk !== undefined) {
          const scopeFk = valRefField.get(op.scope);
          const scopeSlotVal = valRefSlot.get(op.scope);
          let scopeKey: string | undefined;
          let trackedSlot = -1;
          if (scopeFk !== undefined) {
            scopeKey = "f:" + scopeFk;
            trackedSlot = -1;
          } else if (valIsClosureEnv.has(op.scope)) {
            scopeKey = "env";
            trackedSlot = -1;
          } else if (scopeSlotVal !== undefined) {
            scopeKey = "s:" + String(scopeSlotVal);
            trackedSlot = scopeSlotVal;
          }
          if (scopeKey !== undefined) {
            const defId = defs.length;
            const selfMiss = loadSelfMiss.get(op.id);
            defs.push({
              id: defId,
              kind: "global-cell",
              blockId: bid,
              opIndex: idx,
              propOp: undefined,
              globalOp: op,
              objSlot: trackedSlot,
              propKey: "",
              key: "g:" + scopeKey + ":" + cacheFk,
              selfMissBlock:
                selfMiss !== undefined && coldMissBlocks.has(selfMiss)
                  ? selfMiss
                  : undefined,
            });
            opToDef.set(op.id, defId);
          }
        }
      } else if (op.kind === "property-store") {
        const fk = valRefField.get(op.site);
        const propKey = lookupPropSiteName(fk);
        if (propKey !== undefined) storeOpKey.set(op.id, propKey);
      }
    }
    const term = blk.terminator;
    if (
      (term.kind === "record" ||
        term.kind === "record-cell" ||
        term.kind === "cell") &&
      term.operation === "read"
    )
      written.add(term.slot);
    blockWrittenSlots.set(bid, written);
  }
  if (defs.length < 2) return { fn, visited, rewritten: 0 };

  // Forward meet-over-paths dataflow over `rpo`.
  const inState = new Map<number, Map<string, number>>();
  const outState = new Map<number, Map<string, number>>();
  function cloneState(src: Map<string, number>): Map<string, number> {
    const copy = new Map<string, number>();
    for (const [k, v] of src) copy.set(k, v);
    return copy;
  }
  function mapsEqual(
    a: Map<string, number> | undefined,
    b: Map<string, number>,
  ): boolean {
    if (a === undefined || a.size !== b.size) return false;
    for (const [k, v] of a) if (b.get(k) !== v) return false;
    return true;
  }
  function stepBlock(
    bid: number,
    entry: Map<string, number>,
  ): Map<string, number> | undefined {
    const state = cloneState(entry);
    const blk = fn.blocks[bid];
    if (blk === undefined) return state;
    for (const op of blk.instructions) {
      if (op === undefined) continue;
      if (++visited > budget) return undefined;
      if (op.kind === "property-load" || op.kind === "global-cell") {
        const defId = opToDef.get(op.id);
        if (defId !== undefined) {
          const def = defs[defId];
          if (def !== undefined && !state.has(def.key))
            state.set(def.key, defId);
        }
      } else if (op.kind === "store") {
        for (const [k, d] of state) {
          const def = defs[d];
          if (
            def === undefined ||
            (def.objSlot >= 0 && def.objSlot === op.slot)
          )
            state.delete(k);
        }
      } else if (op.kind === "property-store") {
        const sk = storeOpKey.get(op.id);
        for (const [k, d] of state) {
          const def = defs[d];
          if (def === undefined) {
            state.delete(k);
          } else if (
            def.kind === "property-load" &&
            storeConflictsWithLoad(sk, def.propKey)
          ) {
            state.delete(k);
          }
        }
      } else if (mayHardInvalidate(op)) {
        if (effectBudgetExhausted) return undefined;
        state.clear();
      }
    }
    const term = blk.terminator;
    if (term.kind === "record" || term.kind === "record-cell") {
      if (term.operation !== "read" && watchedRecords.has(term.record))
        state.clear();
      else if (term.operation === "read") {
        for (const [k, d] of state) {
          const def = defs[d];
          if (
            def === undefined ||
            (def.objSlot >= 0 && def.objSlot === term.slot)
          )
            state.delete(k);
        }
      }
    } else if (term.kind === "cell" && term.operation === "read") {
      for (const [k, d] of state) {
        const def = defs[d];
        if (
          def === undefined ||
          (def.objSlot >= 0 && def.objSlot === term.slot)
        )
          state.delete(k);
      }
    }
    return state;
  }

  let changed = true;
  let iterations = 0;
  const maxIterations = Math.max(8, rpo.length * 4);
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    for (const bid of rpo) {
      let merged: Map<string, number>;
      if (bid === fn.entry || exceptionTargets.has(bid)) {
        merged = new Map<string, number>();
      } else {
        const ps = preds[bid];
        const normalPreds: number[] = [];
        const coldPreds: number[] = [];
        if (ps !== undefined) {
          for (const p of ps) {
            if (p === undefined || !outState.has(p)) continue;
            if (coldMissBlocks.has(p)) coldPreds.push(p);
            else normalPreds.push(p);
          }
        }
        merged = new Map<string, number>();
        if (normalPreds.length === 0) {
          const firstCold = coldPreds[0];
          const firstOut =
            firstCold === undefined ? undefined : outState.get(firstCold);
          if (firstOut !== undefined) {
            for (const [k, d] of firstOut) {
              let allMatch = true;
              for (let j = 1; j < coldPreds.length; j++) {
                const cp = coldPreds[j];
                const cpOut = cp === undefined ? undefined : outState.get(cp);
                if (cpOut === undefined || cpOut.get(k) !== d) {
                  allMatch = false;
                  break;
                }
              }
              if (allMatch) merged.set(k, d);
            }
          }
        } else {
          const firstNorm = normalPreds[0];
          const firstOut =
            firstNorm === undefined ? undefined : outState.get(firstNorm);
          if (firstOut !== undefined) {
            for (const [k, d] of firstOut) {
              let allNormal = true;
              for (let j = 1; j < normalPreds.length; j++) {
                const np = normalPreds[j];
                const npOut = np === undefined ? undefined : outState.get(np);
                if (npOut === undefined || npOut.get(k) !== d) {
                  allNormal = false;
                  break;
                }
              }
              if (!allNormal) continue;
              const def = defs[d];
              if (def === undefined) continue;
              let coldSafe = true;
              for (const cp of coldPreds) {
                const cpOut = outState.get(cp);
                if (cpOut !== undefined && cpOut.get(k) === d) continue;
                const cpWritten = blockWrittenSlots.get(cp);
                if (
                  def.blockId === cp ||
                  !dominates(def.blockId, cp) ||
                  (def.objSlot >= 0 && cpWritten?.has(def.objSlot) === true)
                ) {
                  coldSafe = false;
                  break;
                }
              }
              if (coldSafe) merged.set(k, d);
            }
          }
        }
      }
      inState.set(bid, merged);
      const nextOut = stepBlock(bid, merged);
      if (nextOut === undefined) return undefined;
      if (!mapsEqual(outState.get(bid), nextOut)) {
        outState.set(bid, nextOut);
        changed = true;
      }
    }
  }
  if (changed) return { fn, visited, rewritten: 0 };

  // Collect dominated redundant `property-load` and `global-cell` uses.
  const useToDef = new Map<number, number>();
  const activeDefs = new Set<number>();
  for (const bid of rpo) {
    const entry = inState.get(bid);
    const blk = fn.blocks[bid];
    if (entry === undefined || blk === undefined) continue;
    const state = cloneState(entry);
    for (let idx = 0; idx < blk.instructions.length; idx++) {
      const op = blk.instructions[idx];
      if (op === undefined) continue;
      if (op.kind === "property-load" || op.kind === "global-cell") {
        const defId = opToDef.get(op.id);
        if (defId !== undefined) {
          const def = defs[defId];
          if (def === undefined) continue;
          const existing = state.get(def.key);
          if (existing !== undefined) {
            const prod = defs[existing];
            if (
              prod !== undefined &&
              dominates(prod.blockId, bid) &&
              (prod.blockId !== bid || prod.opIndex < idx)
            ) {
              useToDef.set(op.id, existing);
              activeDefs.add(existing);
            }
          } else {
            state.set(def.key, defId);
          }
        }
      } else if (op.kind === "store") {
        for (const [k, d] of state) {
          const def = defs[d];
          if (
            def === undefined ||
            (def.objSlot >= 0 && def.objSlot === op.slot)
          )
            state.delete(k);
        }
      } else if (op.kind === "property-store") {
        const sk = storeOpKey.get(op.id);
        for (const [k, d] of state) {
          const def = defs[d];
          if (def === undefined) {
            state.delete(k);
          } else if (
            def.kind === "property-load" &&
            storeConflictsWithLoad(sk, def.propKey)
          ) {
            state.delete(k);
          }
        }
      } else if (mayHardInvalidate(op)) {
        state.clear();
      }
    }
  }
  if (useToDef.size === 0) return { fn, visited, rewritten: 0 };

  // Collect cold miss blocks that must refresh an active producer's probe slot.
  const refreshInColdBlock = new Map<number, Set<number>>();
  const needsSiteSlot = new Set<number>();
  for (const bid of rpo) {
    if (bid === fn.entry || exceptionTargets.has(bid)) continue;
    const entry = inState.get(bid);
    const ps = preds[bid];
    if (entry === undefined || entry.size === 0 || ps === undefined) continue;
    for (const cp of ps) {
      if (cp === undefined || !coldMissBlocks.has(cp)) continue;
      const cpOut = outState.get(cp);
      if (cpOut === undefined) continue;
      for (const [k, defId] of entry) {
        if (!activeDefs.has(defId)) continue;
        if (cpOut.get(k) === defId) continue;
        const def = defs[defId];
        if (def === undefined || cp === def.selfMissBlock) continue;
        let list = refreshInColdBlock.get(cp);
        if (list === undefined) {
          list = new Set<number>();
          refreshInColdBlock.set(cp, list);
        }
        list.add(defId);
        needsSiteSlot.add(defId);
      }
    }
  }

  // Allocate probe slots (and site/scope slots only when cold refreshes exist).
  const slots = fn.slots.slice();
  const probeSlots = new Map<number, number>();
  const siteSlots = new Map<number, number>();
  const scopeSlots = new Map<number, number>();
  const defsByBlock = new Map<number, PropDef[]>();
  for (const defId of activeDefs) {
    const def = defs[defId];
    if (def === undefined) continue;
    const probe = slots.length;
    slots.push(def.kind === "global-cell" ? "optional-reference" : "general");
    probeSlots.set(defId, probe);
    if (needsSiteSlot.has(defId)) {
      const site = slots.length;
      slots.push("reference");
      siteSlots.set(defId, site);
      if (def.kind === "global-cell") {
        const sc = slots.length;
        slots.push("reference");
        scopeSlots.set(defId, sc);
      }
    }
    let list = defsByBlock.get(def.blockId);
    if (list === undefined) {
      list = [];
      defsByBlock.set(def.blockId, list);
    }
    list.push(def);
  }

  const newBlocks: Block[] = [];
  let rewritten = 0;
  for (const blk of fn.blocks) {
    if (blk === undefined) throw "property cse block invariant";
    const blockDefs = defsByBlock.get(blk.id);
    const refreshes = refreshInColdBlock.get(blk.id);
    let blockChanged = blockDefs !== undefined || refreshes !== undefined;
    const instructions: Instruction[] = [];
    for (let idx = 0; idx < blk.instructions.length; idx++) {
      const op = blk.instructions[idx];
      if (op === undefined) continue;
      if (op.kind === "property-load" || op.kind === "global-cell") {
        const prodId = useToDef.get(op.id);
        const probe = prodId === undefined ? undefined : probeSlots.get(prodId);
        if (probe !== undefined) {
          instructions.push({
            kind: "load",
            id: op.id,
            slot: probe,
            start: op.start,
            end: op.end,
            ...(op.inline === undefined ? {} : { inline: op.inline }),
          });
          rewritten++;
          blockChanged = true;
          continue;
        }
      }
      instructions.push(op);
      if (blockDefs !== undefined) {
        for (const def of blockDefs) {
          if (def.opIndex !== idx) continue;
          const probe = probeSlots.get(def.id);
          if (probe === undefined) continue;
          const propOp = def.propOp;
          const globalOp = def.globalOp;
          if (def.kind === "property-load" && propOp !== undefined) {
            instructions.push({
              kind: "store",
              slot: probe,
              value: propOp.id,
              start: propOp.start,
              end: propOp.end,
            });
            const siteSlot = siteSlots.get(def.id);
            if (siteSlot !== undefined) {
              instructions.push({
                kind: "store",
                slot: siteSlot,
                value: propOp.site,
                start: propOp.start,
                end: propOp.end,
              });
            }
          } else if (def.kind === "global-cell" && globalOp !== undefined) {
            instructions.push({
              kind: "store",
              slot: probe,
              value: globalOp.id,
              start: globalOp.start,
              end: globalOp.end,
            });
            const siteSlot = siteSlots.get(def.id);
            const scopeSlot = scopeSlots.get(def.id);
            if (siteSlot !== undefined && scopeSlot !== undefined) {
              instructions.push({
                kind: "store",
                slot: scopeSlot,
                value: globalOp.scope,
                start: globalOp.start,
                end: globalOp.end,
              });
              instructions.push({
                kind: "store",
                slot: siteSlot,
                value: globalOp.cache,
                start: globalOp.start,
                end: globalOp.end,
              });
            }
          }
        }
      }
    }
    if (refreshes !== undefined) {
      for (const defId of refreshes) {
        const def = defs[defId];
        const probe = probeSlots.get(defId);
        const siteSlot = siteSlots.get(defId);
        if (def === undefined || probe === undefined || siteSlot === undefined)
          continue;
        const propTpl = def.propOp;
        const globalTpl = def.globalOp;
        if (def.kind === "property-load" && propTpl !== undefined) {
          const objVal = nextValue++;
          const siteVal = nextValue++;
          const propVal = nextValue++;
          instructions.push({
            kind: "load",
            id: objVal,
            slot: def.objSlot,
            start: blk.terminator.start,
            end: blk.terminator.end,
          });
          instructions.push({
            kind: "load",
            id: siteVal,
            slot: siteSlot,
            start: blk.terminator.start,
            end: blk.terminator.end,
          });
          const tpl = propTpl;
          instructions.push({
            kind: "property-load",
            id: propVal,
            object: objVal,
            site: siteVal,
            record: tpl.record,
            field: tpl.field,
            count: tpl.count,
            siteRecord: tpl.siteRecord,
            siteField: tpl.siteField,
            inherited: tpl.inherited,
            entries: tpl.entries,
            epochRecord: tpl.epochRecord,
            epochField: tpl.epochField,
            ...(tpl.spillRecord === undefined
              ? {}
              : { spillRecord: tpl.spillRecord }),
            ...(tpl.spillField === undefined
              ? {}
              : { spillField: tpl.spillField }),
            start: blk.terminator.start,
            end: blk.terminator.end,
          });
          instructions.push({
            kind: "store",
            slot: probe,
            value: propVal,
            start: blk.terminator.start,
            end: blk.terminator.end,
          });
        } else if (def.kind === "global-cell" && globalTpl !== undefined) {
          const scopeSlot = scopeSlots.get(defId);
          if (scopeSlot === undefined) continue;
          const scopeVal = nextValue++;
          const cacheVal = nextValue++;
          const cellVal = nextValue++;
          instructions.push({
            kind: "load",
            id: scopeVal,
            slot: scopeSlot,
            start: blk.terminator.start,
            end: blk.terminator.end,
          });
          instructions.push({
            kind: "load",
            id: cacheVal,
            slot: siteSlot,
            start: blk.terminator.start,
            end: blk.terminator.end,
          });
          const tpl = globalTpl;
          instructions.push({
            kind: "global-cell",
            id: cellVal,
            scope: scopeVal,
            cache: cacheVal,
            scopeRecord: tpl.scopeRecord,
            declarativeField: tpl.declarativeField,
            objectField: tpl.objectField,
            globalField: tpl.globalField,
            globalRecord: tpl.globalRecord,
            lexicalEpochField: tpl.lexicalEpochField,
            globalObjectField: tpl.globalObjectField,
            globalObjectRecord: tpl.globalObjectRecord,
            propertyEpochField: tpl.propertyEpochField,
            cacheRecord: tpl.cacheRecord,
            cacheGlobalField: tpl.cacheGlobalField,
            cacheLexicalEpochField: tpl.cacheLexicalEpochField,
            cacheObjectEpochField: tpl.cacheObjectEpochField,
            cacheCellField: tpl.cacheCellField,
            start: blk.terminator.start,
            end: blk.terminator.end,
          });
          instructions.push({
            kind: "store",
            slot: probe,
            value: cellVal,
            start: blk.terminator.start,
            end: blk.terminator.end,
          });
        }
      }
    }
    newBlocks.push(blockChanged ? { ...blk, instructions } : blk);
  }
  if (rewritten === 0) return { fn, visited, rewritten: 0 };
  const first = fn.blocks[fn.entry];
  remarks?.({
    pass: "forward-dominating-properties",
    outcome: "applied",
    function: fn.name,
    start: first?.terminator.start ?? 0,
    end: first?.terminator.end ?? 0,
    message: String(rewritten) + " redundant property/global loads forwarded",
  });
  return { fn: { ...fn, slots, blocks: newBlocks }, visited, rewritten };
}

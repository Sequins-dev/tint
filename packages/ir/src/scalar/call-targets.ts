import type {
  FunctionIR,
  Instruction,
  ModuleIR,
  ScalarType,
  Terminator,
} from "./model.ts";
import {
  instructionResult,
  visitInstructionOperands,
  visitTerminatorOperands,
} from "./operands.ts";
import { stableRecordLayouts } from "./record-facts.ts";

/** The functions each indirect call may reach, grouped into classes.
 * Interprocedural summaries give each class a node whose effects are the
 * union of its members' and make each indirect call depend on its class's
 * node (see indirectCallClass) instead of assuming it may do anything. */
export interface IndirectCallTargets {
  /** Per function ID: one more than the class of indirect calls using it
   * as their witness, or 0 when no address-taken function can match (the
   * call can only trap). */
  readonly witnessClass: Uint32Array;
  /** Parameter-only classes for calls that explicitly discard the result. */
  readonly discardWitnessClass: Uint32Array;
  /** Narrower classes of the analyzed module's `call-indirect`
   * instructions, by function and block ID (see indirectCallClass). */
  readonly siteClasses: readonly (
    readonly (readonly SiteClass[] | undefined)[] | undefined
  )[];
  /** Per class: the address-taken functions it may reach. */
  readonly classes: readonly (readonly number[])[];
  readonly visited: number;
}

/** The class of one analyzed `call-indirect` instruction (-1: it can only
 * trap). */
export interface SiteClass {
  readonly op: Instruction;
  readonly index: number;
}

type IndirectCall = Instruction & { readonly kind: "call-indirect" };

/** The class of a `call-indirect` instruction in block `block` of function
 * `fn`, or -1 when it can only trap. Instructions rebuilt or moved since
 * the analysis (identity is checked) fall back to their witness's class. */
export function indirectCallClass(
  targets: IndirectCallTargets,
  fn: number,
  block: number,
  op: IndirectCall,
): number {
  for (const site of targets.siteClasses[fn]?.[block] ?? []) {
    if (site === undefined) throw "call target site invariant";
    if (site.op === op) return site.index;
  }
  const classes =
    op.discardResult === true
      ? targets.discardWitnessClass
      : targets.witnessClass;
  return (classes[op.target] ?? 0) - 1;
}

/** Ordered parameter encodings shared by value-producing and void calls. */
function parameterKey(fn: FunctionIR): string {
  let key = "";
  for (const parameter of fn.parameters) {
    if (parameter === undefined) throw "call target parameter invariant";
    const type = fn.slots[parameter];
    if (type === undefined) throw "call target parameter invariant";
    key += "," + type;
  }
  return key;
}

/** Scalar types whose values may be function objects. */
function holdsFunctions(type: ScalarType | "void" | undefined): boolean {
  return (
    type === "reference" ||
    type === "optional-reference" ||
    type === "general" ||
    type === "primitive"
  );
}

/** Indirect-call targets of a verified module.
 *
 * With `closed` (the caller's explicit contract that the module is the whole
 * program: no foreign or later-compiled code supplies function values or
 * calls into it other than through exported functions, so a function value
 * is created only by this module's `function-new` and `function-address`)
 * and stable record layouts (no raw-memory capability forges function
 * objects or writes managed fields), an indirect call reaches only the
 * address-taken functions whose signature key matches its witness's and
 * whose values may flow to its callee operand (see functionFlows). A call
 * explicitly discarding the result matches only parameter encodings. A
 * function whose entry address is exposed may be paired with any signature
 * and value, so it joins every class, and calls keep their signature
 * classes.
 *
 * Without `closed`, one class holds every address-taken function and every
 * call maps to it: the reachable set that summaries relying on stable
 * record layouts alone already assume. Undefined when the walk exceeds the
 * budget. */
export function indirectCallTargets(
  module: ModuleIR,
  closed: boolean,
  budget: number,
): IndirectCallTargets | undefined {
  const count = module.functions.length,
    precise = closed && stableRecordLayouts(module),
    escaped = new Uint8Array(count),
    discarding = new Uint8Array(count),
    members: number[] = [],
    exposed: number[] = [];
  let visited = 0;
  for (const fn of module.functions) {
    if (fn === undefined) throw "call target function invariant";
    for (const block of fn.blocks) {
      if (block === undefined) throw "call target block invariant";
      visited += block.instructions.length;
      for (const op of block.instructions) {
        if (op === undefined) throw "call target instruction invariant";
        if (op.kind === "call-indirect" && op.discardResult === true)
          discarding[op.target] = 1;
        if (op.kind !== "function-new" && op.kind !== "function-address")
          continue;
        if (escaped[op.target] === 0) {
          escaped[op.target] = 1;
          members.push(op.target);
        }
        if (op.kind === "function-address" && op.part === "entry")
          exposed.push(op.target);
      }
    }
    if (visited > budget) return undefined;
  }
  const witnessClass = new Uint32Array(count),
    discardWitnessClass = new Uint32Array(count),
    siteClasses: ((SiteClass[] | undefined)[] | undefined)[] = [];
  if (!precise) {
    witnessClass.fill(1);
    discardWitnessClass.fill(1);
    return {
      witnessClass,
      discardWitnessClass,
      siteClasses,
      classes: [members],
      visited,
    };
  }
  // Classes by signature key, in first-member order; witnesses whose key no
  // address-taken function has get a class only when entries are exposed.
  const byKey = new Map<string, number>(),
    discardKeys = new Set<string>(),
    classes: number[][] = [];
  for (const fn of module.functions) {
    if (fn === undefined) throw "call target function invariant";
    if (discarding[fn.id] === 1) discardKeys.add(parameterKey(fn));
  }
  function add(key: string, id: number): void {
    let index = byKey.get(key);
    if (index === undefined) {
      index = classes.length;
      byKey.set(key, index);
      classes.push([]);
    }
    classes[index]?.push(id);
  }
  for (const id of members) {
    if (id === undefined) throw "call target member invariant";
    const fn = module.functions[id];
    if (fn === undefined) throw "call target member invariant";
    const parameters = parameterKey(fn);
    add(fn.returnType + parameters, id);
    if (discardKeys.has(parameters)) add("*" + parameters, id);
  }
  function witness(key: string): number {
    let index = byKey.get(key);
    if (index === undefined && exposed.length > 0) {
      index = classes.length;
      byKey.set(key, index);
      classes.push([]);
    }
    return index === undefined ? 0 : index + 1;
  }
  for (const fn of module.functions) {
    if (fn === undefined) throw "call target function invariant";
    visited += fn.parameters.length + 1;
    const parameters = parameterKey(fn);
    witnessClass[fn.id] = witness(fn.returnType + parameters);
    if (discarding[fn.id] === 1)
      discardWitnessClass[fn.id] = witness("*" + parameters);
  }
  if (exposed.length > 0)
    for (const reached of classes) {
      if (reached === undefined) throw "call target class invariant";
      for (const id of exposed) {
        if (id === undefined) throw "call target exposed invariant";
        if (!reached.includes(id)) reached.push(id);
      }
    }
  if (visited > budget) return undefined;
  // Exposed entries reach every call with any arguments: keep the
  // signature classes.
  if (exposed.length > 0)
    return { witnessClass, discardWitnessClass, siteClasses, classes, visited };
  const flows = functionFlows(
    module,
    members,
    classes,
    witnessClass,
    discardWitnessClass,
    budget - visited,
  );
  if (flows === undefined) return undefined;
  visited += flows.visited;
  // Each site's targets: the functions reaching its callee; equal target
  // sets share a class.
  const bySet = new Map<string, number>();
  for (const site of flows.sites) {
    if (site === undefined) throw "call target site invariant";
    const list = site.targets.slice();
    list.sort((a, b) => a - b);
    visited += list.length + 1;
    const key = list.join(",");
    const known = bySet.get(key),
      index = known ?? classes.length;
    if (list.length > 0 && known === undefined) {
      bySet.set(key, index);
      classes.push(list);
    }
    while (siteClasses.length <= site.fn) siteClasses.push(undefined);
    const blocks = siteClasses[site.fn] ?? [];
    siteClasses[site.fn] = blocks;
    while (blocks.length <= site.block) blocks.push(undefined);
    const entries = blocks[site.block] ?? [];
    blocks[site.block] = entries;
    entries.push({ op: site.op, index: list.length === 0 ? -1 : index });
  }
  if (visited > budget) return undefined;
  return { witnessClass, discardWitnessClass, siteClasses, classes, visited };
}

/** The address-taken functions reaching one indirect call. */
interface SiteTargets {
  readonly fn: number;
  readonly block: number;
  readonly op: IndirectCall;
  readonly targets: readonly number[];
}

/** An indirect call site in the flow graph. */
interface FlowSite {
  readonly fn: number;
  readonly block: number;
  readonly op: IndirectCall;
  /** Nodes whose functions may be the callee. */
  readonly callee: readonly number[];
  readonly arguments: readonly (readonly number[])[];
  readonly receiver: readonly number[];
  /** The node receiving the targets' results. */
  readonly result: number;
  /** Signature mask (address-taken function indexes). */
  readonly mask: Uint32Array | undefined;
  /** Targets connected so far, by address-taken index. */
  readonly connected: Set<number>;
}

/** Which address-taken functions may reach each indirect call's callee, by
 * a flow-insensitive, field-based inclusion analysis of function values
 * (verified, closed, layout-stable modules only). Nodes are slots, function
 * results, record fields (by layout and field: record accesses check the
 * exact descriptor), one node for every captured-variable cell (cells are
 * also reached through environment offsets), and a conservative node for
 * everything else that may hold a value (list vectors, weak slots, host
 * results, thrown values, environments, exported functions' inputs and
 * operations not modelled below): whatever enters it reaches every read of
 * it. SSA values are block-local, so each resolves to the nodes it was
 * read from. A call-indirect connects arguments and results to each target
 * of its signature as the target reaches its callee. */
function functionFlows(
  module: ModuleIR,
  members: readonly number[],
  classes: readonly (readonly number[])[],
  witnessClass: Uint32Array,
  discardWitnessClass: Uint32Array,
  budget: number,
):
  | { readonly sites: readonly SiteTargets[]; readonly visited: number }
  | undefined {
  const functions = module.functions,
    count = functions.length,
    words = (members.length + 31) >>> 5,
    // One more than each function's address-taken index, or 0.
    memberIndex = new Uint32Array(count);
  for (let index = 0; index < members.length; index++)
    memberIndex[members[index] ?? 0] = index + 1;
  // Node layout: the conservative node, the cell node, one token node per
  // address-taken function, then slots, results and record fields.
  const anywhere = 0,
    cells = 1,
    tokens = 2,
    slotBase = new Uint32Array(count),
    resultBase = tokens + members.length;
  let nodes = resultBase + count;
  for (const fn of functions) {
    if (fn === undefined) throw "call flow function invariant";
    slotBase[fn.id] = nodes;
    nodes += fn.slots.length;
  }
  const records = module.records ?? [],
    fieldBase: number[] = [];
  for (const record of records) {
    fieldBase.push(nodes);
    nodes += record?.fields.length ?? 0;
  }
  const out: (number[] | undefined)[] = [],
    sets: (Uint32Array | undefined)[] = [],
    watchers: (FlowSite[] | undefined)[] = [],
    sites: FlowSite[] = [],
    pending: number[] = [],
    queued: number[] = [];
  let visited = 0;
  const classMasks: (Uint32Array | undefined)[] = [];
  for (const reached of classes) {
    if (reached === undefined) throw "call flow class invariant";
    const mask = new Uint32Array(words);
    for (const id of reached) {
      if (id === undefined) throw "call flow class invariant";
      const index = (memberIndex[id] ?? 0) - 1;
      if (index >= 0)
        mask[index >>> 5] = (mask[index >>> 5] ?? 0) | (1 << (index & 31));
    }
    classMasks.push(mask);
  }
  function grow(node: number): void {
    while (out.length <= node) {
      out.push(undefined);
      sets.push(undefined);
      watchers.push(undefined);
      queued.push(0);
    }
  }
  grow(nodes - 1);
  function newNode(): number {
    const node = nodes++;
    grow(node);
    return node;
  }
  /** Merges `from`'s set into `to`'s, queueing `to` when it grew. */
  function merge(from: number, to: number): void {
    const source = sets[from];
    if (source === undefined) return;
    const target = sets[to] ?? new Uint32Array(words);
    sets[to] = target;
    let changed = false;
    for (let word = 0; word < words; word++) {
      const before = target[word] ?? 0,
        after = (before | (source[word] ?? 0)) >>> 0;
      if (after !== before) {
        target[word] = after;
        changed = true;
      }
    }
    visited += words;
    if (changed && queued[to] === 0) {
      queued[to] = 1;
      pending.push(to);
    }
  }
  function edge(from: number, to: number): void {
    if (from === to) return;
    let list = out[from];
    if (list === undefined) {
      list = [];
      out[from] = list;
    }
    list.push(to);
    visited++;
    merge(from, to);
  }
  function flow(from: readonly number[], to: number): void {
    for (const node of from) {
      if (node === undefined) throw "call flow node invariant";
      edge(node, to);
    }
  }
  for (let index = 0; index < members.length; index++) {
    const set = new Uint32Array(words);
    set[index >>> 5] = 1 << (index & 31);
    sets[tokens + index] = set;
  }
  const none: readonly number[] = [];
  const conservative: readonly number[] = [anywhere];
  for (const fn of functions) {
    if (fn === undefined) throw "call flow function invariant";
    if (visited > budget) return undefined;
    const slots = slotBase[fn.id] ?? 0;
    const slot = (index: number): number | undefined =>
      holdsFunctions(fn.slots[index]) ? slots + index : undefined;
    // Exported functions and exposed entries take inputs from outside.
    if (fn.exported) {
      for (const parameter of fn.parameters) {
        if (parameter === undefined) throw "call flow parameter invariant";
        const node = slot(parameter);
        if (node !== undefined) edge(anywhere, node);
      }
      const receiverSlot = fn.receiverSlot;
      if (receiverSlot !== undefined) {
        const node = slot(receiverSlot);
        if (node !== undefined) edge(anywhere, node);
      }
    }
    if (fn.import === true) {
      edge(anywhere, resultBase + fn.id);
      continue;
    }
    for (const block of fn.blocks) {
      if (block === undefined) throw "call flow block invariant";
      const values = new Map<number, readonly number[]>();
      const sources = (value: number): readonly number[] =>
        values.get(value) ?? none;
      const leak = (value: number): void => flow(sources(value), anywhere);
      const exception = block.exception;
      if (exception !== undefined) {
        const node = slot(exception.slot);
        if (node !== undefined) edge(anywhere, node);
      }
      for (const op of block.instructions) {
        if (op === undefined) throw "call flow instruction invariant";
        visited++;
        switch (op.kind) {
          case "load": {
            const node = slot(op.slot);
            if (node !== undefined) values.set(op.id, [node]);
            break;
          }
          case "store": {
            const node = slot(op.slot);
            if (node !== undefined) flow(sources(op.value), node);
            break;
          }
          case "function-new": {
            const index = (memberIndex[op.target] ?? 0) - 1;
            if (index < 0) throw "call flow member invariant";
            values.set(op.id, [tokens + index]);
            const environment = op.environment;
            if (environment !== undefined) leak(environment);
            break;
          }
          case "general-wrap":
          case "general-value":
          case "reference-wrap":
          case "reference-value":
          case "optional-wrap":
          case "optional-value":
          case "primitive-wrap":
          case "primitive-reference":
          case "string-reference":
          case "reference-string": {
            const from = sources(op.value);
            if (from.length > 0) values.set(op.id, from);
            break;
          }
          case "record-new": {
            const layout = records[op.record],
              base = fieldBase[op.record] ?? 0;
            for (let index = 0; index < op.arguments.length; index++) {
              const argument = op.arguments[index];
              if (
                argument !== undefined &&
                holdsFunctions(layout?.fields[index]?.type)
              )
                flow(sources(argument), base + index);
            }
            break;
          }
          case "record-read":
            if (holdsFunctions(records[op.record]?.fields[op.field]?.type))
              values.set(op.id, [(fieldBase[op.record] ?? 0) + op.field]);
            break;
          case "call": {
            const callee = functions[op.target];
            if (callee === undefined) throw "call flow callee invariant";
            const base = slotBase[callee.id] ?? 0;
            if (callee.import === true) {
              for (const argument of op.arguments) {
                if (argument === undefined)
                  throw "call flow argument invariant";
                leak(argument);
              }
              const receiver = op.receiver;
              if (receiver !== undefined) leak(receiver);
            } else {
              for (let index = 0; index < op.arguments.length; index++) {
                const parameter = callee.parameters[index],
                  argument = op.arguments[index];
                if (
                  parameter !== undefined &&
                  argument !== undefined &&
                  holdsFunctions(callee.slots[parameter])
                )
                  flow(sources(argument), base + parameter);
              }
              const receiver = op.receiver,
                receiverSlot = callee.receiverSlot;
              if (receiver !== undefined && receiverSlot !== undefined)
                flow(sources(receiver), base + receiverSlot);
            }
            const id = op.id;
            if (id !== undefined && holdsFunctions(callee.returnType))
              values.set(id, [resultBase + callee.id]);
            break;
          }
          case "call-indirect": {
            const receiver = op.receiver;
            const passed: (readonly number[])[] = [];
            for (const argument of op.arguments) {
              if (argument === undefined) throw "call flow argument invariant";
              passed.push(sources(argument));
            }
            const site: FlowSite = {
              fn: fn.id,
              block: block.id,
              op,
              callee: sources(op.callee),
              arguments: passed,
              receiver: receiver === undefined ? none : sources(receiver),
              result: newNode(),
              mask: classMasks[
                ((op.discardResult === true
                  ? discardWitnessClass
                  : witnessClass)[op.target] ?? 0) - 1
              ],
              connected: new Set<number>(),
            };
            sites.push(site);
            for (const node of site.callee) {
              if (node === undefined) throw "call flow node invariant";
              let list = watchers[node];
              if (list === undefined) {
                list = [];
                watchers[node] = list;
              }
              list.push(site);
            }
            const id = op.id;
            if (id !== undefined) values.set(id, [site.result]);
            break;
          }
          // Values whose results hold no function and that store no
          // operand anywhere.
          case "general-record-is":
          case "general-is":
          case "general-record-descriptor":
          case "function-address":
          case "record-descriptor-address":
          case "general-kind":
          case "general-equal":
          case "general-none":
          case "general-null":
          case "record-has":
          case "boolean-none":
          case "boolean-wrap":
          case "boolean-value":
          case "boolean-present":
          case "string-none":
          case "string-wrap":
          case "string-value":
          case "string-present":
          case "reference-none":
          case "string-literal":
          case "string-length":
          case "string-code-unit":
          case "string-starts-with":
          case "string-slice":
          case "string-from-code-units":
          case "string-concat":
          case "string-allocate":
          case "string-write":
          case "constant":
          case "error-is":
          case "array-subarray":
          case "reference-vector-new":
          case "reference-vector-length":
          case "reference-vector-is":
          case "reference-vector-copy":
          case "weak-slot-clear":
          case "array-new":
          case "array-length":
          case "array-buffer":
          case "array-byte-offset":
          case "array-byte-length":
          case "array-valid":
          case "array-read":
          case "array-element":
          case "array-copy":
          case "array-write":
          case "array-store":
          case "undefined":
          case "optional-present":
          case "optional-value-or":
          case "unary":
          case "binary":
            break;
          // Everything else stores its operands where any read may see
          // them, and reads its result from there.
          default: {
            visitInstructionOperands(op, leak);
            const id = instructionResult(op);
            if (id !== undefined) values.set(id, conservative);
          }
        }
      }
      terminator(fn, block.terminator, slot, sources, leak);
    }
  }
  function terminator(
    fn: FunctionIR,
    term: Terminator,
    slot: (index: number) => number | undefined,
    sources: (value: number) => readonly number[],
    leak: (value: number) => void,
  ): void {
    visited++;
    switch (term.kind) {
      case "record": {
        const node = slot(term.slot);
        if (
          node === undefined ||
          !holdsFunctions(records[term.record]?.fields[term.field]?.type)
        )
          break;
        const field = (fieldBase[term.record] ?? 0) + term.field;
        if (term.operation === "read") edge(field, node);
        else edge(node, field);
        break;
      }
      case "record-cell":
      case "cell": {
        const node = slot(term.slot);
        if (node === undefined) break;
        if (term.operation === "read") edge(cells, node);
        else edge(node, cells);
        break;
      }
      case "return":
        const value = term.value;
        if (value !== undefined) flow(sources(value), resultBase + fn.id);
        break;
      case "throw":
        leak(term.value);
        break;
      case "branch":
      case "jump":
      case "trap":
      case "throw-literal":
        break;
      default:
        visitTerminatorOperands(term, leak);
    }
  }
  /** Connects newly reached targets of a site. */
  function connect(site: FlowSite): void {
    const mask = site.mask;
    if (mask === undefined) return;
    for (const node of site.callee) {
      if (node === undefined) throw "call flow node invariant";
      const set = sets[node];
      if (set === undefined) continue;
      for (let word = 0; word < words; word++) {
        let bits = ((set[word] ?? 0) & (mask[word] ?? 0)) >>> 0;
        while (bits !== 0) {
          const bit = 31 - Math.clz32(bits);
          bits = (bits & ~(1 << bit)) >>> 0;
          const index = word * 32 + bit;
          if (site.connected.has(index)) continue;
          site.connected.add(index);
          const target = functions[members[index] ?? -1];
          if (target === undefined) throw "call flow target invariant";
          const base = slotBase[target.id] ?? 0;
          for (let at = 0; at < site.arguments.length; at++) {
            const parameter = target.parameters[at],
              from = site.arguments[at];
            if (
              parameter !== undefined &&
              from !== undefined &&
              holdsFunctions(target.slots[parameter])
            )
              flow(from, base + parameter);
          }
          const receiverSlot = target.receiverSlot;
          if (receiverSlot !== undefined)
            flow(site.receiver, base + receiverSlot);
          if (holdsFunctions(target.returnType))
            edge(resultBase + target.id, site.result);
        }
      }
      visited += words;
    }
  }
  for (const site of sites) {
    if (site === undefined) throw "call flow site invariant";
    connect(site);
  }
  // Propagate to a fixed point; sites connect targets as they arrive.
  while (pending.length > 0) {
    if (visited > budget) return undefined;
    const node = pending.pop();
    if (node === undefined) break;
    queued[node] = 0;
    for (const to of out[node] ?? none) {
      if (to === undefined) throw "call flow node invariant";
      merge(node, to);
    }
    for (const site of watchers[node] ?? []) {
      if (site === undefined) throw "call flow site invariant";
      connect(site);
    }
  }
  if (visited > budget) return undefined;
  const result: SiteTargets[] = [];
  for (const site of sites) {
    if (site === undefined) throw "call flow site invariant";
    const reached: number[] = [];
    for (const index of site.connected) {
      if (index === undefined) throw "call flow target invariant";
      const id = members[index];
      if (id !== undefined) reached.push(id);
    }
    result.push({
      fn: site.fn,
      block: site.block,
      op: site.op,
      targets: reached,
    });
  }
  return { sites: result, visited };
}

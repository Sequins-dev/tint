import {
  referencedFunction,
  remapReferencedFunction,
} from "../scalar/function-references.ts";
import type {
  ModuleIR,
  FunctionIR,
  Instruction,
  Block,
  ScalarType,
} from "../scalar/index.ts";
import {
  traceClosedModule,
  traceModuleReferences,
  type ClosedReachability,
} from "./reachability.ts";
import {
  referenceListHeader,
  listFunctionSignature,
} from "./reference-list-contract.ts";
import { buildReferenceListAccessors } from "./reference-list-access.ts";
import { buildReferenceListWrite } from "./reference-list-write.ts";
import { buildReferenceListResize } from "./reference-list-resize.ts";
export interface ReferenceListRuntime {
  readonly create: number;
  readonly read: number;
  readonly write: number;
  readonly push: number;
  readonly length: number;
  readonly has: number;
  readonly delete: number;
  readonly resize: number;
}
/** Source-proven equivalent instantiations; the optimizer also checks ABI and
 * record-layout identity before accepting an alias. */
export interface ReferenceListAlias {
  readonly function: number;
  readonly canonical: number;
}
export interface ReferenceListRewrite {
  readonly module: ModuleIR;
  readonly rewritten: number;
  readonly work: number;
}
function methods(b: ReferenceListRuntime): number[] {
  return [
    b.create,
    b.read,
    b.write,
    b.push,
    b.length,
    b.has,
    b.delete,
    b.resize,
  ];
}
/** The embedding explicitly authorizes the bundled SparseList semantics of these
 * bindings. ABI/layout equality alone is not semantic equivalence. This first
 * policy requires one private header and managed reference, string, boxed
 * primitive, or inline element encodings. Each keeps its own value-cell layout.
 * Every live header construction/root access/mutation must belong to a bound
 * method; length reads remain valid. Raw inspection and unrecognized aliases
 * decline the entire transform. Roots are actual closed-executable entries. */
export function lowerReferenceLists(
  module: ModuleIR,
  contracts: readonly ReferenceListRuntime[],
  roots: readonly number[],
  maxWork: number = 10000000,
  aliases: readonly ReferenceListAlias[] = [],
): ReferenceListRewrite | undefined {
  if (
    contracts.length === 0 ||
    roots.length === 0 ||
    !Number.isSafeInteger(maxWork) ||
    maxWork < 0
  )
    return undefined;
  const actual = traceClosedModule(module, roots, maxWork);
  if (actual === undefined) return undefined;
  let work = actual.work;
  const bindings: ReferenceListRuntime[] = [];
  for (const contract of contracts) {
    if (contract === undefined) throw "list contract invariant";
    let used = false;
    for (const id of methods(contract)) {
      if (id === undefined) throw "list method invariant";
      if (actual.functions[id] === 1) used = true;
    }
    if (used) bindings.push(contract);
  }
  if (bindings.length === 0) return undefined;
  const allowed = new Uint8Array(module.functions.length),
    creators = new Uint8Array(module.functions.length),
    proofRoots = roots.slice();
  let header = -1;
  const groups: ReferenceListRuntime[][] = [],
    elements: ScalarType[] = [];
  for (const binding of bindings) {
    if (binding === undefined) throw "list binding invariant";
    const writer = module.functions[binding.write],
      valueSlot = writer?.parameters[2];
    const element =
      valueSlot === undefined ? undefined : writer?.slots[valueSlot];
    if (
      element !== "optional-reference" &&
      element !== "optional-string" &&
      element !== "primitive" &&
      element !== "general" &&
      element !== "optional-boolean"
    )
      return undefined;
    let group = elements.indexOf(element);
    if (group < 0) {
      group = elements.length;
      elements.push(element);
      groups.push([]);
    }
    const members = groups[group];
    if (members === undefined) throw "list group invariant";
    members.push(binding);
    if (
      !listFunctionSignature(module, binding.create, ["number"], "reference") ||
      !listFunctionSignature(
        module,
        binding.read,
        ["reference", "number"],
        element,
      ) ||
      !listFunctionSignature(
        module,
        binding.write,
        ["reference", "number", element],
        "void",
      ) ||
      !listFunctionSignature(
        module,
        binding.push,
        ["reference", element],
        "number",
      ) ||
      !listFunctionSignature(module, binding.length, ["reference"], "number") ||
      !listFunctionSignature(
        module,
        binding.has,
        ["reference", "number"],
        "boolean",
      ) ||
      !listFunctionSignature(
        module,
        binding.delete,
        ["reference", "number"],
        "boolean",
      ) ||
      !listFunctionSignature(
        module,
        binding.resize,
        ["reference", "number"],
        "void",
      )
    )
      return undefined;
    for (const id of methods(binding)) {
      if (id === undefined) throw "list method invariant";
      allowed[id] = 1;
      proofRoots.push(id);
    }
    creators[binding.create] = 1;
    const create = module.functions[binding.create];
    if (create === undefined) throw "list create invariant";
    let found = -1;
    for (const block of create.blocks) {
      if (block === undefined) throw "list block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "list instruction invariant";
        if (++work > maxWork) return undefined;
        if (
          op.kind === "record-new" &&
          referenceListHeader(module, op.record)
        ) {
          if (found >= 0 && found !== op.record) return undefined;
          found = op.record;
        }
      }
    }
    if (found < 0 || (header >= 0 && header !== found)) return undefined;
    header = found;
  }
  const acceptedAliases: ReferenceListAlias[] = [];
  const layoutCache: (ClosedReachability | undefined)[] = [];
  function transitiveLayouts(id: number): ClosedReachability | undefined {
    const cached = layoutCache[id];
    if (cached !== undefined) return cached;
    const reached = traceModuleReferences(module, [id], maxWork - work);
    if (reached === undefined) return undefined;
    work += reached.work;
    layoutCache[id] = reached;
    return reached;
  }
  for (const alias of aliases) {
    if (alias === undefined) throw "list alias invariant";
    if (allowed[alias.canonical] !== 1) continue;
    const original = module.functions[alias.canonical],
      candidate = module.functions[alias.function];
    if (original === undefined || candidate === undefined) continue;
    const parameters = original.parameters.map((p): ScalarType => {
      const type = original.slots[p];
      if (type === undefined) throw "list alias parameter invariant";
      return type;
    });
    if (
      !listFunctionSignature(
        module,
        alias.function,
        parameters,
        original.returnType,
      )
    )
      continue;
    // Equal direct layouts are insufficient: hasList, for example, delegates
    // node access to findEntry. Compare the entire reachable layout set.
    const left = transitiveLayouts(alias.canonical),
      right = transitiveLayouts(alias.function);
    if (left === undefined || right === undefined) return undefined;
    let equal = left.recordIds.length === right.recordIds.length;
    for (const id of left.recordIds) {
      if (++work > maxWork) return undefined;
      if (id === undefined) throw "list layout invariant";
      if (right.records[id] !== 1) equal = false;
    }
    if (!equal) continue;
    allowed[alias.function] = 1;
    creators[alias.function] = creators[alias.canonical] ?? 0;
    proofRoots.push(alias.function);
    acceptedAliases.push(alias);
  }
  const reachable = traceClosedModule(module, proofRoots, maxWork - work);
  if (reachable === undefined) return undefined;
  work += reachable.work;
  for (const fn of module.functions) {
    if (fn === undefined) throw "list function invariant";
    if (reachable.functions[fn.id] !== 1) continue;
    for (const block of fn.blocks) {
      if (block === undefined) throw "list block invariant";
      for (const op of block.instructions) {
        if (op === undefined) throw "list instruction invariant";
        if (++work > maxWork) return undefined;
        if (
          op.kind === "host-call" &&
          (op.operation === "memory-read-word" || op.operation === "root-head")
        )
          return undefined;
        if (
          op.kind === "record-new" &&
          op.record === header &&
          creators[fn.id] !== 1
        )
          return undefined;
      }
      const t = block.terminator;
      if (
        (t.kind === "record" || t.kind === "record-cell") &&
        t.record === header &&
        allowed[fn.id] !== 1 &&
        !(t.kind === "record" && t.operation === "read" && t.field === 0)
      )
        return undefined;
    }
  }
  const originalCount = module.functions.length;
  function remap(
    fn: FunctionIR,
    targets: Uint32Array,
    id: number,
  ): FunctionIR | undefined {
    let blocks: Block[] | undefined;
    for (let bi = 0; bi < fn.blocks.length; bi++) {
      const block = fn.blocks[bi];
      if (block === undefined) throw "list block invariant";
      let instructions: Instruction[] | undefined;
      for (let oi = 0; oi < block.instructions.length; oi++) {
        const op = block.instructions[oi];
        if (op === undefined) throw "list instruction invariant";
        if (++work > maxWork) return undefined;
        let rewritten = op;
        const reference = referencedFunction(op);
        if (reference !== undefined) {
          const target = targets[reference] ?? 0;
          if (target !== 0) rewritten = remapReferencedFunction(op, target - 1);
        }
        if (rewritten !== op && instructions === undefined)
          instructions = block.instructions.slice(0, oi);
        if (instructions !== undefined) instructions.push(rewritten);
      }
      const rewritten =
        instructions === undefined ? block : { ...block, instructions };
      if (rewritten !== block && blocks === undefined)
        blocks = fn.blocks.slice(0, bi);
      if (blocks !== undefined) blocks.push(rewritten);
    }
    return blocks === undefined && id === fn.id
      ? fn
      : { ...fn, id, blocks: blocks === undefined ? fn.blocks : blocks };
  }
  const functions: FunctionIR[] = module.functions.slice();
  const records = (module.records ?? []).slice();
  const current: ModuleIR = { functions, records };
  const targets = new Uint32Array(originalCount);
  let rewritten = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi],
      element = elements[gi],
      first = group?.[0];
    if (group === undefined || element === undefined || first === undefined)
      throw "list group invariant";
    const canonical = methods(first),
      base = functions.length;
    const cloneTargets = new Uint32Array(originalCount);
    for (let i = 0; i < canonical.length; i++) {
      const id = canonical[i];
      if (id === undefined) throw "list canonical invariant";
      cloneTargets[id] = base + i + 1;
    }
    for (let i = 0; i < canonical.length; i++) {
      const target = canonical[i],
        fn = target === undefined ? undefined : module.functions[target];
      if (fn === undefined) throw "list clone invariant";
      const clone = remap(fn, cloneTargets, base + i);
      if (clone === undefined) return undefined;
      functions.push({ ...clone, name: fn.name + ":sparse", exported: false });
    }
    const cell = records.length;
    records.push({
      byteLength: 32,
      fields: [{ offset: 16, type: element, mutable: true }],
    });
    const access = buildReferenceListAccessors(
      current,
      header,
      cell,
      {
        read: base + 1,
        has: base + 5,
        delete: base + 6,
      },
      element === "optional-reference",
    );
    if (access === undefined) return undefined;
    for (const fn of access.functions) {
      if (fn === undefined) throw "generated list function invariant";
      functions.push(fn);
    }
    const writer = buildReferenceListWrite(
      current,
      header,
      cell,
      base,
      base + 2,
      element === "optional-reference",
    );
    if (writer === undefined) return undefined;
    functions.push(writer);
    const resizer = buildReferenceListResize(current, header, base + 7);
    if (resizer === undefined) return undefined;
    functions.push(resizer);
    for (const binding of group) {
      if (binding === undefined) throw "list binding invariant";
      targets[binding.create] = first.create + 1;
      targets[binding.push] = first.push + 1;
      targets[binding.length] = first.length + 1;
      targets[binding.read] = access.read + 1;
      targets[binding.write] = writer.id + 1;
      targets[binding.has] = access.has + 1;
      targets[binding.delete] = access.delete + 1;
      targets[binding.resize] = resizer.id + 1;
    }
  }
  for (const alias of acceptedAliases) {
    if (alias === undefined) throw "list alias invariant";
    targets[alias.function] = targets[alias.canonical] ?? 0;
  }
  for (let i = 0; i < originalCount; i++) {
    const fn = functions[i];
    if (fn === undefined) throw "list function invariant";
    const changed = remap(fn, targets, fn.id);
    if (changed === undefined) return undefined;
    functions[i] = changed;
    if ((targets[i] ?? 0) !== 0 && targets[i] !== i + 1) rewritten++;
  }
  return { module: current, rewritten, work };
}

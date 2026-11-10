// Static cost profile of a tint build: estimates where the executable spends
// its cycles without running it (docs/performance-analysis.md).
//
//   node tools/perf-estimate.ts [--source-root DIR] [--out PREFIX]
//
// Writes PREFIX.pb.gz (pprof: estimated cycles and executions per block,
// readable by pprofessor and `go tool pprof`), PREFIX.json (per-function
// detail) and PREFIX.txt (ranking). Defaults build the compiler itself.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { loadSourceGraph } from "@tint/typescript/modules";
import { buildMacOSProgram } from "@tint/compiler/build";
import {
  projectFiles,
  projectMappings,
  projectRoots,
  projectBuildRequest,
} from "@tint/compiler/cli";
import type { ModuleIR, FunctionIR } from "@tint/ir/scalar";
import type { NativeModule } from "@tint/codegen/aarch64/scalar";

// ---------------------------------------------------------------------------
// Instruction classes and the Apple Firestorm resource model.

export type InstructionClass =
  | "load"
  | "frame-load"
  | "store"
  | "frame-store"
  | "branch"
  | "call"
  | "fp"
  | "convert"
  | "multiply"
  | "divide"
  | "move"
  | "address"
  | "alu"
  | "trap";
export const instructionClasses: readonly InstructionClass[] = [
  "load",
  "frame-load",
  "store",
  "frame-store",
  "branch",
  "call",
  "fp",
  "convert",
  "multiply",
  "divide",
  "move",
  "address",
  "alu",
  "trap",
];
/** Coarse AArch64 classification by encoding group (enough for a resource
 * model; exact decoding is not needed). */
export function classify(word: number): InstructionClass {
  const w = word >>> 0;
  if ((w & 0xffe0001f) >>> 0 === 0xd4200000 || w >>> 16 === 0) return "trap";
  if ((w & 0xfc000000) >>> 0 === 0x94000000) return "call"; // bl
  if ((w & 0xfffffc1f) >>> 0 === 0xd63f0000) return "call"; // blr
  if ((w & 0x1c000000) >>> 0 === 0x14000000) return "branch";
  if ((w & 0x0a000000) >>> 0 === 0x08000000) {
    // Loads and stores; Rn = 31 addresses the frame (sp).
    const load = ((w >>> 22) & 1) === 1,
      frame = ((w >>> 5) & 31) === 31;
    return load
      ? frame
        ? "frame-load"
        : "load"
      : frame
        ? "frame-store"
        : "store";
  }
  if ((w & 0x5f20fc00) >>> 0 === 0x1e200000) return "convert";
  if ((w & 0x0e000000) >>> 0 === 0x0e000000) return "fp";
  if ((w & 0x7fe0f800) >>> 0 === 0x1ac00800) return "divide";
  if ((w & 0x1f000000) >>> 0 === 0x1b000000) return "multiply";
  if ((w & 0x1f800000) >>> 0 === 0x12800000) return "move"; // movz/movk/movn
  if ((w & 0x1f000000) >>> 0 === 0x10000000) return "address"; // adr/adrp
  return "alu";
}
export interface BlockCost {
  readonly cycles: number;
  readonly counts: Record<InstructionClass, number>;
}
/** Cycles per execution of a straight-line block on Firestorm: the tightest
 * resource bound (8-wide rename, 6 integer, 3 load-capable and 2
 * store-capable units, 4 FP/SIMD units, 2 multipliers, 1 taken branch per
 * cycle) plus latency penalties the bounds miss: a frame store reloaded in
 * the same block waits on store-to-load forwarding (about 4c on the
 * dependency chain), and each int/FP conversion sits on one (about 3c).
 * Traps never execute. Calls cost their bl/ret here; callees are counted
 * separately. */
export function blockCost(words: ArrayLike<number>): BlockCost {
  const counts = Object.fromEntries(
    instructionClasses.map((c) => [c, 0]),
  ) as Record<InstructionClass, number>;
  const stored = new Set<number>();
  let forwarded = 0;
  for (let i = 0; i < words.length; i++) {
    const w = (words[i] ?? 0) >>> 0,
      kind = classify(w);
    counts[kind]++;
    // Unsigned-offset frame accesses: the scaled imm12 identifies the slot.
    const slot = (w >>> 10) & 0xfff;
    if (kind === "frame-store") stored.add(slot);
    else if (kind === "frame-load" && stored.has(slot)) forwarded++;
  }
  const executed = words.length - counts.trap,
    loads = counts.load + counts["frame-load"],
    stores = counts.store + counts["frame-store"],
    integer =
      counts.alu + counts.move + counts.address + counts.branch + counts.call,
    bound = Math.max(
      executed / 8,
      loads / 3,
      stores / 2,
      (loads + stores) / 4,
      integer / 6,
      (counts.fp + counts.convert) / 4,
      counts.multiply / 2,
      counts.divide * 7,
      (counts.branch + counts.call) / 2,
    );
  return {
    cycles: bound + forwarded * 4 + counts.convert * 3 + counts.call * 2,
    counts,
  };
}

// ---------------------------------------------------------------------------
// Static block frequencies (Wu–Larus-style branch probabilities).

/** Successor edges of an IR block with static probabilities. Edges into
 * traps, throws or blocks that only trap are almost never taken; loop back
 * edges are taken 88% of the time; other branches are even. */
function successors(
  fn: FunctionIR,
  index: number,
  backEdge: (from: number, to: number) => boolean,
  cold: Uint8Array,
): { target: number; probability: number }[] {
  const block = fn.blocks[index];
  if (block === undefined) return [];
  const t = block.terminator;
  const pairs: number[] = [];
  if (t.kind === "jump") return [{ target: t.target, probability: 1 }];
  if (
    t.kind === "branch" ||
    t.kind === "record" ||
    t.kind === "cell" ||
    t.kind === "record-cell"
  )
    pairs.push(t.consequent, t.alternate);
  if (pairs.length === 0) return [];
  const [a, b] = pairs as [number, number];
  if (a === b) return [{ target: a, probability: 1 }];
  const coldA = cold[a] === 1,
    coldB = cold[b] === 1;
  let pa = 0.5;
  if (coldA !== coldB) pa = coldA ? 0.001 : 0.999;
  else if (backEdge(index, a) !== backEdge(index, b))
    pa = backEdge(index, a) ? 0.88 : 0.12;
  return [
    { target: a, probability: pa },
    { target: b, probability: 1 - pa },
  ];
}
/** Relative execution counts of a function's blocks per call. */
export function blockFrequencies(fn: FunctionIR): Float64Array {
  const count = fn.blocks.length,
    frequency = new Float64Array(count);
  if (count === 0) return frequency;
  // Blocks that can only end in a trap or throw are cold.
  const cold = new Uint8Array(count);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < count; i++) {
      if (cold[i] === 1) continue;
      const t = fn.blocks[i]?.terminator;
      if (t === undefined) continue;
      let isCold = false;
      if (t.kind === "trap" || t.kind === "throw") isCold = true;
      else if (t.kind === "jump") isCold = cold[t.target] === 1;
      else if ("consequent" in t && "alternate" in t)
        isCold = cold[t.consequent] === 1 && cold[t.alternate] === 1;
      if (isCold) {
        cold[i] = 1;
        changed = true;
      }
    }
  }
  // Back edges from a depth-first search from the entry.
  const state = new Uint8Array(count),
    back = new Set<number>();
  const stack: { block: number; next: number }[] = [
    { block: fn.entry, next: 0 },
  ];
  state[fn.entry] = 1;
  const raw = (i: number): number[] => {
    const t = fn.blocks[i]?.terminator;
    if (t === undefined) return [];
    if (t.kind === "jump") return [t.target];
    if ("consequent" in t && "alternate" in t)
      return [t.consequent, t.alternate];
    return [];
  };
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const next = raw(top.block)[top.next++];
    if (next === undefined) {
      state[top.block] = 2;
      stack.pop();
      continue;
    }
    if (state[next] === 1) back.add(top.block * count + next);
    else if (state[next] === 0) {
      state[next] = 1;
      stack.push({ block: next, next: 0 });
    }
  }
  const backEdge = (from: number, to: number): boolean =>
    back.has(from * count + to);
  const edges = Array.from({ length: count }, (_, i) =>
    successors(fn, i, backEdge, cold),
  );
  // Fixed-point propagation; loops converge geometrically.
  for (let iteration = 0; iteration < 200; iteration++) {
    const next = new Float64Array(count);
    next[fn.entry] = 1;
    for (let i = 0; i < count; i++) {
      const f = frequency[i] ?? 0;
      if (f === 0) continue;
      for (const edge of edges[i] ?? [])
        next[edge.target] = (next[edge.target] ?? 0) + f * edge.probability;
    }
    let delta = 0;
    for (let i = 0; i < count; i++) {
      next[i] = Math.min(next[i] ?? 0, 1e6);
      delta = Math.max(delta, Math.abs((next[i] ?? 0) - (frequency[i] ?? 0)));
    }
    frequency.set(next);
    if (delta < 1e-6) break;
  }
  return frequency;
}

// ---------------------------------------------------------------------------
// Whole-unit estimate.

export interface FunctionEstimate {
  readonly unit: string;
  readonly index: number;
  readonly name: string;
  /** Image code offset of the function entry. */
  readonly address: number;
  readonly calls: number;
  readonly cyclesPerCall: number;
  readonly cycles: number;
  readonly bytes: number;
  readonly counts: Record<InstructionClass, number>;
  readonly hotBlocks: readonly {
    readonly block: number;
    readonly offset: number;
    readonly frequency: number;
    readonly cycles: number;
  }[];
}
function signatureKey(fn: FunctionIR): string {
  return (
    fn.parameters.map((slot) => fn.slots[slot]).join(",") + "->" + fn.returnType
  );
}
export function estimateUnit(unit: {
  readonly name: string;
  readonly ir: ModuleIR;
  readonly native: NativeModule;
  readonly codeOffset: number;
  readonly symbols: readonly {
    readonly name: string;
    readonly offset: number;
  }[];
}): FunctionEstimate[] {
  const { ir, native } = unit,
    code = native.code,
    view = new DataView(code.buffer, code.byteOffset, code.byteLength);
  const names = new Map<number, string>();
  for (const symbol of unit.symbols) names.set(symbol.offset, symbol.name);
  const functions = ir.functions;
  const local: {
    frequencies: Float64Array;
    costs: BlockCost[];
    starts: number[];
  }[] = [];
  // Per-function block frequencies and costs.
  for (let index = 0; index < functions.length; index++) {
    const fn = functions[index]!,
      nf = native.functions[index],
      starts = native.blocks?.[index] ?? [];
    const costs: BlockCost[] = [],
      offsets: number[] = [];
    const ordered = starts
      .map((start, block) => ({ start, block }))
      .filter((s) => s.start >= 0)
      .sort((a, b) => a.start - b.start);
    const end = nf === undefined ? 0 : nf.offset + nf.byteLength;
    const span = new Map<number, [number, number]>();
    for (let k = 0; k < ordered.length; k++) {
      const s = ordered[k]!,
        stop = ordered[k + 1]?.start ?? end;
      span.set(s.block, [s.start, Math.max(s.start, stop)]);
    }
    for (let block = 0; block < fn.blocks.length; block++) {
      const range = span.get(block);
      const words: number[] = [];
      if (range !== undefined)
        for (let at = range[0]; at + 4 <= range[1]; at += 4)
          words.push(view.getUint32(at, true));
      costs.push(blockCost(words));
      offsets.push(range?.[0] ?? -1);
    }
    local.push({ frequencies: blockFrequencies(fn), costs, starts: offsets });
  }
  // Indirect call targets: function values created with the same signature.
  const bySignature = new Map<string, number[]>();
  for (const fn of functions)
    for (const block of fn.blocks)
      for (const op of block.instructions)
        if (op.kind === "function-new") {
          const target = functions[op.target];
          if (target === undefined) continue;
          const key = signatureKey(target);
          const list = bySignature.get(key) ?? [];
          if (!list.includes(op.target)) list.push(op.target);
          bySignature.set(key, list);
        }
  // Call edges weighted by call-site frequency per caller invocation.
  const edges: Map<number, number>[] = functions.map(() => new Map());
  for (let index = 0; index < functions.length; index++) {
    const fn = functions[index]!,
      frequencies = local[index]!.frequencies;
    fn.blocks.forEach((block, b) => {
      const f = frequencies[b] ?? 0;
      if (f === 0) return;
      for (const op of block.instructions) {
        if (op.kind === "call") {
          const m = edges[index]!;
          m.set(op.target, (m.get(op.target) ?? 0) + f);
        } else if (op.kind === "call-indirect") {
          const witness = functions[op.target];
          const targets =
            witness === undefined
              ? []
              : (bySignature.get(signatureKey(witness)) ?? []);
          for (const target of targets) {
            const m = edges[index]!;
            m.set(target, (m.get(target) ?? 0) + f / targets.length);
          }
        }
      }
    });
  }
  // Invocation counts: roots (functions nobody calls) run once; propagate
  // with a cap so recursion and loops of calls stay finite.
  const called = new Uint8Array(functions.length);
  for (const m of edges) for (const target of m.keys()) called[target] = 1;
  let calls = new Float64Array(functions.length);
  for (let i = 0; i < functions.length; i++) if (called[i] !== 1) calls[i] = 1;
  for (let iteration = 0; iteration < 60; iteration++) {
    const next = new Float64Array(functions.length);
    for (let i = 0; i < functions.length; i++) if (called[i] !== 1) next[i] = 1;
    for (let i = 0; i < functions.length; i++) {
      const c = calls[i] ?? 0;
      if (c === 0) continue;
      for (const [target, weight] of edges[i]!)
        next[target] = Math.min((next[target] ?? 0) + c * weight, 1e15);
    }
    calls = next;
  }
  const results: FunctionEstimate[] = [];
  for (let index = 0; index < functions.length; index++) {
    const fn = functions[index]!,
      nf = native.functions[index];
    if (nf === undefined || nf.import === true) continue;
    const { frequencies, costs, starts } = local[index]!;
    const counts = Object.fromEntries(
      instructionClasses.map((c) => [c, 0]),
    ) as Record<InstructionClass, number>;
    let perCall = 0;
    const blocks: FunctionEstimate["hotBlocks"][number][] = [];
    for (let b = 0; b < fn.blocks.length; b++) {
      const f = frequencies[b] ?? 0,
        cost = costs[b]!;
      perCall += f * cost.cycles;
      for (const c of instructionClasses)
        counts[c] += f * cost.counts[c] * (calls[index] ?? 0);
      blocks.push({
        block: b,
        offset: starts[b] ?? -1,
        frequency: f * (calls[index] ?? 0),
        cycles: f * cost.cycles * (calls[index] ?? 0),
      });
    }
    blocks.sort((x, y) => y.cycles - x.cycles);
    results.push({
      unit: unit.name,
      index,
      name: names.get(unit.codeOffset + nf.offset) ?? unit.name + ":" + fn.name,
      address: unit.codeOffset + nf.offset,
      calls: calls[index] ?? 0,
      cyclesPerCall: perCall,
      cycles: perCall * (calls[index] ?? 0),
      bytes: nf.byteLength,
      counts,
      hotBlocks: blocks.slice(0, 5),
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// pprof (profile.proto) output.

class ProtoWriter {
  private bytes: number[] = [];
  varint(value: number): void {
    let v = BigInt(Math.max(0, Math.round(value)));
    do {
      let byte = Number(v & 0x7fn);
      v >>= 7n;
      if (v !== 0n) byte |= 0x80;
      this.bytes.push(byte);
    } while (v !== 0n);
  }
  field(number: number, value: number): void {
    this.varint(number * 8);
    this.varint(value);
  }
  message(number: number, inner: ProtoWriter): void {
    this.varint(number * 8 + 2);
    this.varint(inner.bytes.length);
    for (const b of inner.bytes) this.bytes.push(b);
  }
  string(number: number, value: string): void {
    const encoded = new TextEncoder().encode(value);
    this.varint(number * 8 + 2);
    this.varint(encoded.length);
    for (const b of encoded) this.bytes.push(b);
  }
  packed(number: number, values: readonly number[]): void {
    const inner = new ProtoWriter();
    for (const v of values) inner.varint(v);
    this.message(number, inner);
  }
  finish(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}
/** Flat pprof profile: one location per function (address = image code
 * offset of its entry) with sample values [estimated cycles, estimated
 * calls]. Per-block detail lives in the JSON report. */
export function writePprof(estimates: readonly FunctionEstimate[]): Uint8Array {
  const strings: string[] = [""],
    stringIds = new Map<string, number>([["", 0]]);
  const id = (s: string): number => {
    let v = stringIds.get(s);
    if (v === undefined) {
      v = strings.length;
      strings.push(s);
      stringIds.set(s, v);
    }
    return v;
  };
  const profile = new ProtoWriter();
  for (const [type, unit] of [
    ["estimated-cycles", "cycles"],
    ["estimated-calls", "count"],
  ] as const) {
    const vt = new ProtoWriter();
    vt.field(1, id(type));
    vt.field(2, id(unit));
    profile.message(1, vt);
  }
  estimates.forEach((estimate, f) => {
    const functionId = f + 1;
    if (estimate.cycles > 0) {
      const sample = new ProtoWriter();
      sample.packed(1, [functionId]);
      sample.packed(2, [estimate.cycles, estimate.calls]);
      profile.message(2, sample);
    }
    const loc = new ProtoWriter();
    loc.field(1, functionId);
    loc.field(3, Math.max(0, estimate.address));
    const line = new ProtoWriter();
    line.field(1, functionId);
    loc.message(4, line);
    profile.message(4, loc);
    const fn = new ProtoWriter();
    fn.field(1, functionId);
    fn.field(2, id(estimate.name));
    fn.field(3, id(estimate.name));
    fn.field(4, id(estimate.unit));
    profile.message(5, fn);
  });
  for (const s of strings) profile.string(6, s);
  return gzipSync(profile.finish());
}

// ---------------------------------------------------------------------------
// CLI.

if (import.meta.url === `file://${process.argv[1]}`) {
  const rootFlag = process.argv.indexOf("--source-root"),
    outFlag = process.argv.indexOf("--out");
  const sourceRoot = resolve(
    rootFlag < 0 ? "." : (process.argv[rootFlag + 1] ?? "."),
  );
  const prefix = resolve(
    outFlag < 0
      ? ".tint-bootstrap/perf-estimate"
      : (process.argv[outFlag + 1] ?? ".tint-bootstrap/perf-estimate"),
  );
  const inputs = projectFiles().map((file) => ({
    ...file,
    bytes: new Uint8Array(readFileSync(resolve(sourceRoot, file.id))),
  }));
  const graph = loadSourceGraph(inputs, projectMappings(), projectRoots());
  if (!graph.ok) throw Error(JSON.stringify(graph.error));
  const estimates: FunctionEstimate[] = [];
  const built = buildMacOSProgram({
    ...projectBuildRequest(graph.value, () => {}),
    debugSymbols: true,
    debugDirectory: sourceRoot,
    onAnalysis: (unit) => {
      for (const e of estimateUnit(unit)) estimates.push(e);
    },
  });
  if (!built.ok) throw Error(JSON.stringify(built.error));
  estimates.sort((a, b) => b.cycles - a.cycles);
  const total = estimates.reduce((sum, e) => sum + e.cycles, 0);
  mkdirSync(dirname(prefix), { recursive: true });
  writeFileSync(prefix + ".pb.gz", writePprof(estimates));
  writeFileSync(
    prefix + ".json",
    JSON.stringify({ totalCycles: total, functions: estimates.slice(0, 2000) }),
  );
  const lines = [
    `estimated cycles: ${total.toExponential(3)} (static model; see docs/performance-analysis.md)`,
    "share   calls      cyc/call  function",
  ];
  for (const e of estimates.slice(0, 60))
    lines.push(
      `${((100 * e.cycles) / total).toFixed(2).padStart(5)}%  ${e.calls.toExponential(2).padStart(9)}  ${e.cyclesPerCall.toFixed(1).padStart(8)}  ${e.name}`,
    );
  writeFileSync(prefix + ".txt", lines.join("\n") + "\n");
  console.log(lines.slice(0, 32).join("\n"));
}

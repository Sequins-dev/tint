import type { Memory } from "./isa.ts";
import {
  allocationStateOffset,
  gpr,
  imm,
  label,
  mem,
  setBoolean,
  word,
  type Emit,
} from "./scalar/machine.ts";

export interface X64SignpostSite {
  readonly name: string;
  readonly interval: string;
  readonly alternate?: string;
  readonly parameter?: number;
  readonly metrics?: boolean;
  readonly force?: number;
}
export interface X64Probe {
  readonly provider: string;
  readonly name: string;
  readonly offset: number;
  readonly arguments: string;
}
interface ProbeEmission {
  readonly probe: (name: string, args: string) => void;
  readonly interval: (name: string, ending: boolean) => void;
  readonly emitStubs: () => void;
  readonly resolve: (labels: ReadonlyMap<string, number>) => X64Probe[];
}

export function createProbeEmission(
  emit: Emit,
  provider: string,
): ProbeEmission {
  const pending = new Map<
    string,
    {
      readonly label: string;
      readonly arguments: string;
    }
  >();
  function probe(name: string, args: string): void {
    const before = pending.get(name);
    const site = before?.label ?? "tint:probe:" + name;
    if (before === undefined)
      pending.set(name, { label: site, arguments: args });
    else if (before.arguments !== args) throw "x86-64 probe argument invariant";
    emit({ op: "call", target: label(site) });
  }
  return {
    probe,
    interval(name: string, ending: boolean): void {
      let stem = "";
      for (let i = 0; i < name.length; i++) {
        const char = name.charAt(i);
        stem += char === "." || char === "-" ? "_" : char;
      }
      probe(stem + (ending ? "__end" : "__begin"), "8@%rbp");
    },
    emitStubs(): void {
      for (const [, item] of pending) {
        if (item === undefined) throw "x86-64 probe invariant";
        emit({ op: "label", name: item.label });
        emit({ op: "nop" });
        emit({ op: "ret" });
      }
    },
    resolve(labels: ReadonlyMap<string, number>): X64Probe[] {
      const output: X64Probe[] = [];
      for (const [name, item] of pending) {
        if (item === undefined) throw "x86-64 probe invariant";
        const offset = labels.get(item.label);
        if (offset === undefined) throw "x86-64 probe boundary invariant";
        output.push({
          provider,
          name,
          offset,
          arguments: item.arguments,
        });
      }
      return output;
    },
  };
}

export const collectionMetricBytes = 24;
export const collectionProbeArguments = "8@%r8 8@%r9 8@%r10 8@%r11 8@%rbp";

/** Capture collection state before the nursery and old-prefix tops change. */
export function collectionBefore(
  emit: Emit,
  site: string,
  context: Memory<64>,
  metric: (offset: number) => Memory<64>,
  force: Memory<64> | undefined,
): void {
  const state = gpr(11);
  const nursery = gpr(9);
  const old = gpr(10);
  const limit = gpr(8);
  const major = site + ":major";
  const done = site + ":kind";
  emit({ op: "mov", dst: state, src: context });
  emit({ op: "mov", dst: state, src: mem(11, allocationStateOffset) });
  emit({ op: "mov", dst: word(9), src: { ...mem(11, 0), width: 32 } });
  emit({ op: "mov", dst: word(10), src: { ...mem(11, 12), width: 32 } });
  emit({ op: "mov", dst: word(8), src: { ...mem(11, 8), width: 32 } });
  emit({ op: "mov", dst: metric(0), src: nursery });
  emit({ op: "mov", dst: metric(8), src: old });
  if (force !== undefined) {
    emit({ op: "cmp", dst: force, src: imm(0) });
    emit({ op: "jcc", cc: "ne", target: label(major) });
  }
  emit({ op: "test", dst: nursery, src: nursery });
  emit({ op: "jcc", cc: "e", target: label(major) });
  emit({ op: "sub", dst: limit, src: old });
  emit({ op: "cmp", dst: nursery, src: limit });
  setBoolean(emit, "a", 8);
  emit({ op: "jmp", target: label(done) });
  emit({ op: "label", name: major });
  emit({ op: "mov", dst: word(8), src: imm(1) });
  emit({ op: "label", name: done });
  emit({ op: "mov", dst: metric(16), src: limit });
}

/** The end probe's four metrics in R8–R11. Preserve the managed result. */
export function collectionAfter(
  emit: Emit,
  context: Memory<64>,
  metric: (offset: number) => Memory<64>,
): void {
  const major = gpr(8);
  const copied = gpr(10);
  const old = gpr(11);
  emit({ op: "mov", dst: old, src: context });
  emit({ op: "mov", dst: old, src: mem(11, allocationStateOffset) });
  emit({ op: "mov", dst: word(11), src: { ...mem(11, 12), width: 32 } });
  emit({ op: "mov", dst: major, src: metric(16) });
  emit({ op: "mov", dst: gpr(9), src: metric(0) });
  emit({ op: "mov", dst: copied, src: old });
  emit({ op: "sub", dst: copied, src: metric(8) });
  emit({ op: "test", dst: major, src: major });
  emit({ op: "cmovcc", cc: "ne", dst: copied, src: old });
}

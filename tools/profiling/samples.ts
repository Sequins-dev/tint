// The format-neutral sample model shared by every profile writer (pprof,
// DevTools `.cpuprofile` and `.heapprofile`): samples with stacks of
// DWARF-symbolised locations, each holding its inlined lines, and the call
// tree those stacks form. CPU samples (pprofessor or backend stack
// sampling) and allocation samples (`__tint_allocation_sample`) both land
// here, so every source reaches every output format.

export interface SourceLine {
  readonly function: string;
  readonly file?: string | undefined;
  /** 1-based; 0 or absent when unknown. */
  readonly line?: number | undefined;
  /** 1-based; 0 or absent when unknown. */
  readonly column?: number | undefined;
  /** The function's first line (1-based), when the symboliser knows it. */
  readonly startLine?: number | undefined;
}
/** One machine frame: its address and the source lines at it, innermost
 * inlined callee first, the physical function last. */
export interface Location {
  readonly lines: readonly SourceLine[];
  readonly address?: number | undefined;
}
export interface Sample {
  /** Leaf first. */
  readonly stack: readonly Location[];
  /** One value per sample type. */
  readonly values: readonly number[];
  readonly labels?: Readonly<Record<string, string>> | undefined;
  readonly numLabels?: Readonly<Record<string, number>> | undefined;
}
export interface ValueType {
  readonly type: string;
  readonly unit: string;
}
export interface Mapping {
  readonly start: number;
  readonly limit: number;
  readonly offset: number;
  readonly file: string;
  readonly buildId: string;
}
export interface SampleProfile {
  readonly sampleTypes: readonly ValueType[];
  readonly samples: readonly Sample[];
  readonly periodType?: ValueType | undefined;
  readonly period?: number | undefined;
  readonly defaultSampleType?: string | undefined;
  readonly mapping?: Mapping | undefined;
  readonly mappings?: readonly Mapping[] | undefined;
  readonly comments?: readonly string[] | undefined;
  readonly timeNanos?: number | undefined;
  readonly durationNanos?: number | undefined;
}

/** A call-tree node: one function (by name and file) under its caller.
 * Inlined lines become their own nodes, as DevTools shows inlined frames. */
export interface CallTreeNode {
  readonly id: number;
  readonly function: string;
  readonly file: string | undefined;
  /** The function's first line when known, else the first line seen. */
  line: number;
  column: number;
  readonly children: CallTreeNode[];
  /** Summed sample values that end at this node, per sample type. */
  readonly self: number[];
  /** Samples ending here by source line (1-based). */
  readonly lines: Map<number, number>;
}

export interface CallTree {
  readonly root: CallTreeNode;
  /** For each sample, the node it ends at. */
  readonly leaves: readonly CallTreeNode[];
  readonly nodes: readonly CallTreeNode[];
}

/** Frames root first: each location's lines from the physical function
 * (last) to the innermost inlined callee (first). */
export function framesOf(sample: Sample): SourceLine[] {
  const frames: SourceLine[] = [];
  for (let at = sample.stack.length - 1; at >= 0; at--) {
    const lines = sample.stack[at]?.lines ?? [];
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index];
      if (line !== undefined) frames.push(line);
    }
  }
  return frames;
}

export function buildCallTree(
  profile: SampleProfile,
  rootName = "(root)",
): CallTree {
  const width = profile.sampleTypes.length;
  const nodes: CallTreeNode[] = [];
  const make = (
    name: string,
    file: string | undefined,
    line: number,
    column: number,
  ): CallTreeNode => {
    const node: CallTreeNode = {
      id: nodes.length + 1,
      function: name,
      file,
      line,
      column,
      children: [],
      self: new Array<number>(width).fill(0),
      lines: new Map(),
    };
    nodes.push(node);
    return node;
  };
  const root = make(rootName, undefined, 0, 0);
  const index = new Map<CallTreeNode, Map<string, CallTreeNode>>();
  const leaves: CallTreeNode[] = [];
  for (const sample of profile.samples) {
    let node = root;
    for (const frame of framesOf(sample)) {
      let children = index.get(node);
      if (children === undefined) {
        children = new Map();
        index.set(node, children);
      }
      const key = frame.function + "\0" + (frame.file ?? "");
      let child = children.get(key);
      if (child === undefined) {
        child = make(
          frame.function,
          frame.file,
          frame.startLine ?? frame.line ?? 0,
          frame.startLine === undefined ? (frame.column ?? 0) : 0,
        );
        children.set(key, child);
        node.children.push(child);
      } else if (
        frame.startLine === undefined &&
        (frame.line ?? 0) > 0 &&
        (child.line === 0 || (frame.line ?? 0) < child.line)
      ) {
        child.line = frame.line ?? 0;
        child.column = frame.column ?? 0;
      }
      node = child;
    }
    sample.values.forEach((value, at) => {
      node.self[at] = (node.self[at] ?? 0) + value;
    });
    const leafLine = sample.stack[0]?.lines[0]?.line ?? 0;
    if (leafLine > 0)
      node.lines.set(
        leafLine,
        (node.lines.get(leafLine) ?? 0) + (sample.values[0] ?? 1),
      );
    leaves.push(node);
  }
  return { root, leaves, nodes };
}

/** The index of a sample type by name, or `fallback`. */
export function sampleTypeIndex(
  profile: SampleProfile,
  names: readonly string[],
  fallback = 0,
): number {
  for (const name of names) {
    const index = profile.sampleTypes.findIndex((type) => type.type === name);
    if (index >= 0) return index;
  }
  return fallback;
}

/** Re-symbolises every location through `symbolise` (address → lines,
 * innermost first), keeping the original lines where it returns none. */
export function symbolised(
  profile: SampleProfile,
  symbolise: (address: number) => readonly SourceLine[] | undefined,
): SampleProfile {
  const cache = new Map<number, readonly SourceLine[] | undefined>();
  const lookup = (address: number): readonly SourceLine[] | undefined => {
    if (!cache.has(address)) cache.set(address, symbolise(address));
    return cache.get(address);
  };
  return {
    ...profile,
    samples: profile.samples.map((sample) => ({
      ...sample,
      stack: sample.stack.map((location) => {
        if (location.address === undefined || location.address === 0)
          return location;
        const lines = lookup(location.address);
        return lines === undefined || lines.length === 0
          ? location
          : { address: location.address, lines };
      }),
    })),
  };
}

/** Lines from JSON (LLDB writes null for unknown files) in model form. */
export function normaliseLines(
  raw: readonly {
    readonly function?: string | null;
    readonly file?: string | null;
    readonly line?: number | null;
    readonly column?: number | null;
    readonly startLine?: number | null;
  }[],
): SourceLine[] {
  return raw.map((line) => ({
    function: line.function ?? "?",
    file: line.file ?? undefined,
    line: line.line ?? 0,
    column: line.column ?? 0,
    startLine: line.startLine ?? undefined,
  }));
}

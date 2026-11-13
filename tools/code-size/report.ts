// Code size reports: emitted bytes per function (allocator, runtime and
// program modules) and the scalar IR size after each optimizer pass.
// Written by TINT_CODE_SIZE=1 builds as <output>.code-size.json; compare two
// reports with tools/code-size/compare.ts.
import type { ImageFunctionRange } from "@tint/compiler/build";

/** IR size (instructions + terminators) after one pass, with the functions
 * whose size it changed. */
export interface IRPassSize {
  readonly index: number;
  readonly pass: string;
  readonly instructions: number;
  readonly blocks: number;
  readonly functions: readonly {
    readonly name: string;
    readonly before: number;
    readonly after: number;
  }[];
}
export interface CodeSizeReport {
  readonly kind: "tint-code-size";
  readonly version: 1;
  /** Emitted bytes per module and in total. */
  readonly modules: Readonly<Record<string, number>>;
  readonly total: number;
  readonly functions: readonly {
    readonly module: string;
    readonly name: string;
    /** `module:function` source name, when known (program functions). */
    readonly source?: string;
    readonly offset: number;
    readonly bytes: number;
  }[];
  readonly ir?: {
    readonly input: { readonly instructions: number; readonly blocks: number };
    readonly passes: readonly IRPassSize[];
  };
}

export function codeSizeReport(
  functions: readonly ImageFunctionRange[],
  input: { readonly instructions: number; readonly blocks: number } | undefined,
  passes: readonly IRPassSize[],
  sourceName: (fn: ImageFunctionRange) => string | undefined = () => undefined,
): CodeSizeReport {
  const modules: Record<string, number> = {};
  let total = 0;
  for (const fn of functions) {
    modules[fn.module] = (modules[fn.module] ?? 0) + fn.byteLength;
    total += fn.byteLength;
  }
  return {
    kind: "tint-code-size",
    version: 1,
    modules,
    total,
    functions: functions
      .map((fn) => {
        const source = sourceName(fn);
        return {
          module: fn.module,
          name: fn.name,
          ...(source === undefined ? {} : { source }),
          offset: fn.offset,
          bytes: fn.byteLength,
        };
      })
      .sort(
        (a, b) =>
          b.bytes - a.bytes ||
          a.module.localeCompare(b.module) ||
          a.name.localeCompare(b.name),
      ),
    ...(input === undefined ? {} : { ir: { input, passes } }),
  };
}

function signed(value: number): string {
  return (value > 0 ? "+" : "") + value;
}
export function formatCodeSizeTable(
  report: CodeSizeReport,
  top: number = 20,
): string {
  const lines: string[] = [];
  lines.push(`code size: ${report.total} bytes`);
  for (const [module, bytes] of Object.entries(report.modules))
    lines.push(`  ${module.padEnd(10)}${String(bytes).padStart(12)}`);
  lines.push(`largest ${Math.min(top, report.functions.length)} functions:`);
  for (const fn of report.functions.slice(0, top))
    lines.push(
      `  ${String(fn.bytes).padStart(10)}  ${fn.module.padEnd(9)} ${fn.name}` +
        (fn.source === undefined ? "" : `  ${fn.source}`),
    );
  const ir = report.ir;
  if (ir !== undefined) {
    lines.push(
      `IR size by pass (instructions + terminators; input ${ir.input.instructions}):`,
    );
    let previous = ir.input.instructions;
    for (const pass of ir.passes) {
      const largest = [...pass.functions].sort(
        (a, b) =>
          Math.abs(b.after - b.before) - Math.abs(a.after - a.before) ||
          a.name.localeCompare(b.name),
      )[0];
      lines.push(
        `  ${String(pass.index).padStart(3)}  ${pass.pass.padEnd(26)}${String(pass.instructions).padStart(10)}${signed(pass.instructions - previous).padStart(9)}` +
          (largest === undefined
            ? ""
            : `  ${pass.functions.length} fn, largest ${signed(largest.after - largest.before)} ${largest.name}`),
      );
      previous = pass.instructions;
    }
  }
  return lines.join("\n") + "\n";
}

export interface CodeSizeDelta {
  readonly module: string;
  readonly name: string;
  readonly base: number;
  readonly head: number;
}
export interface CodeSizeComparison {
  readonly base: number;
  readonly head: number;
  readonly modules: readonly CodeSizeDelta[];
  /** Functions whose size changed, largest growth first. */
  readonly functions: readonly CodeSizeDelta[];
}
/** Generated instance suffixes (`name$123`) differ between unrelated builds;
 * unless `exact`, functions compare by their names without them, summing
 * the instances sharing a name. */
export function compareCodeSize(
  base: CodeSizeReport,
  head: CodeSizeReport,
  exact: boolean = false,
): CodeSizeComparison {
  const key = (module: string, name: string) =>
    module + "\0" + (exact ? name : name.replace(/\$\d+/g, ""));
  const sizes = new Map<string, { base: number; head: number }>();
  for (const [side, report] of [
    ["base", base],
    ["head", head],
  ] as const)
    for (const fn of report.functions) {
      const entry = sizes.get(key(fn.module, fn.name)) ?? { base: 0, head: 0 };
      entry[side] += fn.bytes;
      sizes.set(key(fn.module, fn.name), entry);
    }
  const functions: CodeSizeDelta[] = [];
  for (const [joined, entry] of sizes) {
    if (entry.base === entry.head) continue;
    const [module = "", name = ""] = joined.split("\0");
    functions.push({ module, name, ...entry });
  }
  functions.sort(
    (a, b) =>
      b.head - b.base - (a.head - a.base) || a.name.localeCompare(b.name),
  );
  const modules: CodeSizeDelta[] = [];
  for (const module of new Set([
    ...Object.keys(base.modules),
    ...Object.keys(head.modules),
  ]))
    modules.push({
      module,
      name: "",
      base: base.modules[module] ?? 0,
      head: head.modules[module] ?? 0,
    });
  return { base: base.total, head: head.total, modules, functions };
}
export function formatCodeSizeComparison(
  comparison: CodeSizeComparison,
  top: number = 20,
): string {
  const percent = (from: number, to: number) =>
    from === 0
      ? ""
      : ` (${signed(Number((((to - from) / from) * 100).toFixed(2)))}%)`;
  const lines = [
    `total ${comparison.base} -> ${comparison.head} bytes: ${signed(comparison.head - comparison.base)}${percent(comparison.base, comparison.head)}`,
  ];
  for (const module of comparison.modules)
    lines.push(
      `  ${module.module.padEnd(10)}${String(module.base).padStart(12)} -> ${String(module.head).padStart(12)}  ${signed(module.head - module.base)}`,
    );
  const grown = comparison.functions.filter((fn) => fn.head > fn.base),
    shrunk = comparison.functions.filter((fn) => fn.head < fn.base).reverse();
  for (const [title, list] of [
    ["grown", grown],
    ["shrunk", shrunk],
  ] as const) {
    lines.push(`${list.length} functions ${title}:`);
    for (const fn of list.slice(0, top))
      lines.push(
        `  ${signed(fn.head - fn.base).padStart(9)}  ${String(fn.base).padStart(8)} -> ${String(fn.head).padEnd(8)} ${fn.module.padEnd(9)} ${fn.name}`,
      );
  }
  return lines.join("\n") + "\n";
}

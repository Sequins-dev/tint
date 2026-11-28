import { nativeTargetNamed, type NativeTarget } from "@tint/platform/target";
import {
  defaultWorkerHeapMiB,
  maxWorkerHeapMiB,
  minWorkerHeapMiB,
} from "./parallel-policy.ts";

export const compilerUsage = `usage: tint-compiler <project-root> <output> [--debug-symbols] [--pass-stats] [--target <target>] [--workers <n>] [--spill-dir <dir>] [--worker-heap-mb <n>] [--memory-budget-mb <n>] [--worker-stats]
Build a native executable from a TypeScript project.
--pass-stats prints the program's optimizer passes and writes <output>.pass-stats.json on arm64 targets.
--target selects darwin-aarch64, linux-aarch64, or linux-x86_64 (default: the compiler's own host).
--workers enables opt-in prepared-fragment native worker emission (0 = serial, default: 0).
--spill-dir selects the directory for temporary packed IR and fragment spill files (default: output directory).
--worker-heap-mb caps each worker isolate's managed heap in MiB (default: 704).
--memory-budget-mb caps admitted worker lanes from measured coordinator residency plus worker and credit reserves.
--worker-stats reports parallel emission residency and admission checkpoints to stderr.`;

export interface CompilerArguments {
  readonly root: string;
  readonly output: string;
  readonly debugSymbols: boolean;
  readonly passStatistics: boolean;
  readonly target: NativeTarget;
  readonly workers: number;
  readonly spillDirectory: string | undefined;
  readonly workerHeapMiB: number;
  readonly memoryBudgetMiB: number | undefined;
  readonly workerStatistics: boolean;
}

function parseNonNegativeInteger(text: string): number | undefined {
  if (text.length === 0) return undefined;
  let value = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 48 || code > 57) return undefined;
    value = value * 10 + (code - 48);
    if (!Number.isSafeInteger(value)) return undefined;
  }
  return value;
}

/** Parse the compiler's arguments after the program name. `--target`
 * defaults to `hostTarget`, the target the compiler itself was built for, so
 * a native compiler reproduces itself on its own host. Each flag may appear
 * once; anything else is a usage error (undefined). */
export function parseCompilerArguments(
  args: readonly string[],
  hostTarget: NativeTarget,
): CompilerArguments | undefined {
  const root = args[0],
    output = args[1];
  if (root === undefined || output === undefined) return undefined;
  let debugSymbols = false,
    passStatistics = false,
    workerStatistics = false,
    target: NativeTarget | undefined,
    workers: number | undefined,
    spillDirectory: string | undefined,
    workerHeapMiB: number | undefined,
    memoryBudgetMiB: number | undefined;
  for (let index = 2; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--debug-symbols" && !debugSymbols) debugSymbols = true;
    else if (flag === "--pass-stats" && !passStatistics) passStatistics = true;
    else if (flag === "--worker-stats" && !workerStatistics)
      workerStatistics = true;
    else if (flag === "--target" && target === undefined) {
      index++;
      const name = args[index];
      if (name === undefined) return undefined;
      const named = nativeTargetNamed(name);
      if (named === undefined) return undefined;
      target = named;
    } else if (flag === "--workers" && workers === undefined) {
      index++;
      const text = args[index];
      if (text === undefined) return undefined;
      const parsed = parseNonNegativeInteger(text);
      if (parsed === undefined || parsed > 64) return undefined;
      workers = parsed;
    } else if (flag === "--spill-dir" && spillDirectory === undefined) {
      index++;
      const dir = args[index];
      if (dir === undefined || dir.length === 0) return undefined;
      spillDirectory = dir;
    } else if (flag === "--worker-heap-mb" && workerHeapMiB === undefined) {
      index++;
      const text = args[index];
      if (text === undefined) return undefined;
      const parsed = parseNonNegativeInteger(text);
      if (
        parsed === undefined ||
        parsed < minWorkerHeapMiB ||
        parsed > maxWorkerHeapMiB
      )
        return undefined;
      workerHeapMiB = parsed;
    } else if (flag === "--memory-budget-mb" && memoryBudgetMiB === undefined) {
      index++;
      const text = args[index];
      if (text === undefined) return undefined;
      const parsed = parseNonNegativeInteger(text);
      if (parsed === undefined || parsed < 128) return undefined;
      memoryBudgetMiB = parsed;
    } else return undefined;
  }
  return {
    root,
    output,
    debugSymbols,
    passStatistics,
    target: target ?? hostTarget,
    workers: workers ?? 0,
    spillDirectory,
    workerHeapMiB: workerHeapMiB ?? defaultWorkerHeapMiB,
    memoryBudgetMiB,
    workerStatistics,
  };
}

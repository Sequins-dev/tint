import { nativeTargetNamed, type NativeTarget } from "@tint/platform/target";

export const compilerUsage = `usage: tint-compiler <project-root> <output> [--debug-symbols] [--pass-stats] [--target <target>]
Build a native executable from a TypeScript project.
--pass-stats prints the program's optimizer passes and writes <output>.pass-stats.json.
--target selects darwin-aarch64 or linux-aarch64 (default: the compiler's own host).
The experimental linux-x86_64 target supports a bounded hosted subset. The compiler project requires collector and managed runtime support.`;

export interface CompilerArguments {
  readonly root: string;
  readonly output: string;
  readonly debugSymbols: boolean;
  readonly passStatistics: boolean;
  readonly target: NativeTarget;
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
    target: NativeTarget | undefined;
  for (let index = 2; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--debug-symbols" && !debugSymbols) debugSymbols = true;
    else if (flag === "--pass-stats" && !passStatistics) passStatistics = true;
    else if (flag === "--target" && target === undefined) {
      index++;
      const name = args[index];
      if (name === undefined) return undefined;
      const named = nativeTargetNamed(name);
      if (named === undefined) return undefined;
      target = named;
    } else return undefined;
  }
  return {
    root,
    output,
    debugSymbols,
    passStatistics,
    target: target ?? hostTarget,
  };
}

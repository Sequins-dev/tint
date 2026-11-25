import {
  darwinAArch64Target,
  linuxAArch64Target,
  nativeTargetNamed,
  linuxX86_64Target,
  type NativeTarget,
} from "@tint/platform/target";

/** The target matching the Node process's own host: linux-aarch64 on Linux,
 * linux-x86_64 on x64 Linux, and darwin-aarch64 on macOS. */
export function nodeHostTarget(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): NativeTarget {
  if (platform !== "linux") return darwinAArch64Target;
  return arch === "x64" ? linuxX86_64Target : linuxAArch64Target;
}

/** The target whose images native fixtures build, independent of the runner.
 * Defaults to this Node host; TINT_NATIVE_TARGET selects a cross-build. */
/** Whether general lowering gives compiled JavaScript functions native
 * script entries (direct register calls with activation records): the
 * default where the target's code generator implements the entry ABI
 * (aarch64). TINT_NATIVE_SCRIPT_CALLS=0 or 1 overrides it. Read per build. */
export function nativeScriptCallsEnabled(): boolean {
  const named = process.env.TINT_NATIVE_SCRIPT_CALLS;
  if (named === "0") return false;
  if (named === "1") return true;
  if (named !== undefined)
    throw Error("TINT_NATIVE_SCRIPT_CALLS must be 0 or 1: " + named);
  return nativeFixtureTarget().arch === "aarch64";
}
export function nativeFixtureTarget(): NativeTarget {
  const named = process.env.TINT_NATIVE_TARGET;
  if (named !== undefined) {
    const target = nativeTargetNamed(named);
    if (target === undefined)
      throw Error("unknown TINT_NATIVE_TARGET: " + named);
    return target;
  }
  return nodeHostTarget();
}

import {
  darwinAArch64Target,
  linuxAArch64Target,
  nativeTargetNamed,
  type AArch64Target,
} from "@tint/platform/target";
import { selectNativeBackend } from "@tint/compiler/native";

/** The target matching the Node process's own host: linux-aarch64 on Linux,
 * darwin-aarch64 otherwise. Node-run builds default to it. */
export function nodeHostTarget(
  platform: NodeJS.Platform = process.platform,
): AArch64Target {
  return platform === "linux" ? linuxAArch64Target : darwinAArch64Target;
}

/** The target whose images native fixtures build, independent of the runner.
 * Defaults to this Node host; TINT_NATIVE_TARGET selects a cross-build. */
export function nativeFixtureTarget(): AArch64Target {
  const named = process.env.TINT_NATIVE_TARGET;
  if (named !== undefined) {
    const target = nativeTargetNamed(named);
    if (target === undefined)
      throw Error("unknown TINT_NATIVE_TARGET: " + named);
    const backend = selectNativeBackend(target);
    if (!backend.ok)
      throw Error(backend.error.stage + ": " + backend.error.message);
    return backend.target;
  }
  return nodeHostTarget();
}

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

/** The target whose images native fixtures build and run: this host's
 * (darwin-aarch64 on macOS, linux-aarch64 on Linux), or TINT_NATIVE_TARGET
 * to build images for another host (they are then only runnable with
 * TINT_BUILD_ONLY=1). */
export function nativeFixtureTarget(): AArch64Target {
  const named = process.env.TINT_NATIVE_TARGET;
  if (named !== undefined) {
    const target = nativeTargetNamed(named);
    if (target === undefined)
      throw Error(
        "TINT_NATIVE_TARGET must be darwin-aarch64, linux-aarch64 or linux-x86_64: " +
          named,
      );
    const backend = selectNativeBackend(target);
    if (!backend.ok)
      throw Error(backend.error.stage + ": " + backend.error.message);
    return backend.target;
  }
  return nodeHostTarget();
}

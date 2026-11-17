import { nativeTargetOSDarwin, nativeTargetOSLinux } from "@tint/abi/host";
import { targetOperatingSystem } from "@tint/native-runtime/intrinsics/process";
import { createNativeFileHost as createDarwinFileHost } from "./darwin/fs.ts";
import { createNativeFileHost as createLinuxFileHost } from "./linux/fs.ts";
import type { FileHost } from "./files/service.ts";
import {
  darwinAArch64Target,
  linuxAArch64Target,
  type NativeTarget,
} from "./target.ts";

/** The target a native program was compiled for, which is the host it runs
 * on. Builds fix it through the `targetOperatingSystem` binding (the
 * `target-os` host operation); Node, which never runs a native image, has
 * no such fact and throws HOST_UNAVAILABLE. */
export function nativeHostTarget(): NativeTarget {
  const os = targetOperatingSystem();
  if (os === nativeTargetOSDarwin) return darwinAArch64Target;
  if (os === nativeTargetOSLinux) return linuxAArch64Target;
  throw "unknown native host target";
}

/** The native file host whose errno names and values match `target`. */
export function targetFileHost(target: NativeTarget): FileHost<number> {
  return target.os === "linux" ? createLinuxFileHost() : createDarwinFileHost();
}

import {
  nativeTargetArchX86_64,
  nativeTargetOSDarwin,
  nativeTargetOSLinux,
} from "@tint/abi/host";
import {
  targetArchitecture,
  targetOperatingSystem,
} from "@tint/native-runtime/intrinsics/process";
import { createNativeFileHost as createDarwinFileHost } from "./darwin/fs.ts";
import { createNativeFileHost as createLinuxFileHost } from "./linux/fs.ts";
import type { FileHost } from "./files/service.ts";
import {
  darwinAArch64Target,
  linuxAArch64Target,
  linuxX86_64Target,
  type NativeTarget,
} from "./target.ts";

/** The target a native program was compiled for, which is the host it runs
 * on. The OS and architecture intrinsics are fixed by code generation. */
export function nativeHostTarget(): NativeTarget {
  const os = targetOperatingSystem();
  if (os === nativeTargetOSDarwin) return darwinAArch64Target;
  if (os === nativeTargetOSLinux)
    return targetArchitecture() === nativeTargetArchX86_64
      ? linuxX86_64Target
      : linuxAArch64Target;
  throw "unknown native host target";
}

/** The native file host whose errno names and values match `target`. */
export function targetFileHost(target: NativeTarget): FileHost<number> {
  return target.os === "linux" ? createLinuxFileHost() : createDarwinFileHost();
}

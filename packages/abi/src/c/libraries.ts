import type { CTarget } from "./types.ts";
/** How one target loads a C library (docs/native-ffi.md, "Libraries"):
 * Darwin images name an install name in an LC_LOAD_DYLIB command (or
 * LC_LOAD_WEAK_DYLIB when `optional`, whose imports are then weak and read
 * as zero when absent); Linux images will name a DT_NEEDED soname. Versions
 * are Mach-O `xxxx.yy.zz` words (compatibility is checked by dyld). */
export interface CLibraryImage {
  /** Darwin install name or Linux soname. */
  readonly name: string;
  readonly optional: boolean;
  readonly currentVersion: number;
  readonly compatibilityVersion: number;
}
/** One `tint:c/<library>` binding module and how each target loads it. A
 * target without an entry cannot use the library. */
export interface CLibraryManifestEntry {
  readonly module: string;
  readonly darwin?: CLibraryImage | undefined;
  readonly linux?: CLibraryImage | undefined;
}
/** The image every Darwin program already loads (ordinal 1). Its
 * re-exports (libsystem_c, libsystem_kernel, libcommonCrypto, ...) resolve
 * the libSystem-family bindings without another load command. */
export const darwinSystemLibrary = "/usr/lib/libSystem.B.dylib";
const libSystem: CLibraryImage = {
  name: darwinSystemLibrary,
  optional: false,
  currentVersion: 0x10000,
  compatibilityVersion: 0x10000,
};
const glibc: CLibraryImage = {
  name: "libc.so.6",
  optional: false,
  currentVersion: 0,
  compatibilityVersion: 0,
};
/** The libraries Tint programs may bind. Names in declarations grant
 * nothing: a binding module outside this manifest (or the build request's
 * additions) is rejected. */
export const cLibraryManifest: readonly CLibraryManifestEntry[] = [
  { module: "tint:c/libsystem", darwin: libSystem, linux: glibc },
  { module: "tint:c/commoncrypto", darwin: libSystem },
  { module: "tint:c/darwin-os", darwin: libSystem },
  { module: "tint:c/linux-os", linux: glibc },
  { module: "tint:c/dl", darwin: libSystem, linux: glibc },
  { module: "tint:c/memory", darwin: libSystem, linux: glibc },
  {
    module: "tint:c/zlib",
    darwin: {
      name: "/usr/lib/libz.1.dylib",
      optional: false,
      currentVersion: 0x10000,
      compatibilityVersion: 0x10000,
    },
    linux: {
      name: "libz.so.1",
      optional: false,
      currentVersion: 0,
      compatibilityVersion: 0,
    },
  },
];
/** How `target` loads binding module `module`, if the manifest (with any
 * `additional` entries, which take precedence) lists it for that target. */
export function cLibraryImage(
  module: string,
  target: CTarget,
  additional: readonly CLibraryManifestEntry[] = [],
): CLibraryImage | undefined {
  for (const list of [additional, cLibraryManifest]) {
    if (list === undefined) throw "library manifest invariant";
    for (const entry of list) {
      if (entry === undefined) throw "library manifest entry invariant";
      if (entry.module !== module) continue;
      return target.name === "darwin-arm64"
        ? entry.darwin
        : target.name === "linux-arm64" || target.name === "linux-x86_64"
          ? entry.linux
          : undefined;
    }
  }
  return undefined;
}
/** Whether `image` is the Darwin system library every program loads. */
export function cSystemLibrary(image: CLibraryImage): boolean {
  return image.name === darwinSystemLibrary || image.name === glibc.name;
}

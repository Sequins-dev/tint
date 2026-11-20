import type { PosixHostABI, PosixHostFacts } from "@tint/abi/host";
import {
  darwinArm64CTarget,
  linuxArm64CTarget,
  type CTarget,
} from "@tint/abi/c";
import { linuxX86_64CTarget } from "@tint/abi/c/sysv";
import { darwinHostABI } from "./darwin/host-abi.ts";
import { linuxHostABI, linuxX86_64HostFacts } from "./linux/host-abi.ts";

/** A `major.minor.patch` platform version (Mach-O deployment target / SDK). */
export interface PlatformVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** What a native build produces code for (docs/platform-roadmap.md,
 * "Separate the dimensions"). The compiler's execution host is a separate
 * input: a build may target an OS other than the one it runs on. */
interface NativeTargetFacts {
  readonly c: CTarget;
  readonly parallelCollection: boolean;
  /** Alignment of executable image segments in the file and in memory. */
  readonly segmentAlignment: number;
  /** Granularity of the hosted startup's mappings and guard pages: a
   * multiple of every page size the target's kernels may use. */
  readonly memoryPageBytes: number;
}

interface AArch64TargetFacts extends NativeTargetFacts {
  readonly arch: "aarch64";
}

export interface DarwinAArch64Target extends AArch64TargetFacts {
  readonly name: "darwin-aarch64";
  readonly os: "darwin";
  readonly objectFormat: "macho";
  readonly hostABI: PosixHostABI;
  /** LC_BUILD_VERSION deployment target and SDK. */
  readonly minimumOS: PlatformVersion;
  readonly sdk: PlatformVersion;
}

/** Linux arm64 with glibc (docs/linux-aarch64-target.md). */
export interface LinuxAArch64Target extends AArch64TargetFacts {
  readonly name: "linux-aarch64";
  readonly os: "linux";
  readonly objectFormat: "elf";
  readonly hostABI: PosixHostABI;
  /** PT_INTERP: glibc's dynamic loader. */
  readonly interpreter: string;
}

/** Linux x86-64 glibc target. Public C FFI has its own ABI policy. */
export interface LinuxX86_64Target extends NativeTargetFacts {
  readonly name: "linux-x86_64";
  readonly os: "linux";
  readonly arch: "x86_64";
  readonly objectFormat: "elf";
  readonly hostABI: PosixHostFacts;
  readonly interpreter: string;
  readonly glibcStartVersion: string;
}

export type AArch64Target = DarwinAArch64Target | LinuxAArch64Target;
export type NativeTarget = AArch64Target | LinuxX86_64Target;

export const darwinAArch64Target: DarwinAArch64Target = {
  name: "darwin-aarch64",
  os: "darwin",
  arch: "aarch64",
  objectFormat: "macho",
  segmentAlignment: 16384,
  memoryPageBytes: 16384,
  c: darwinArm64CTarget,
  parallelCollection: true,
  hostABI: darwinHostABI(),
  minimumOS: { major: 14, minor: 0, patch: 0 },
  sdk: { major: 15, minor: 0, patch: 0 },
};

/** Supported kernels use 4K, 16K or 64K pages, so images and mappings are
 * laid out for 64K. */
export const linuxAArch64Target: LinuxAArch64Target = {
  name: "linux-aarch64",
  os: "linux",
  arch: "aarch64",
  objectFormat: "elf",
  segmentAlignment: 65536,
  memoryPageBytes: 65536,
  c: linuxArm64CTarget,
  parallelCollection: true,
  hostABI: linuxHostABI(),
  interpreter: "/lib/ld-linux-aarch64.so.1",
};

export const linuxX86_64Target: LinuxX86_64Target = {
  name: "linux-x86_64",
  os: "linux",
  arch: "x86_64",
  objectFormat: "elf",
  segmentAlignment: 4096,
  memoryPageBytes: 4096,
  c: linuxX86_64CTarget,
  parallelCollection: false,
  hostABI: linuxX86_64HostFacts(),
  interpreter: "/lib64/ld-linux-x86-64.so.2",
  glibcStartVersion: "GLIBC_2.34",
};

/** The target a `--target` argument names, if any. */
export function nativeTargetNamed(name: string): NativeTarget | undefined {
  if (name === darwinAArch64Target.name) return darwinAArch64Target;
  if (name === linuxAArch64Target.name) return linuxAArch64Target;
  if (name === linuxX86_64Target.name) return linuxX86_64Target;
  return undefined;
}

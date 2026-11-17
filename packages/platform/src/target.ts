import type { PosixHostABI } from "@tint/abi/host";
import {
  darwinArm64CTarget,
  linuxArm64CTarget,
  type CTarget,
} from "@tint/abi/c";
import { darwinHostABI } from "./darwin/host-abi.ts";

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
  readonly arch: "aarch64";
  /** Alignment of executable image segments in the file and in memory. */
  readonly segmentAlignment: number;
  /** Granularity of the hosted startup's mappings and guard pages: a
   * multiple of every page size the target's kernels may use. */
  readonly memoryPageBytes: number;
  /** The C calling convention of foreign (c-call) bindings. */
  readonly c: CTarget;
}

export interface DarwinAArch64Target extends NativeTargetFacts {
  readonly name: "darwin-aarch64";
  readonly os: "darwin";
  readonly objectFormat: "macho";
  readonly hostABI: PosixHostABI;
  /** LC_BUILD_VERSION deployment target and SDK. */
  readonly minimumOS: PlatformVersion;
  readonly sdk: PlatformVersion;
}

/** Linux arm64 (glibc). Its host ABI and ELF writer are not defined yet;
 * builds for it fail explicitly where they are needed. */
export interface LinuxAArch64Target extends NativeTargetFacts {
  readonly name: "linux-aarch64";
  readonly os: "linux";
  readonly objectFormat: "elf";
  readonly hostABI?: undefined;
}

export type NativeTarget = DarwinAArch64Target | LinuxAArch64Target;

export const darwinAArch64Target: DarwinAArch64Target = {
  name: "darwin-aarch64",
  os: "darwin",
  arch: "aarch64",
  objectFormat: "macho",
  segmentAlignment: 16384,
  memoryPageBytes: 16384,
  c: darwinArm64CTarget,
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
};

/** The target a `--target` argument names, if any. */
export function nativeTargetNamed(name: string): NativeTarget | undefined {
  if (name === darwinAArch64Target.name) return darwinAArch64Target;
  if (name === linuxAArch64Target.name) return linuxAArch64Target;
  return undefined;
}

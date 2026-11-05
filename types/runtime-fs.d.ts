// Initial compiler-host view of node:fs. Node supplies it during bootstrap;
// native Tint must provide these operations through its platform adapter.
// This declaration is a surface contract, not a native implementation.
declare module "node:fs" {
  export function openSync(
    path: string,
    flags: "r" | "wx",
    mode?: number,
  ): number;
  export function readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: null,
  ): number;
  export function writeSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: null,
  ): number;
  export function closeSync(fd: number): void;
  export function fchmodSync(fd: number, mode: number): void;
  export function renameSync(oldPath: string, newPath: string): void;
  export function unlinkSync(path: string): void;
  export function readlinkSync(path: string): string;
}

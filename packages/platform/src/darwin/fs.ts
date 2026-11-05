import { createFileSystem } from "../files/system.ts";
import { darwinErrorCode } from "./fs-errors.ts";
import {
  openRead,
  openExclusive,
  read,
  write,
  close,
  chmod,
  rename,
  unlink,
  readlink,
} from "@tint/native-runtime/intrinsics/fs";
import type { FileHost } from "../files/service.ts";
export {
  createFileSystem,
  type RawFileHost,
  type SynchronousFS,
  type NativeFileSystem,
  type FileSystemError,
} from "../files/system.ts";
const system = createFileSystem({
  openRead: (path) => openRead(path),
  openExclusive: (path, mode) => openExclusive(path, mode),
  read: (fd, buffer) => read(fd, buffer),
  write: (fd, buffer) => write(fd, buffer),
  close: (fd) => close(fd),
  chmod: (fd, mode) => chmod(fd, mode),
  rename: (from, to) => rename(from, to),
  unlink: (path) => unlink(path),
  readlink: (path, buffer) => readlink(path, buffer),
  errorCode: (errno) => darwinErrorCode(errno),
});
/** Native resolution target for the compiler's finite node:fs contract. */
export function openSync(
  path: string,
  flags: "r" | "wx",
  mode: number = 0o666,
): number {
  return system.sync.openSync(path, flags, mode);
}
export function readSync(
  fd: number,
  buffer: Uint8Array,
  offset: number,
  length: number,
  position: null,
): number {
  return system.sync.readSync(fd, buffer, offset, length, position);
}
export function writeSync(
  fd: number,
  buffer: Uint8Array,
  offset: number,
  length: number,
  position: null,
): number {
  return system.sync.writeSync(fd, buffer, offset, length, position);
}
export function closeSync(fd: number): void {
  system.sync.closeSync(fd);
}
export function fchmodSync(fd: number, mode: number): void {
  system.sync.fchmodSync(fd, mode);
}
export function renameSync(from: string, to: string): void {
  system.sync.renameSync(from, to);
}
export function unlinkSync(path: string): void {
  system.sync.unlinkSync(path);
}
export function createNativeFileHost(): FileHost<number> {
  return system.host;
}

export function readlinkSync(path: string): string {
  return system.sync.readlinkSync(path);
}

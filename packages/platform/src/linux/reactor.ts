import {
  epoll_create1,
  epoll_ctl,
  epoll_ctl$delete,
  epoll_wait,
  eventfd,
} from "tint:c/linux-reactor";
import { nativeTargetArchX86_64 } from "@tint/abi/host";
import { readUnsigned, writeUnsigned } from "@tint/foundation/binary/bytes";
import { close, read, write } from "@tint/native-runtime/intrinsics/fs";
import { memoryPageBytes } from "@tint/native-runtime/intrinsics/memory";
import { targetArchitecture } from "@tint/native-runtime/intrinsics/process";
import type { NativeReactor } from "@tint/native-runtime/event-loop";
import { readFile } from "../files/service.ts";
import { createNativeFileHost } from "./fs.ts";

const BATCH = 16;
const CLOSE_ON_EXEC = 0x80000;
const NONBLOCKING = 0x800;
const ADD = 1;
const DELETE = 2;
const READ = 1;
const INTERRUPTED = -4;
const WOULD_BLOCK = -11;

/** eventfd remains readable until the owner drains it. A saturated
 * nonblocking counter already has a wake pending. */
export function signalReactor(control: number): void {
  const increment = new Uint8Array(8);
  increment[0] = 1;
  let status: number = INTERRUPTED;
  while (status === INTERRUPTED) status = write(control, increment);
  if (status !== 8 && status !== WOULD_BLOCK)
    throw new Error("eventfd write failed: " + String(status));
}

export function createReactor(): NativeReactor {
  const queue = epoll_create1(CLOSE_ON_EXEC);
  if (queue < 0) throw new Error("epoll_create1 failed: " + String(queue));
  const control = eventfd(0, CLOSE_ON_EXEC | NONBLOCKING);
  if (control < 0) {
    close(queue);
    throw new Error("eventfd failed: " + String(control));
  }
  // glibc packs struct epoll_event on x86-64 and aligns its data union on arm64.
  const offset = targetArchitecture() === nativeTargetArchX86_64 ? 4 : 8;
  const eventBytes = offset + 8;
  const event = new Uint8Array(eventBytes);
  const events = new Uint8Array(eventBytes * BATCH);
  const wake = new Uint8Array(8);

  function watch(fd: number, token: number): void {
    if (
      !writeUnsigned(event, 0, 4, READ, "little").ok ||
      !writeUnsigned(event, offset, 4, token, "little").ok
    )
      throw new RangeError("invalid epoll registration");
    const status = epoll_ctl(queue, ADD, fd, event);
    if (status < 0) throw new Error("epoll add failed: " + String(status));
  }
  try {
    watch(control, 0);
  } catch (error) {
    close(control);
    close(queue);
    throw error;
  }

  let closed = false;
  function ensureOpen(): void {
    if (closed) throw new Error("epoll is closed");
  }
  return {
    control,
    watchReadable: (fd, token): void => {
      ensureOpen();
      if (token === 0) throw new RangeError("reactor token zero is reserved");
      watch(fd, token);
    },
    unwatchReadable: (fd): void => {
      ensureOpen();
      const status = epoll_ctl$delete(queue, DELETE, fd, 0);
      if (status < 0) throw new Error("epoll delete failed: " + String(status));
    },
    poll: (timeout, publish): void => {
      ensureOpen();
      if (!(timeout >= 0)) throw new RangeError("invalid epoll timeout");
      const milliseconds =
        timeout === Infinity ? -1 : Math.ceil(Math.min(timeout, 2147483647));
      const received = epoll_wait(queue, events, BATCH, milliseconds);
      if (received === INTERRUPTED) return;
      if (received < 0)
        throw new Error("epoll_wait failed: " + String(received));
      for (let i = 0; i < received; i++) {
        const token = readUnsigned(
          events,
          i * eventBytes + offset,
          4,
          "little",
        );
        if (!token.ok) throw "EPOLL_EVENT_LAYOUT";
        if (token.value === 0) {
          let status: number = INTERRUPTED;
          while (status === INTERRUPTED) status = read(control, wake);
          if (status !== 8 && status !== WOULD_BLOCK)
            throw new Error("eventfd read failed: " + String(status));
        }
        publish(token.value);
      }
    },
    close: (): void => {
      if (closed) return;
      closed = true;
      close(control);
      close(queue);
    },
  };
}

/** Current resident set size in bytes from /proc/self/statm, or 0 when unavailable. */
export function residentSetBytes(): number {
  const loaded = readFile<number>(
    createNativeFileHost(),
    "/proc/self/statm",
    256,
  );
  if (!loaded.ok) return 0;
  const bytes = loaded.value;
  let index = 0;
  while (index < bytes.length && (bytes[index] ?? 0) !== 32) index++;
  while (index < bytes.length && (bytes[index] ?? 0) === 32) index++;
  let pages = 0,
    digits = 0;
  while (index < bytes.length) {
    const code = bytes[index] ?? 0;
    if (code < 48 || code > 57) break;
    pages = pages * 10 + (code - 48);
    digits++;
    index++;
  }
  if (digits === 0) return 0;
  const page = memoryPageBytes();
  return page > 0 ? pages * page : 0;
}

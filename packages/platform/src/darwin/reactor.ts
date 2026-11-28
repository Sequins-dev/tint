import {
  fcntl$setDescriptor,
  getpid,
  kevent64$change,
  kevent64$poll,
  kevent64$wait,
  kqueue,
  proc_pidinfo,
} from "tint:c/darwin-reactor";
import { close } from "@tint/native-runtime/intrinsics/fs";
import type { NativeReactor } from "@tint/native-runtime/event-loop";

// sys/event.h: kevent64_s, EVFILT_READ, EVFILT_USER and EV_*.
const EVENT_BYTES = 48;
const BATCH = 16;
const USER = -10;
const READ = -1;
const ADD = 1;
const DELETE = 2;
const CLEAR = 0x20;
const TRIGGER = 0x01000000;
// kevent64's KEVENT_FLAG_IMMEDIATE. A zero timespec is not a poll: it takes
// the timed-wait path and reschedules the thread, about 11 us per call on
// macOS arm64, against 0.15 us for an immediate poll.
const IMMEDIATE = 1;
const INTERRUPTED = -4;

function writeU32LE(
  buffer: Uint8Array,
  offset: number,
  value: number,
): boolean {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return false;
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
  buffer[offset + 3] = (value >>> 24) & 0xff;
  return true;
}

function writeU16LE(
  buffer: Uint8Array,
  offset: number,
  value: number,
): boolean {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) return false;
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  return true;
}

function writeI16LE(
  buffer: Uint8Array,
  offset: number,
  value: number,
): boolean {
  if (!Number.isInteger(value) || value < -32768 || value > 32767) return false;
  const bits = value & 0xffff;
  buffer[offset] = bits & 0xff;
  buffer[offset + 1] = (bits >>> 8) & 0xff;
  return true;
}

function readU32LE(buffer: Uint8Array, offset: number): number {
  return (
    ((buffer[offset] ?? 0) |
      ((buffer[offset + 1] ?? 0) << 8) |
      ((buffer[offset + 2] ?? 0) << 16) |
      ((buffer[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function change(
  queue: number,
  event: Uint8Array,
  identifier: number,
  filter: number,
  flags: number,
  filterFlags: number,
  token: number,
): void {
  if (
    !writeU32LE(event, 0, identifier) ||
    !writeI16LE(event, 8, filter) ||
    !writeU16LE(event, 10, flags) ||
    !writeU32LE(event, 12, filterFlags) ||
    !writeU32LE(event, 24, token)
  )
    throw new RangeError("invalid kqueue registration");
  let status: number = INTERRUPTED;
  while (status === INTERRUPTED)
    status = kevent64$change(queue, event, 1, 0, 0, 0, 0);
  if (status < 0) throw new Error("kevent change failed: " + String(status));
}

/** EVFILT_USER retains a trigger until poll retrieves it. A producer can
 * publish before the owner enters kevent without losing the wake. */
export function signalReactor(control: number): void {
  change(control, new Uint8Array(EVENT_BYTES), 0, USER, 0, TRIGGER, 0);
}

export function createReactor(): NativeReactor {
  const queue = kqueue();
  if (queue < 0) throw new Error("kqueue failed: " + String(queue));
  const changes = new Uint8Array(EVENT_BYTES);
  const events = new Uint8Array(EVENT_BYTES * BATCH);
  const time = new Uint8Array(16);
  try {
    // F_SETFD, FD_CLOEXEC.
    const flags = fcntl$setDescriptor(queue, 2, 1);
    if (flags < 0)
      throw new Error("kqueue close-on-exec failed: " + String(flags));
    change(queue, changes, 0, USER, ADD | CLEAR, 0, 0);
  } catch (error) {
    close(queue);
    throw error;
  }

  let closed = false;
  function ensureOpen(): void {
    if (closed) throw new Error("kqueue is closed");
  }
  return {
    control: queue,
    watchReadable: (fd, token): void => {
      ensureOpen();
      if (token === 0) throw new RangeError("reactor token zero is reserved");
      change(queue, changes, fd, READ, ADD, 0, token);
    },
    unwatchReadable: (fd): void => {
      ensureOpen();
      change(queue, changes, fd, READ, DELETE, 0, 0);
    },
    poll: (timeout, publish): void => {
      ensureOpen();
      let received = 0;
      if (timeout === Infinity)
        received = kevent64$wait(queue, 0, 0, events, BATCH, 0, 0);
      else if (timeout === 0)
        received = kevent64$wait(queue, 0, 0, events, BATCH, IMMEDIATE, 0);
      else {
        const ns = Math.ceil(Math.min(timeout, 2147483647) * 1000000);
        if (
          !writeU32LE(time, 0, Math.floor(ns / 1000000000)) ||
          !writeU32LE(time, 8, ns % 1000000000)
        )
          throw new RangeError("invalid kqueue timeout");
        received = kevent64$poll(queue, 0, 0, events, BATCH, 0, time);
      }
      if (received === INTERRUPTED) return;
      if (received < 0)
        throw new Error("kevent poll failed: " + String(received));
      for (let i = 0; i < received; i++) {
        publish(readU32LE(events, i * EVENT_BYTES + 24));
      }
    },
    close: (): void => {
      if (closed) return;
      closed = true;
      close(queue);
    },
  };
}

/** Current resident set size in bytes via Darwin PROC_PIDTASKINFO, or 0 when unavailable. */
export function residentSetBytes(): number {
  const info = new Uint8Array(96);
  const length = proc_pidinfo(getpid(), 4, 0, info, info.length);
  if (length < 16) return 0;
  const low = readU32LE(info, 8),
    high = readU32LE(info, 12);
  return low + high * 4294967296;
}

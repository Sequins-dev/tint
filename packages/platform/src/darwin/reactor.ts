import {
  fcntl$setDescriptor,
  kevent64$change,
  kevent64$poll,
  kevent64$wait,
  kqueue,
} from "tint:c/darwin-reactor";
import {
  readUnsigned,
  writeSigned,
  writeUnsigned,
} from "@tint/foundation/binary/bytes";
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
    !writeUnsigned(event, 0, 4, identifier, "little").ok ||
    !writeSigned(event, 8, 2, filter, "little").ok ||
    !writeUnsigned(event, 10, 2, flags, "little").ok ||
    !writeUnsigned(event, 12, 4, filterFlags, "little").ok ||
    !writeUnsigned(event, 24, 4, token, "little").ok
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
          !writeUnsigned(time, 0, 4, Math.floor(ns / 1000000000), "little")
            .ok ||
          !writeUnsigned(time, 8, 4, ns % 1000000000, "little").ok
        )
          throw new RangeError("invalid kqueue timeout");
        received = kevent64$poll(queue, 0, 0, events, BATCH, 0, time);
      }
      if (received === INTERRUPTED) return;
      if (received < 0)
        throw new Error("kevent poll failed: " + String(received));
      for (let i = 0; i < received; i++) {
        const token = readUnsigned(events, i * EVENT_BYTES + 24, 4, "little");
        if (!token.ok) throw "KQUEUE_EVENT_LAYOUT";
        publish(token.value);
      }
    },
    close: (): void => {
      if (closed) return;
      closed = true;
      close(queue);
    },
  };
}

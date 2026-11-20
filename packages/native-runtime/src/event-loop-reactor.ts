import {
  createEventLoop,
  type EventLoop,
  type EventLoopHandle,
} from "./event-loop.ts";
import { createKeyIndex } from "@tint/foundation/collections/key-index";

/** Owner-thread readiness. Tokens identify a registration even if its file
 * descriptor is later reused. Token zero is reserved for the control wake. */
export interface NativeReactor {
  /** Scalar control grant for producers. Stop all producers before close. */
  readonly control: number;
  /** The caller owns the fd and makes it nonblocking before registration. */
  watchReadable(fd: number, token: number): void;
  unwatchReadable(fd: number): void;
  /** Relative milliseconds, or Infinity. publish only enqueues owner work. */
  poll(timeout: number, publish: (token: number) => void): void;
  close(): void;
}

export interface ReactorEventLoopOptions {
  createReactor(): NativeReactor;
  now(): number;
  drainMicrotasks(): void;
  /** Ingest raw records and enqueue turns. No user callback runs here. */
  onWake(): void;
  stopRequested?(): boolean;
}

export interface ReactorEventLoop {
  readonly loop: EventLoop;
  /** The owner grants the wake descriptor only while its reactor is live. */
  wakeTarget(): number;
  watchReadable(fd: number, callback: () => void): EventLoopHandle;
  close(): void;
}

interface ReadWatch {
  readonly callback: () => void;
  readonly reference: EventLoopHandle;
}

export function createReactorEventLoop(
  options: ReactorEventLoopOptions,
): ReactorEventLoop {
  let reactor: NativeReactor | undefined;
  let closed = false;
  let nextToken = 1;
  const reads = createKeyIndex<number, ReadWatch>((token): number => token);
  const descriptors = createKeyIndex<number, boolean>((fd): number => fd);
  function activeReactor(): NativeReactor {
    if (closed) throw new Error("event loop is closed");
    const existing = reactor;
    if (existing !== undefined) return existing;
    const created = options.createReactor();
    reactor = created;
    return created;
  }
  const loop: EventLoop = createEventLoop({
    now: (): number => options.now(),
    drainMicrotasks: (): void => options.drainMicrotasks(),
    stopRequested: (): boolean => {
      const requested = options.stopRequested;
      return requested !== undefined && requested();
    },
    poll: (timeout): void => {
      if (closed) throw new Error("event loop is closed");
      if (reactor === undefined && timeout === 0) return;
      activeReactor().poll(timeout, (token: number): void => {
        if (token === 0) {
          options.onWake();
          return;
        }
        if (!reads.has(token)) return;
        loop.enqueueIO((): void => {
          const watch = reads.get(token);
          if (watch !== undefined) watch.callback();
        });
      });
    },
  });

  return {
    loop,
    wakeTarget: (): number => activeReactor().control,
    watchReadable: (fd, callback): EventLoopHandle => {
      if (!Number.isInteger(fd) || fd < 0 || fd > 2147483647)
        throw new RangeError("invalid file descriptor");
      if (descriptors.has(fd))
        throw new Error("file descriptor is already watched");
      if (nextToken > 4294967295)
        throw new RangeError("readiness token space exhausted");
      const active = activeReactor();
      const token = nextToken++;
      active.watchReadable(fd, token);
      descriptors.set(fd, true);
      const reference = loop.retain();
      reads.set(token, { callback, reference });
      const watch: EventLoopHandle = {
        kind: "handle",
        ref: (): EventLoopHandle => {
          reference.ref();
          return watch;
        },
        unref: (): EventLoopHandle => {
          reference.unref();
          return watch;
        },
        hasRef: (): boolean => reference.hasRef(),
        close: (): void => {
          if (!reads.has(token)) return;
          active.unwatchReadable(fd);
          reads.delete(token);
          descriptors.delete(fd);
          reference.close();
        },
      };
      return watch;
    },
    close: (): void => {
      if (closed) return;
      closed = true;
      const active = reactor;
      if (active !== undefined) active.close();
      reactor = undefined;
      reads.forEach((watch, _token): void => watch.reference.close());
      reads.clear();
      descriptors.clear();
    },
  };
}

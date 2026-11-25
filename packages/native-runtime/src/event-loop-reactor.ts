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

/** Work that arrives through shared memory, such as a message queue, which
 * the loop polls for a short while before it blocks: a reply to a message
 * this loop just handled usually arrives sooner than the owner would be
 * woken, and producers skip their wake while the owner is armed. */
export interface ReactorIdleSource {
  /** Before blocking: whether to take part, after advertising that the
   * owner is awake. Only a source with recent work arms. */
  arm(): boolean;
  /** While spinning: a cheap check for work. */
  ready(): boolean;
  /** After spinning, decided under the producers' lock: schedule queued
   * work and return true, or stop advertising and return false. */
  settle(): boolean;
}

export interface ReactorEventLoop {
  readonly loop: EventLoop;
  /** The owner grants the wake descriptor only while its reactor is live. */
  wakeTarget(): number;
  watchReadable(fd: number, callback: () => void): EventLoopHandle;
  /** Poll `source` before blocking until the returned function runs. */
  pollWhileIdle(source: ReactorIdleSource): () => void;
  close(): void;
}

/** How long a loop polls its idle sources before it blocks: longer than a
 * round trip to another isolate, short against a blocked wait. */
const idleSpinMilliseconds = 0.05;
/** The longest a loop that keeps finding shared-memory work goes without
 * checking its descriptors. */
const readinessMilliseconds = 1;

interface ReadWatch {
  readonly callback: () => void;
  readonly dispatch: () => void;
  readonly reference: EventLoopHandle;
}

export function createReactorEventLoop(
  options: ReactorEventLoopOptions,
): ReactorEventLoop {
  let reactor: NativeReactor | undefined;
  let closed = false;
  let nextToken = 1;
  const reads = createKeyIndex<number, ReadWatch>((token): number => token);
  let idleSources: ReactorIdleSource[] = [];
  // The sources armed for the current idle poll, reused across polls.
  const armed: ReactorIdleSource[] = [];
  // When the loop last polled its descriptors.
  let polled = 0;
  /** Polls the idle sources that arm for up to `limit` milliseconds, then
   * settles them; whether that scheduled work, so the loop must not block. */
  function pollIdleSources(limit: number): boolean {
    armed.length = 0;
    for (const source of idleSources) if (source.arm()) armed.push(source);
    if (armed.length === 0) return false;
    const deadline = options.now() + Math.min(limit, idleSpinMilliseconds);
    let found = false;
    while (!found && options.now() < deadline)
      for (const source of armed)
        if (source.ready()) {
          found = true;
          break;
        }
    let scheduled = false;
    for (const source of armed) if (source.settle()) scheduled = true;
    armed.length = 0;
    return scheduled;
  }
  /** The poll timeout once the idle sources had their turn: zero when they
   * scheduled work, else what remains of `timeout`; undefined when work is
   * scheduled and the descriptors were checked within the readiness
   * interval, so a steady stream of shared-memory work does not pay a
   * system call per message. */
  function idleWait(timeout: number): number | undefined {
    const started = options.now();
    if (pollIdleSources(timeout))
      return started - polled < readinessMilliseconds ? undefined : 0;
    return timeout === Infinity
      ? timeout
      : Math.max(0, timeout - (options.now() - started));
  }
  const descriptors = createKeyIndex<number, boolean>((fd): number => fd);
  function activeReactor(): NativeReactor {
    if (closed) throw new Error("event loop is closed");
    const existing = reactor;
    if (existing !== undefined) return existing;
    const created = options.createReactor();
    reactor = created;
    return created;
  }
  const onToken = (token: number): void => {
    if (token === 0) {
      options.onWake();
      return;
    }
    const watch = reads.get(token);
    if (watch !== undefined) loop.enqueueIO(watch.dispatch);
  };
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
      const wait =
        timeout !== 0 && idleSources.length !== 0 ? idleWait(timeout) : timeout;
      if (wait === undefined) return;
      polled = options.now();
      activeReactor().poll(wait, onToken);
    },
  });

  return {
    loop,
    wakeTarget: (): number => activeReactor().control,
    pollWhileIdle: (source): (() => void) => {
      idleSources.push(source);
      return (): void => {
        idleSources = idleSources.filter((other) => other !== source);
      };
    },
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
      const dispatch = (): void => {
        const current = reads.get(token);
        if (current !== undefined) current.callback();
      };
      reads.set(token, { callback, dispatch, reference });
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

import { createJobQueue, drainJobs, enqueueJob } from "@tint/js-runtime/jobs";

type Callback = () => void;
type Entry = "callback" | "microtask";
type HandleKind = "timeout" | "immediate" | "handle";

/** One isolate owns every callback and calls every method. poll may enqueue
 * readiness and inbox callbacks, but may not run user code. Infinity means
 * an indefinite wait. A host can defer allocating its reactor until needed. */
export interface EventLoopHost {
  now(): number;
  poll(timeoutMilliseconds: number): void;
  drainMicrotasks(): void;
}

export interface EventLoopHandle {
  readonly kind: HandleKind;
  ref(): EventLoopHandle;
  unref(): EventLoopHandle;
  hasRef(): boolean;
  close(): void;
}

export interface EventLoop {
  nextTick(callback: Callback): void;
  enqueuePending(callback: Callback): void;
  enqueueIO(callback: Callback): void;
  enqueueClose(callback: Callback): void;
  retain(): EventLoopHandle;
  setImmediate(callback: Callback): EventLoopHandle;
  clearImmediate(handle: EventLoopHandle | undefined): void;
  setTimeout(callback: Callback, delay?: number): EventLoopHandle;
  clearTimeout(handle: EventLoopHandle | undefined): void;
  setInterval(callback: Callback, delay?: number): EventLoopHandle;
  clearInterval(handle: EventLoopHandle | undefined): void;
  checkpoint(entry: Entry): void;
  run(entry: Entry): void;
}

interface Timer {
  readonly repeat: boolean;
  readonly delay: number;
  callback: Callback | undefined;
  handle: EventLoopHandle | undefined;
  deadline: number;
  sequence: number;
  index: number;
}

interface Phase {
  readonly callbacks: Callback[];
  next: number;
}

function createPhase(): Phase {
  return { callbacks: [], next: 0 };
}

function timerDelay(delay: number | undefined): number {
  if (delay === undefined || !(delay >= 1 && delay <= 2147483647)) return 1;
  return Math.trunc(delay);
}

function earlier(a: Timer, b: Timer): boolean {
  return (
    a.deadline < b.deadline ||
    (a.deadline === b.deadline && a.sequence < b.sequence)
  );
}

export function createEventLoop(host: EventLoopHost): EventLoop {
  const ticks = createJobQueue<undefined>();
  const pending = createPhase();
  const io = createPhase();
  const check = createPhase();
  const close = createPhase();
  const timers: Timer[] = [];
  let nextSequence = 0;
  let refs = 0;
  let running = false;
  let lastTime = 0;

  function now(): number {
    const time = host.now();
    if (!Number.isFinite(time) || time < lastTime)
      throw "EVENT_LOOP_MONOTONIC_CLOCK";
    lastTime = time;
    return time;
  }

  function timerAt(index: number): Timer {
    const timer = timers[index];
    if (timer === undefined) throw "EVENT_LOOP_TIMER_HEAP";
    return timer;
  }
  function place(index: number, timer: Timer): void {
    timers[index] = timer;
    timer.index = index;
  }
  function siftUp(index: number, timer: Timer): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const candidate = timerAt(parent);
      if (!earlier(timer, candidate)) break;
      place(index, candidate);
      index = parent;
    }
    place(index, timer);
  }
  function siftDown(index: number, timer: Timer): void {
    while (index * 2 + 1 < timers.length) {
      let child = index * 2 + 1;
      let candidate = timerAt(child);
      const right = timers[child + 1];
      if (right !== undefined && earlier(right, candidate)) {
        child++;
        candidate = right;
      }
      if (!earlier(candidate, timer)) break;
      place(index, candidate);
      index = child;
    }
    place(index, timer);
  }
  function push(timer: Timer, started: number): void {
    timer.deadline = started + timer.delay;
    timer.sequence = nextSequence++;
    const index = timers.length;
    timers.push(timer);
    siftUp(index, timer);
  }
  function remove(timer: Timer): void {
    const index = timer.index;
    if (index < 0) return;
    const last = timers.pop();
    timer.index = -1;
    if (last === undefined) throw "EVENT_LOOP_TIMER_HEAP";
    if (last === timer) return;
    const parent = timers[Math.floor((index - 1) / 2)];
    if (parent !== undefined && earlier(last, parent)) siftUp(index, last);
    else siftDown(index, last);
  }

  function reference(kind: HandleKind, cancel: Callback): EventLoopHandle {
    let active = true;
    let referenced = true;
    refs++;
    const handle: EventLoopHandle = {
      kind,
      ref: (): EventLoopHandle => {
        if (!referenced && (active || kind === "timeout")) {
          referenced = true;
          if (active) refs++;
        }
        return handle;
      },
      unref: (): EventLoopHandle => {
        if (referenced) {
          referenced = false;
          if (active) refs--;
        }
        return handle;
      },
      hasRef: (): boolean => referenced && (active || kind === "timeout"),
      close: (): void => {
        if (!active) return;
        active = false;
        if (referenced) refs--;
        cancel();
      },
    };
    return handle;
  }
  function scheduleTimer(
    callback: Callback,
    delay: number | undefined,
    repeat: boolean,
  ): EventLoopHandle {
    const started = now();
    const timer: Timer = {
      repeat,
      delay: timerDelay(delay),
      callback,
      handle: undefined,
      deadline: 0,
      sequence: 0,
      index: -1,
    };
    const handle = reference("timeout", (): void => {
      timer.callback = undefined;
      remove(timer);
    });
    timer.handle = handle;
    push(timer, started);
    return handle;
  }
  function clearTimeout(handle: EventLoopHandle | undefined): void {
    if (handle !== undefined && handle.kind === "timeout") handle.close();
  }

  function checkpoint(entry: Entry): void {
    if (entry === "microtask") host.drainMicrotasks();
    do {
      drainJobs<undefined>(ticks, (callback, _context): void => callback());
      host.drainMicrotasks();
    } while (ticks.size > 0);
  }

  function runTimers(): void {
    const cutoff = now();
    for (;;) {
      const timer = timers[0];
      if (timer === undefined || timer.deadline > cutoff) return;
      const callback = timer.callback;
      const handle = timer.handle;
      if (callback === undefined || handle === undefined)
        throw "EVENT_LOOP_TIMER_HEAP";
      // Repeating timers measure from callback start and run at most once
      // per phase. The cutoff is fixed even if the callback runs for a while.
      const started = timer.repeat ? now() : cutoff;
      remove(timer);
      try {
        callback();
      } finally {
        if (!timer.repeat) handle.close();
        else if (timer.callback !== undefined) push(timer, started);
      }
      checkpoint("callback");
    }
  }
  function hasQueued(phase: Phase): boolean {
    return phase.next < phase.callbacks.length;
  }
  function runPhase(phase: Phase): void {
    const end = phase.callbacks.length;
    try {
      while (phase.next < end) {
        const callback = phase.callbacks[phase.next++];
        if (callback === undefined) throw "EVENT_LOOP_PHASE_QUEUE";
        callback();
        checkpoint("callback");
      }
    } finally {
      if (phase.next === phase.callbacks.length) phase.callbacks.length = 0;
      else phase.callbacks.splice(0, phase.next);
      phase.next = 0;
    }
  }
  function hasReady(): boolean {
    return hasQueued(pending) || hasQueued(io) || hasQueued(close);
  }
  function alive(): boolean {
    return refs > 0 || hasReady();
  }
  function enter(): void {
    if (running) throw "EVENT_LOOP_REENTRANCY";
    running = true;
  }
  function run(entry: Entry): void {
    enter();
    try {
      checkpoint(entry);
      if (alive() && timers.length > 0) runTimers();
      while (alive()) {
        runPhase(pending);
        const timer = timers[0];
        const timeout =
          refs === 0 || hasReady() || hasQueued(check)
            ? 0
            : timer === undefined
              ? Infinity
              : Math.max(0, timer.deadline - now());
        host.poll(timeout);
        runPhase(io);
        runPhase(check);
        runPhase(close);
        if (timers.length > 0) runTimers();
      }
    } finally {
      running = false;
    }
  }

  return {
    nextTick: (callback): void =>
      enqueueJob<undefined>(ticks, callback, undefined),
    enqueuePending: (callback): void => {
      pending.callbacks.push(callback);
    },
    enqueueIO: (callback): void => {
      io.callbacks.push(callback);
    },
    enqueueClose: (callback): void => {
      close.callbacks.push(callback);
    },
    retain: (): EventLoopHandle => reference("handle", (): void => {}),
    setImmediate: (callback): EventLoopHandle => {
      let scheduled: Callback | undefined = callback;
      const handle = reference("immediate", (): void => {
        scheduled = undefined;
      });
      check.callbacks.push((): void => {
        const ready = scheduled;
        if (ready === undefined) return;
        handle.close();
        ready();
      });
      return handle;
    },
    clearImmediate: (handle): void => {
      if (handle !== undefined && handle.kind === "immediate") handle.close();
    },
    setTimeout: (callback, delay): EventLoopHandle =>
      scheduleTimer(callback, delay, false),
    clearTimeout,
    setInterval: (callback, delay): EventLoopHandle =>
      scheduleTimer(callback, delay, true),
    clearInterval: clearTimeout,
    checkpoint: (entry): void => {
      enter();
      try {
        checkpoint(entry);
      } finally {
        running = false;
      }
    },
    run,
  };
}

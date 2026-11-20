import {
  nativeThreadExitReadOffset,
  nativeThreadExitWriteOffset,
  nativeWorkerStopObserved,
  nativeWorkerStopRequested,
  nativeWorkerStopStateOffset,
} from "@tint/abi/host";
import type {
  SharedBlockWaiting,
  SharedResult,
  SharedWaitRegistration,
  SharedWaitState,
} from "@tint/js-runtime/bytes/shared";
import {
  createNativeAgentMailbox,
  attachNativeAgentMailbox,
} from "./agent-messages.ts";
import type { EventLoopHandle } from "./event-loop.ts";
import type { ReactorEventLoop } from "./event-loop-reactor.ts";
import {
  integer,
  compareNumber,
  readNumber,
  writeNumber,
  type NativeSharedMemoryHost,
} from "./shared-memory-host.ts";
import {
  attachNativeWaitRegistry,
  type NativeWaiterParkingHost,
  type NativeWaitRegistry,
} from "./shared-waiters.ts";
import type {
  NativeMessagePort,
  NativeMessagePortGrant,
  NativeMessagePorts,
} from "./worker-ports.ts";

export interface WorkerExitPipe {
  readonly input: number;
  readonly childOutput: number;
  readonly childReadGuard: number;
}

export interface WorkerControlPipe {
  readonly input: number;
  readonly output: number;
}

export interface NativeWorkerThreadHost {
  readonly entry: number;
  readonly wouldBlock: number;
  /** Both ends are nonblocking. The caller owns all three descriptors. */
  exitPipe(): WorkerExitPipe;
  /** Both ends are nonblocking and remain open until the child has exited. */
  controlPipe(): WorkerControlPipe;
  read(fd: number, bytes: Uint8Array): number;
  write(fd: number, bytes: Uint8Array): number;
  close(fd: number): void;
  start(entry: number, argument: number): number;
  detach(thread: number): number;
}

export interface NativeWorkerLifecycle {
  readonly threadId: number;
  ref(): void;
  unref(): void;
  hasRef(): boolean;
  /** Request a stop at a worker turn boundary. Completion is still onExit. */
  requestStop(): void;
}

export interface NativeWorkerTurnControl {
  /** Borrowed descriptor. Register and unref it to wake the worker's poll. */
  readonly input: number;
  stopRequested(): boolean;
  readonly waiters: NativeWaitRegistry | undefined;
  /** Stop is represented by undefined. The caller still consumes its ticket. */
  parkWait(ticket: number, timeout: number): SharedResult<number> | undefined;
  interruptibleWaiting(waiting: SharedBlockWaiting): SharedBlockWaiting;
  /** Claim the parent channel only after the receiver can adopt it. */
  claimParentPort(ports: NativeMessagePorts): NativeMessagePort | undefined;
}

export interface NativeWorkerRequest {
  readonly threadId: number;
  readonly moduleId: number;
  /** The owner keeps the wait registry alive until exit. */
  readonly waiters?: NativeWaitRegistry;
  readonly parentPort?: NativeMessagePortGrant;
  onUnclaimedParentPort?(grant: NativeMessagePortGrant): void;
  onError(message: string): void;
  onExit(status: number): void;
}

const MAPPING_BYTES = 16384;
const MAGIC = 0x54574b31;
const MARKER = 24;
const THREAD_ID = 32;
const MODULE_ID = 40;
const ERROR_QUEUE = 48;
const ENTERED = 56;
const CONTROL_INPUT = 64;
const WAIT_REGISTRY = 80;
const WAIT_REGISTRY_BYTES = 88;
const WAIT_ENGINE = 96;
const WAIT_TICKET = 104;
const PARENT_PORT = 112;
const PORT_SIDE = 120;
const PORT_GENERATION = 128;

/** Launch from the current image. The owner watches a nonblocking exit pipe.
 * Worker code uses its own hosted context and shares only scalar startup data. */
export function startNativeWorker(
  memory: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  threads: NativeWorkerThreadHost,
  runtime: ReactorEventLoop,
  request: NativeWorkerRequest,
): NativeWorkerLifecycle {
  const { threadId, moduleId } = request;
  if (!integer(threadId) || threadId === 0 || !integer(moduleId))
    throw new RangeError("invalid worker identity");
  if (
    request.parentPort !== undefined &&
    request.onUnclaimedParentPort === undefined
  )
    throw new Error("worker startup port requires an unclaimed-port handler");
  const base = memory.mapMemory(MAPPING_BYTES);
  if (base <= 0) throw new Error("worker startup mapping failed");
  const record = { base, byteLength: MAPPING_BYTES, engineId: base };
  const queue = createNativeAgentMailbox(memory, parking, base);
  if (!queue.ok) {
    memory.unmapMemory(base, MAPPING_BYTES);
    throw new Error("worker error queue allocation failed");
  }
  const errors = queue.value;
  const scratch = new Uint32Array(2);
  const bytes = new Uint8Array(1);
  let pipe: WorkerExitPipe | undefined;
  let control: WorkerControlPipe | undefined;
  let watch: EventLoopHandle | undefined;
  let thread = 0;
  let detachStatus = 0;
  let stopSignalled = false;
  let released = false;

  function release(): void {
    released = true;
    const handle = watch;
    if (handle !== undefined) handle.close();
    const end = pipe;
    if (end !== undefined) {
      threads.close(end.input);
      if (thread === 0) {
        threads.close(end.childOutput);
        threads.close(end.childReadGuard);
      }
    }
    const signals = control;
    if (signals !== undefined) {
      threads.close(signals.input);
      threads.close(signals.output);
    }
    if (
      memory.unmapMemory(errors.registry.base, MAPPING_BYTES) !== 0 ||
      memory.unmapMemory(base, MAPPING_BYTES) !== 0
    )
      throw "NATIVE_WORKER_RELEASE";
  }

  function requestStop(): void {
    if (released || stopSignalled) return;
    const signals = control;
    if (signals === undefined) throw "NATIVE_WORKER_CONTROL_PIPE";
    compareNumber(
      memory,
      record,
      nativeWorkerStopStateOffset,
      0,
      nativeWorkerStopRequested,
      scratch,
    );
    const ticket = readNumber(memory, record, WAIT_TICKET, scratch);
    if (ticket !== 0 && request.waiters !== undefined)
      request.waiters.expire(ticket);
    let count = threads.write(signals.output, bytes);
    while (count === -4) count = threads.write(signals.output, bytes);
    if (count !== 1) throw new Error("worker wake failed: " + String(count));
    stopSignalled = true;
  }
  function finish(fd: number): void {
    let count = threads.read(fd, bytes);
    while (count === -4) count = threads.read(fd, bytes);
    const status = readNumber(memory, record, 0, scratch);
    if (count < 0 || status === 0 || status > 256)
      throw "NATIVE_WORKER_EXIT_RECORD";
    const failure = errors.receive();
    const entered = readNumber(memory, record, ENTERED, scratch) !== 0;
    const port = request.parentPort;
    const unclaimed =
      port !== undefined &&
      readNumber(memory, record, PARENT_PORT, scratch) !== 0;
    if (detachStatus !== 0) detachStatus = threads.detach(thread);
    release();
    if (unclaimed && port !== undefined) request.onUnclaimedParentPort?.(port);
    if (detachStatus !== 0)
      runtime.loop.enqueuePending((): void =>
        request.onError("worker detach failed: " + String(detachStatus)),
      );
    if (failure !== undefined)
      runtime.loop.enqueuePending((): void => request.onError(failure));
    else if (!entered)
      runtime.loop.enqueuePending((): void =>
        request.onError("worker isolate initialization failed"),
      );
    runtime.loop.enqueuePending((): void => request.onExit(status - 1));
  }

  try {
    const endpoints = threads.exitPipe();
    pipe = endpoints;
    const signals = threads.controlPipe();
    control = signals;
    writeNumber(
      memory,
      record,
      nativeThreadExitWriteOffset,
      endpoints.childOutput,
    );
    writeNumber(
      memory,
      record,
      nativeThreadExitReadOffset,
      endpoints.childReadGuard,
    );
    writeNumber(memory, record, MARKER, MAGIC);
    writeNumber(memory, record, THREAD_ID, threadId);
    writeNumber(memory, record, MODULE_ID, moduleId);
    writeNumber(memory, record, ERROR_QUEUE, errors.registry.base);
    writeNumber(memory, record, CONTROL_INPUT, signals.input);
    const port = request.parentPort;
    if (port !== undefined) {
      writeNumber(memory, record, PARENT_PORT, port.base);
      writeNumber(memory, record, PORT_SIDE, port.side);
      writeNumber(memory, record, PORT_GENERATION, port.generation);
    }
    const waiters = request.waiters;
    if (waiters !== undefined) {
      writeNumber(memory, record, WAIT_REGISTRY, waiters.registry.base);
      writeNumber(
        memory,
        record,
        WAIT_REGISTRY_BYTES,
        waiters.registry.byteLength,
      );
      writeNumber(memory, record, WAIT_ENGINE, waiters.registry.engineId);
    }
    const handle = runtime.watchReadable(endpoints.input, (): void =>
      finish(endpoints.input),
    );
    watch = handle;
    const launched = threads.start(threads.entry, base + 1);
    if (launched <= 0)
      throw new Error("worker thread creation failed: " + String(launched));
    thread = launched;
    detachStatus = threads.detach(launched);
    return {
      threadId,
      ref: (): void => {
        handle.ref();
      },
      unref: (): void => {
        handle.unref();
      },
      hasRef: (): boolean => handle.hasRef(),
      requestStop,
    };
  } catch (error) {
    // Once started, the child owns its pipe duplicates and the record until
    // the exit notification. The watcher still performs the cleanup.
    if (thread === 0) release();
    throw error;
  }
}

/** Invoke an image-local module entry in the newly created context. The app
 * dispatches tagged worker arguments here before running its main module. */
export function runNativeWorker(
  memory: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  argument: number,
  evaluate: (
    moduleId: number,
    threadId: number,
    control: NativeWorkerTurnControl,
  ) => number,
): number {
  if (!integer(argument) || argument < 2 || argument % 2 !== 1)
    throw "NATIVE_WORKER_ENTRY_ARGUMENT";
  const base = argument - 1;
  const record = { base, byteLength: MAPPING_BYTES, engineId: base };
  const scratch = new Uint32Array(2);
  if (readNumber(memory, record, MARKER, scratch) !== MAGIC) return 70;
  const errors = attachNativeAgentMailbox(memory, parking, {
    base: readNumber(memory, record, ERROR_QUEUE, scratch),
    byteLength: MAPPING_BYTES,
    engineId: base,
  });
  if (!errors.ok) return 70;
  const moduleId = readNumber(memory, record, MODULE_ID, scratch);
  const threadId = readNumber(memory, record, THREAD_ID, scratch);
  function stopRequested(): boolean {
    return (
      readNumber(memory, record, nativeWorkerStopStateOffset, scratch) !== 0
    );
  }
  let waiters: NativeWaitRegistry | undefined;
  const waitRegistry = readNumber(memory, record, WAIT_REGISTRY, scratch);
  if (waitRegistry !== 0) {
    const attached = attachNativeWaitRegistry(memory, parking, {
      base: waitRegistry,
      byteLength: readNumber(memory, record, WAIT_REGISTRY_BYTES, scratch),
      engineId: readNumber(memory, record, WAIT_ENGINE, scratch),
    });
    if (!attached.ok) return 70;
    waiters = attached.value;
  }
  function parkWait(
    ticket: number,
    timeout: number,
  ): SharedResult<number> | undefined {
    const active = waiters;
    if (active === undefined) throw "NATIVE_WORKER_WAIT_REGISTRY";
    // Publish before testing the stop flag. Either the owner observes this
    // ticket and expires it, or this thread observes stop before parking.
    writeNumber(memory, record, WAIT_TICKET, ticket);
    try {
      if (stopRequested()) return undefined;
      const result = active.park(ticket, timeout);
      return stopRequested() ? undefined : result;
    } finally {
      writeNumber(memory, record, WAIT_TICKET, 0);
    }
  }
  // Script cannot produce a native closure as a thrown value. Its existing
  // engine-abort boundary propagates this marker past JavaScript catches.
  function waitInterrupted(): void {}
  function interruptibleWaiting(
    waiting: SharedBlockWaiting,
  ): SharedBlockWaiting {
    const active = waiters;
    if (active === undefined || waiting.registryId !== active.registry.base)
      throw "NATIVE_WORKER_WAIT_REGISTRY";
    return {
      registryId: active.registry.base,
      register: (
        handle,
        offset,
        width,
        lo,
        hi,
        zero,
      ): SharedResult<SharedWaitRegistration> =>
        waiting.register(handle, offset, width, lo, hi, zero),
      poll: (ticket): SharedResult<SharedWaitState> => {
        const state = waiting.poll(ticket);
        if (stopRequested()) throw waitInterrupted;
        return state;
      },
      order: (ticket): SharedResult<number> => active.order(ticket),
      expire: (ticket): SharedResult<boolean> => waiting.expire(ticket),
      take: (ticket): SharedResult<SharedWaitState> => waiting.take(ticket),
      park: (ticket, timeout): SharedResult<number> => {
        const result = parkWait(ticket, timeout);
        if (result === undefined) throw waitInterrupted;
        return result;
      },
      now: (): number => waiting.now(),
    };
  }
  const control: NativeWorkerTurnControl = {
    input: readNumber(memory, record, CONTROL_INPUT, scratch),
    stopRequested,
    waiters,
    parkWait,
    interruptibleWaiting,
    claimParentPort: (ports): NativeMessagePort | undefined => {
      const base = readNumber(memory, record, PARENT_PORT, scratch);
      if (base === 0) return undefined;
      const adopted = ports.adopt({
        base,
        side: readNumber(memory, record, PORT_SIDE, scratch),
        generation: readNumber(memory, record, PORT_GENERATION, scratch),
      });
      writeNumber(memory, record, PARENT_PORT, 0);
      return adopted;
    },
  };
  writeNumber(memory, record, ENTERED, 1);
  if (stopRequested()) return 1;
  try {
    const status = evaluate(moduleId, threadId, control);
    if (!integer(status) || status > 255) throw "invalid worker exit status";
    return stopRequested() ? 1 : status;
  } catch (error) {
    if (
      error === waitInterrupted ||
      readNumber(memory, record, nativeWorkerStopStateOffset, scratch) ===
        nativeWorkerStopObserved
    )
      return 1;
    const text =
      typeof error === "string" ? error : "uncaught worker exception";
    if (errors.value.send(text).ok) return 1;
    writeNumber(memory, record, ENTERED, 0);
    return 70;
  }
}

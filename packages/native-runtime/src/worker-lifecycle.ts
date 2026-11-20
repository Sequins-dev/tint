import {
  nativeThreadExitReadOffset,
  nativeThreadExitWriteOffset,
} from "@tint/abi/host";
import {
  createNativeAgentMailbox,
  attachNativeAgentMailbox,
} from "./agent-messages.ts";
import type { EventLoopHandle } from "./event-loop.ts";
import type { ReactorEventLoop } from "./event-loop-reactor.ts";
import {
  integer,
  readNumber,
  writeNumber,
  type NativeSharedMemoryHost,
} from "./shared-memory-host.ts";
import type { NativeWaiterParkingHost } from "./shared-waiters.ts";

export interface WorkerExitPipe {
  readonly input: number;
  readonly childOutput: number;
  readonly childReadGuard: number;
}

export interface NativeWorkerThreadHost {
  readonly entry: number;
  /** Both ends are nonblocking. The caller owns all three descriptors. */
  exitPipe(): WorkerExitPipe;
  read(fd: number, bytes: Uint8Array): number;
  close(fd: number): void;
  start(entry: number, argument: number): number;
  detach(thread: number): number;
}

export interface NativeWorkerLifecycle {
  readonly threadId: number;
  ref(): void;
  unref(): void;
  hasRef(): boolean;
}

export interface NativeWorkerRequest {
  readonly threadId: number;
  readonly moduleId: number;
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
  let watch: EventLoopHandle | undefined;
  let thread = 0;
  let detachStatus = 0;

  function release(): void {
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
    if (
      memory.unmapMemory(errors.registry.base, MAPPING_BYTES) !== 0 ||
      memory.unmapMemory(base, MAPPING_BYTES) !== 0
    )
      throw "NATIVE_WORKER_RELEASE";
  }
  function finish(fd: number): void {
    let count = threads.read(fd, bytes);
    while (count === -4) count = threads.read(fd, bytes);
    const status = readNumber(memory, record, 0, scratch);
    if (count < 0 || status === 0 || status > 256)
      throw "NATIVE_WORKER_EXIT_RECORD";
    const failure = errors.receive();
    const entered = readNumber(memory, record, ENTERED, scratch) !== 0;
    if (detachStatus !== 0) detachStatus = threads.detach(thread);
    release();
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
  evaluate: (moduleId: number, threadId: number) => number,
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
  writeNumber(memory, record, ENTERED, 1);
  try {
    const status = evaluate(moduleId, threadId);
    if (!integer(status) || status > 255) throw "invalid worker exit status";
    return status;
  } catch (error) {
    const text =
      typeof error === "string" ? error : "uncaught worker exception";
    if (errors.value.send(text).ok) return 1;
    writeNumber(memory, record, ENTERED, 0);
    return 70;
  }
}

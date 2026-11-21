import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The baseline fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const blocks = "packages/native-runtime/src/shared-blocks.ts";
const messages = "packages/native-runtime/src/agent-messages.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const bindings = [
  [clock, "monotonicMilliseconds", "monotonic-time"],
  [memory, "mapMemory", "memory-map"],
  [memory, "unmapMemory", "memory-unmap"],
  [memory, "readMemoryWord", "memory-read-word"],
  [memory, "writeMemoryWord", "memory-write-word"],
  [memory, "loadAcquireMemoryWord", "memory-load-acquire-word"],
  [memory, "storeReleaseMemoryWord", "memory-store-release-word"],
  [memory, "startNativeThread", "thread-start"],
  [memory, "joinNativeThread", "thread-join"],
  [memory, "hostedThreadEntry", "hosted-thread-entry"],
  [memory, "parkNativeWord", "word-park"],
  [memory, "wakeNativeWord", "word-wake"],
  [shared, "readSharedUnsigned", "shared-read-unsigned"],
  [shared, "writeSharedUnsigned", "shared-write-unsigned"],
  [shared, "readSharedWord64", "shared-read-word64"],
  [shared, "writeSharedWord64", "shared-write-word64"],
  [shared, "compareExchangeSharedWord64", "shared-compare-exchange-word64"],
] as const;

verifyHostedFixture(
  `
import {
  mapMemory, unmapMemory, readMemoryWord, writeMemoryWord,
  loadAcquireMemoryWord, storeReleaseMemoryWord,
  startNativeThread, joinNativeThread, hostedThreadEntry,
  parkNativeWord, wakeNativeWord,
} from 'memory';
import { monotonicMilliseconds } from 'clock';
import { nativeSharedMemoryHost, nativeWaiterParkingHost } from 'blocks';
import {
  createNativeAgentMailbox, attachNativeAgentMailbox, NativeAgentMailbox,
} from 'messages';

const mappingBytes = 16384;
const workerCount = 32;
const rowBytes = 128;
const requestMailbox = 0;
const replyMailbox = 8;
const requestSequence = 16;
const replySequence = 24;
const idle = 32;
const engineId = 91;
const warmup = 128;
const samples = 4096;

function publish(row: number, offset: number, sequence: number): void {
  if (storeReleaseMemoryWord(row, rowBytes, offset, sequence) !== 0)
    throw "baseline signal write failed";
  wakeNativeWord(row + offset, 0);
}

function awaitSequence(row: number, offset: number, sequence: number): void {
  const deadline = monotonicMilliseconds() + 5000;
  while (true) {
    const observed = loadAcquireMemoryWord(row, rowBytes, offset);
    if (observed === sequence) return;
    const remaining = deadline - monotonicMilliseconds();
    if (observed < 0 || observed > sequence || remaining <= 0)
      throw "baseline signal failed";
    parkNativeWord(row + offset, observed, Math.ceil(remaining * 1000000));
  }
}

function payload(queue: NativeAgentMailbox): string {
  const value = queue.receive();
  if (value === undefined) throw "baseline lost message";
  return value;
}

function worker(row: number): number {
  const host = nativeSharedMemoryHost(), parking = nativeWaiterParkingHost();
  const request = attachNativeAgentMailbox(host, parking, {
    base: readMemoryWord(row, rowBytes, requestMailbox), byteLength: mappingBytes, engineId,
  });
  const reply = attachNativeAgentMailbox(host, parking, {
    base: readMemoryWord(row, rowBytes, replyMailbox), byteLength: mappingBytes, engineId,
  });
  if (!request.ok || !reply.ok) return 11;
  publish(row, replySequence, 1);
  for (let sequence = 1; ; sequence++) {
    awaitSequence(row, requestSequence, sequence);
    const message = payload(request.value);
    if (message === "stop") return 0;
    if (!reply.value.send(message).ok) return 12;
    publish(row, replySequence, sequence + 1);
  }
}

function sampleWindow(row: number, marker: string): void {
  console.log(marker);
  const deadline = monotonicMilliseconds() + 1000;
  while (true) {
    const remaining = deadline - monotonicMilliseconds();
    if (remaining <= 0) return;
    parkNativeWord(row + idle, 0, Math.ceil(remaining * 1000000));
  }
}

export function run(argument: number): number {
  if (argument !== 0) return worker(argument);
  const host = nativeSharedMemoryHost(), parking = nativeWaiterParkingHost();
  const rows = mapMemory(mappingBytes);
  if (rows <= 0) return 1;
  const handles = new Float64Array(workerCount);
  const requests: NativeAgentMailbox[] = [];
  const replies: NativeAgentMailbox[] = [];

  for (let i = 0; i < workerCount; i++) {
    const row = rows + i * rowBytes;
    const request = createNativeAgentMailbox(host, parking, engineId);
    const reply = createNativeAgentMailbox(host, parking, engineId);
    if (!request.ok || !reply.ok) return 2;
    requests.push(request.value);
    replies.push(reply.value);
    if (writeMemoryWord(row, rowBytes, requestMailbox, request.value.registry.base) !== 0)
      return 3;
    if (writeMemoryWord(row, rowBytes, replyMailbox, reply.value.registry.base) !== 0)
      return 4;
  }

  sampleWindow(rows, "BASELINE_RSS before");
  for (let i = 0; i < workerCount; i++) {
    const row = rows + i * rowBytes;
    const started = monotonicMilliseconds();
    const handle = startNativeThread(hostedThreadEntry(), row);
    if (handle <= 0) return 5;
    handles[i] = handle;
    awaitSequence(row, replySequence, 1);
    console.log("BASELINE_CREATE_US " + String((monotonicMilliseconds() - started) * 1000));
  }
  sampleWindow(rows, "BASELINE_RSS workers");

  const request = requests[0], reply = replies[0];
  if (request === undefined || reply === undefined) return 6;
  let started = 0;
  for (let i = 1; i <= warmup + samples; i++) {
    if (i === warmup + 1) started = monotonicMilliseconds();
    if (!request.send("0123456789abcdef").ok) return 7;
    publish(rows, requestSequence, i);
    awaitSequence(rows, replySequence, i + 1);
    if (payload(reply) !== "0123456789abcdef") return 8;
  }
  console.log("BASELINE_RTT_US " + String((monotonicMilliseconds() - started) * 1000 / samples));

  for (let i = 0; i < workerCount; i++) {
    const request = requests[i], reply = replies[i];
    if (request === undefined || reply === undefined || !request.send("stop").ok)
      return 9;
    publish(rows + i * rowBytes, requestSequence, i === 0 ? warmup + samples + 1 : 1);
    if (joinNativeThread(handles[i] ?? 0) !== 0) return 10;
    if (unmapMemory(request.registry.base, mappingBytes) !== 0 ||
        unmapMemory(reply.registry.base, mappingBytes) !== 0)
      return 13;
  }
  return unmapMemory(rows, mappingBytes) === 0 ? 42 : 14;
}
`,
  "event-loop-baseline-v1",
  [
    ["memory", memory],
    ["clock", clock],
    ["blocks", blocks],
    ["messages", messages],
  ],
  [],
  [],
  [memory, shared, clock].map((module, index) => ({
    module,
    namespace: "event-loop-baseline-" + index,
    retainedExports: bindings
      .filter((binding) => binding[0] === module)
      .map((binding) => binding[1]),
  })),
  {
    threaded: true,
    managedBytes: 4194304,
    allocationCapacity: 65536,
    runtimeEntry: "initializeCopyingRuntime",
    hostBindings: bindings.map(([module, name, operation]) => ({
      module,
      name,
      operation,
    })),
  },
);

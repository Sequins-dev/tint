import {
  openFragmentActor,
  type Emission,
  type EmissionRange,
  type FragmentForms,
  type FragmentReply,
  type PreparedEmissionAttempt,
} from "@tint/codegen/aarch64/scalar";
import type { ModuleIR } from "@tint/ir/scalar";
import { createReactorEventLoop } from "@tint/native-runtime/event-loop";
import { monotonicMilliseconds } from "@tint/native-runtime/intrinsics/clock";
import {
  collectGarbage,
  memoryPageBytes,
} from "@tint/native-runtime/intrinsics/memory";
import {
  nativeSharedMemoryHost,
  nativeWaiterParkingHost,
} from "@tint/native-runtime/shared-blocks";
import {
  createNativeMessagePorts,
  nativeAgentPacketHeader,
  nativePacketMemory,
  runNativeWorker,
  startNativeWorker,
  type NativeAgentPacketEntry,
  type NativeMessagePort,
  type NativeMessagePortGrant,
  type NativePacketMemory,
  type NativeWorkerLifecycle,
  type NativeWorkerTurnControl,
} from "@tint/native-runtime/workers";
import type { FileHost } from "@tint/platform/files/service";
import { createParallelPlatformHost } from "@tint/platform/parallel-host";
import {
  openPreparedMacOSBuild,
  type BuildRequest,
  type BuildResult,
} from "./build.ts";
import { createFileSpillBackend } from "./spill-files.ts";
import {
  admitEmissionWorkers,
  decodeErrorMessage,
  decodeInitMessage,
  decodeJobMessage,
  decodeReplyHeader,
  defaultResultCreditBytes,
  defaultWorkerStackBytes,
  encodeErrorMessage,
  encodeInitMessage,
  encodeJobMessage,
  encodeReplyHeader,
  estimateRangeCreditBytes,
  messageErrorTag,
  messageInitTag,
  messageJobTag,
  messageReadyTag,
  messageReplyTag,
  messageShutdownTag,
  planEmissionRanges,
} from "./parallel-policy.ts";

export interface ParallelBuildOptions {
  readonly workers: number;
  readonly spillDirectory: string;
  readonly workerHeapBytes: number;
  readonly memoryBudgetBytes: number | undefined;
  readonly reportStats: boolean;
  readonly host: FileHost<number>;
  readonly report: (message: string) => void;
}

const fragmentWorkerModuleId = 1;
const MiB = 1048576;

function formatMiB(bytes: number): string {
  return String(Math.round((bytes / MiB) * 10) / 10) + " MiB";
}

function sendRaw(
  port: NativeMessagePort,
  packetMem: NativePacketMemory,
  payload: Uint8Array,
): boolean {
  const packet = port.allocate(payload.length);
  const view = packetMem.view(
    packet.base + nativeAgentPacketHeader,
    payload.length,
  );
  view.set(payload, 0);
  const sent = port.send(packet, payload.length);
  if (!sent) port.release(packet);
  return sent;
}

function sendTwoPart(
  port: NativeMessagePort,
  packetMem: NativePacketMemory,
  header: Uint8Array,
  body: Uint8Array,
): boolean {
  const total = header.length + body.length;
  const packet = port.allocate(total);
  const view = packetMem.view(packet.base + nativeAgentPacketHeader, total);
  view.set(header, 0);
  view.set(body, header.length);
  const sent = port.send(packet, total);
  if (!sent) port.release(packet);
  return sent;
}

function sendSingleByte(
  port: NativeMessagePort,
  packetMem: NativePacketMemory,
  tag: number,
): boolean {
  const bytes = new Uint8Array(1);
  bytes[0] = tag;
  return sendRaw(port, packetMem, bytes);
}

/** Worker isolate entrypoint dispatched from `mainThreaded` when the native
 * startup argument is a tagged worker startup record. */
export function runFragmentWorker(argument: number): number {
  const platform = createParallelPlatformHost();
  if (platform === undefined) return 70;
  const loop = createReactorEventLoop({
    createReactor: () => platform.createReactor(),
    drainMicrotasks: (): void => {},
    now: (): number => monotonicMilliseconds(),
    onWake: (): void => {},
  });
  const memory = nativeSharedMemoryHost(),
    parking = nativeWaiterParkingHost(),
    threads = platform.createWorkerThreadHost(),
    packetMem = nativePacketMemory();
  const ports = createNativeMessagePorts(
    memory,
    parking,
    threads,
    loop,
    (_entry: NativeAgentPacketEntry): void => {},
  );
  try {
    return runNativeWorker(
      memory,
      parking,
      argument,
      (
        moduleId: number,
        _threadId: number,
        control: NativeWorkerTurnControl,
      ): number => {
        if (moduleId !== fragmentWorkerModuleId) return 70;
        const claimed = control.claimParentPort(ports);
        if (claimed === undefined) return 70;
        const endpoint: NativeMessagePort = claimed;
        let actor:
          | ((
              forms: FragmentForms,
              range: EmissionRange,
            ) => FragmentReply | undefined)
          | undefined;
        let ranges: readonly EmissionRange[] = [];
        let shuttingDown = false;
        function shutdown(): void {
          if (shuttingDown) return;
          shuttingDown = true;
          actor = undefined;
          ranges = [];
          endpoint.close();
        }
        endpoint.watch(
          (entry: NativeAgentPacketEntry): void => {
            try {
              const payload = packetMem.view(
                entry.packet.base + nativeAgentPacketHeader,
                entry.used,
              );
              const tag = payload[0] ?? 0;
              if (tag === messageShutdownTag) {
                endpoint.release(entry.packet);
                shutdown();
                return;
              }
              if (tag === messageInitTag) {
                const init = decodeInitMessage(payload);
                endpoint.release(entry.packet);
                const preparation = packetMem.view(
                  init.wireBase,
                  init.preparationBytes,
                );
                const bodies = packetMem.view(
                  init.wireBase + init.preparationBytes,
                  init.bodyBytes,
                );
                ranges = init.ranges;
                actor = openFragmentActor(
                  { preparation, bodies },
                  init.options,
                );
                if (!sendSingleByte(endpoint, packetMem, messageReadyTag))
                  shutdown();
                return;
              }
              if (tag === messageJobTag) {
                const job = decodeJobMessage(payload);
                endpoint.release(entry.packet);
                const run = actor;
                const range = ranges[job.rangeIndex];
                if (run === undefined || range === undefined) {
                  sendRaw(
                    endpoint,
                    packetMem,
                    encodeErrorMessage(
                      job.rangeIndex,
                      "worker received job before init",
                    ),
                  );
                  shutdown();
                  return;
                }
                let reply: FragmentReply | undefined;
                try {
                  reply = run(job.forms, range);
                } catch (error) {
                  const message =
                    typeof error === "string"
                      ? error
                      : "worker actor threw an exception";
                  sendRaw(
                    endpoint,
                    packetMem,
                    encodeErrorMessage(job.rangeIndex, message),
                  );
                  shutdown();
                  return;
                }
                if (reply === undefined) {
                  sendRaw(
                    endpoint,
                    packetMem,
                    encodeErrorMessage(
                      job.rangeIndex,
                      "fragment actor returned undefined",
                    ),
                  );
                  shutdown();
                  return;
                }
                const header = encodeReplyHeader(
                  job.rangeIndex,
                  reply.forms,
                  reply.bytes.length,
                );
                if (!sendTwoPart(endpoint, packetMem, header, reply.bytes))
                  shutdown();
                return;
              }
              endpoint.release(entry.packet);
              sendRaw(
                endpoint,
                packetMem,
                encodeErrorMessage(-1, "unknown worker message tag"),
              );
              shutdown();
            } catch (error) {
              endpoint.release(entry.packet);
              const message =
                typeof error === "string"
                  ? error
                  : "worker message dispatch failed";
              sendRaw(endpoint, packetMem, encodeErrorMessage(-1, message));
              shutdown();
            }
          },
          (): void => {
            shutdown();
          },
        );
        try {
          loop.loop.run("callback");
        } finally {
          shutdown();
        }
        return 0;
      },
    );
  } finally {
    loop.close();
  }
}

interface WorkerLane {
  readonly id: number;
  readonly port: NativeMessagePort;
  readonly lifecycle: NativeWorkerLifecycle;
  ready: boolean;
  assigned: number;
  credit: number;
  closed: boolean;
  exited: boolean;
}

/** Execute one prepared fragment emission using native worker isolates, a
 * single immutable OS-mapped wire generation, credit-bounded result spilling,
 * and strict worker join + wire release before placement, retry, or fallback. */
export function buildParallelMacOSProgram(
  request: BuildRequest,
  options: ParallelBuildOptions,
): BuildResult {
  const platform = createParallelPlatformHost();
  if (platform === undefined)
    return {
      ok: false,
      error: {
        stage: "parallel",
        message: "parallel worker emission is unavailable on this host target",
      },
    };
  const target = request.target;
  if (target !== undefined && target.arch !== "aarch64")
    return {
      ok: false,
      error: {
        stage: "parallel",
        message: "parallel worker emission supports only AArch64 targets",
      },
    };
  const targetOs: "darwin" | "linux" =
    target !== undefined && target.os === "linux" ? "linux" : "darwin";
  const host: FileHost<number> = options.host;
  const packetSpill = createFileSpillBackend(
    host,
    options.spillDirectory + "/tint-packets",
  );
  const report = options.report;
  const reportStats = options.reportStats;
  const memory = nativeSharedMemoryHost(),
    parking = nativeWaiterParkingHost(),
    threads = platform.createWorkerThreadHost(),
    packetMem = nativePacketMemory();
  const page = Math.max(4096, memoryPageBytes());
  let afterSealRss = 0;
  let wireBase = 0,
    wireReservation = 0,
    wireSegment: number | undefined;
  function unmapWire(): void {
    if (wireBase === 0) return;
    const base = wireBase,
      length = wireReservation;
    wireBase = 0;
    wireReservation = 0;
    memory.unmapMemory(base, length);
  }
  function releaseWireSpill(): void {
    const segment = wireSegment;
    if (segment === undefined) return;
    wireSegment = undefined;
    packetSpill.release(segment);
  }
  const targetJobs = Math.min(32, Math.max(8, options.workers * 8));
  const opened = openPreparedMacOSBuild(
    {
      ...request,
      storage: {
        policy: "all",
        directory: options.spillDirectory,
        files: host,
      },
    },
    {
      planRanges: (module: ModuleIR): readonly EmissionRange[] =>
        planEmissionRanges(module, targetJobs),
      packets: packetSpill,
      afterPreparation: (): void => {
        afterSealRss = platform.residentSetBytes();
      },
    },
  );
  if (!opened.ok) {
    packetSpill.close();
    return opened;
  }
  const build = opened.value;
  try {
    const start = build.start;
    if (start.kind === "done") return build.finish(start.emission);
    if (start.kind === "serial") return build.finish(build.emitSerial());
    const session = start.session;
    const prepLen = session.input.preparation.length;
    const bodyLen = session.input.bodies.length;
    const wireLen = prepLen + bodyLen;
    wireReservation = Math.ceil(Math.max(1, wireLen) / page) * page;
    const mapped = memory.mapMemory(wireReservation);
    if (mapped <= 0) {
      session.attempt.abort();
      return build.finish(session.emitSerialFallback());
    }
    wireBase = mapped;
    const wireView = packetMem.view(wireBase, wireLen);
    wireView.set(session.input.preparation, 0);
    wireView.set(session.input.bodies, prepLen);
    // Drop the managed copies of the wire before releasing decoded IR pages.
    session.releaseInput();
    const beforeGcRss =
      afterSealRss > 0 ? afterSealRss : platform.residentSetBytes();
    collectGarbage();
    const afterGcRss = platform.residentSetBytes();
    const admission = admitEmissionWorkers({
      requestedWorkers: options.workers,
      rangeCount: build.ranges.length,
      coordinatorRssBytes: afterGcRss,
      wireBytes: wireReservation,
      workerHeapBytes: options.workerHeapBytes,
      workerStackBytes: defaultWorkerStackBytes,
      resultCreditBytes: defaultResultCreditBytes,
      memoryBudgetBytes: options.memoryBudgetBytes,
    });
    if (reportStats)
      report(
        "parallel-emission: wire=" +
          formatMiB(wireLen) +
          " ranges=" +
          String(build.ranges.length) +
          " after-seal=" +
          formatMiB(beforeGcRss) +
          " after-gc=" +
          formatMiB(afterGcRss) +
          " admitted=" +
          String(admission.workers) +
          "/" +
          String(options.workers) +
          " (" +
          admission.reason +
          ") worker-heap=" +
          formatMiB(options.workerHeapBytes),
      );
    if (admission.workers <= 0) {
      unmapWire();
      session.attempt.abort();
      return build.finish(session.emitSerialFallback());
    }

    let currentAttempt: PreparedEmissionAttempt = session.attempt;
    let dispatchPeakRss = afterGcRss;
    let attemptIndex = 0;
    let nextThreadId = 1;
    let finalEmission: Emission | undefined;

    for (;;) {
      attemptIndex++;
      // Ensure the single immutable wire generation is mapped for this attempt.
      if (wireBase === 0) {
        const segment = wireSegment;
        if (segment === undefined) {
          currentAttempt.abort();
          finalEmission = session.emitSerialFallback();
          break;
        }
        const restored = packetSpill.read(segment);
        const remapped = memory.mapMemory(wireReservation);
        if (remapped <= 0 || restored.length !== wireLen) {
          if (remapped > 0) memory.unmapMemory(remapped, wireReservation);
          currentAttempt.abort();
          finalEmission = session.emitSerialFallback();
          break;
        }
        wireBase = remapped;
        packetMem.view(wireBase, wireLen).set(restored, 0);
      }

      const initPayload = encodeInitMessage({
        wireBase,
        preparationBytes: prepLen,
        bodyBytes: bodyLen,
        targetOs,
        options: build.options,
        ranges: currentAttempt.ranges,
      });
      const attemptForms = currentAttempt.forms;
      const attemptRanges = currentAttempt.ranges;
      const rangeCount = attemptRanges.length;
      const workerCount = Math.min(admission.workers, rangeCount);
      const totalCredits = admission.resultCreditBytes;

      const loop = createReactorEventLoop({
        createReactor: () => platform.createReactor(),
        drainMicrotasks: (): void => {},
        now: (): number => monotonicMilliseconds(),
        onWake: (): void => {},
      });
      const ports = createNativeMessagePorts(
        memory,
        parking,
        threads,
        loop,
        (_entry: NativeAgentPacketEntry): void => {},
      );
      const lanes: WorkerLane[] = [];
      let nextRange = 0,
        completed = 0,
        inFlight = 0,
        usedCredits = 0,
        alive = 0;
      let failureReason: string | undefined;

      function closeLane(lane: WorkerLane, stop: boolean): void {
        if (!lane.closed) {
          lane.closed = true;
          sendSingleByte(lane.port, packetMem, messageShutdownTag);
          lane.port.close();
        }
        if (stop && !lane.exited) lane.lifecycle.requestStop();
      }

      function failAll(reason: string): void {
        if (failureReason === undefined) failureReason = reason;
        for (const lane of lanes) if (lane !== undefined) closeLane(lane, true);
      }

      function dispatchIdle(): void {
        if (failureReason !== undefined) return;
        for (const lane of lanes) {
          if (
            lane === undefined ||
            lane.closed ||
            lane.exited ||
            !lane.ready ||
            lane.assigned >= 0
          )
            continue;
          if (nextRange >= rangeCount) {
            closeLane(lane, false);
            continue;
          }
          const weight = build.rangeWeights[nextRange] ?? 1024;
          const credit = estimateRangeCreditBytes(weight, totalCredits);
          if (inFlight > 0 && usedCredits + credit > totalCredits) break;
          const jobIndex = nextRange++;
          lane.assigned = jobIndex;
          lane.credit = credit;
          inFlight++;
          usedCredits += credit;
          const sent = sendRaw(
            lane.port,
            packetMem,
            encodeJobMessage({ rangeIndex: jobIndex, forms: attemptForms }),
          );
          if (!sent) {
            failAll("failed to send fragment job to worker");
            return;
          }
        }
      }

      try {
        for (let slot = 0; slot < workerCount; slot++) {
          const pair = ports.create();
          const workerGrant = pair.second.transfer();
          const threadId = nextThreadId++;
          const hostPort = pair.first;
          const laneIndex = lanes.length;
          let lifecycle: NativeWorkerLifecycle;
          try {
            lifecycle = startNativeWorker(memory, parking, threads, loop, {
              threadId,
              moduleId: fragmentWorkerModuleId,
              heapBytes: options.workerHeapBytes,
              stackBytes: defaultWorkerStackBytes,
              parentPort: workerGrant,
              onUnclaimedParentPort: (grant: NativeMessagePortGrant): void =>
                ports.discard(grant),
              onError: (message: string, _code?: string): void => {
                failAll("worker " + String(threadId) + " error: " + message);
              },
              onExit: (status: number): void => {
                alive--;
                const current = lanes[laneIndex];
                if (current !== undefined) {
                  current.exited = true;
                  if (current.assigned >= 0) {
                    inFlight--;
                    usedCredits = Math.max(0, usedCredits - current.credit);
                    current.assigned = -1;
                    current.credit = 0;
                    failAll(
                      "worker " +
                        String(threadId) +
                        " exited while range was in flight (status " +
                        String(status) +
                        ")",
                    );
                  } else if (status !== 0) {
                    failAll(
                      "worker " +
                        String(threadId) +
                        " exited with status " +
                        String(status),
                    );
                  }
                  if (!current.closed) {
                    current.closed = true;
                    current.port.close();
                  }
                }
              },
            });
          } catch (error) {
            ports.discard(workerGrant);
            hostPort.close();
            failAll(
              typeof error === "string"
                ? error
                : "failed to start native emission worker",
            );
            break;
          }
          alive++;
          const lane: WorkerLane = {
            id: threadId,
            port: hostPort,
            lifecycle,
            ready: false,
            assigned: -1,
            credit: 0,
            closed: false,
            exited: false,
          };
          lanes.push(lane);
          hostPort.watch(
            (entry: NativeAgentPacketEntry): void => {
              const payload = packetMem.view(
                entry.packet.base + nativeAgentPacketHeader,
                entry.used,
              );
              const tag = payload[0] ?? 0;
              if (tag === messageReadyTag) {
                hostPort.release(entry.packet);
                lane.ready = true;
                dispatchIdle();
                return;
              }
              if (tag === messageReplyTag) {
                const header = decodeReplyHeader(payload);
                const range = attemptRanges[header.rangeIndex];
                if (
                  range === undefined ||
                  header.rangeIndex !== lane.assigned ||
                  header.packetOffset + header.packetByteLength > entry.used
                ) {
                  hostPort.release(entry.packet);
                  failAll("invalid fragment reply from worker");
                  return;
                }
                const packetBytes = payload.subarray(
                  header.packetOffset,
                  header.packetOffset + header.packetByteLength,
                );
                // Spill the sealed packet immediately, then release the
                // transfer mapping before returning result credits.
                try {
                  currentAttempt.submit({
                    range,
                    bytes: packetBytes,
                    forms: header.forms,
                  });
                } catch (error) {
                  hostPort.release(entry.packet);
                  failAll(
                    typeof error === "string"
                      ? error
                      : "failed to spill fragment packet",
                  );
                  return;
                }
                hostPort.release(entry.packet);
                completed++;
                inFlight--;
                usedCredits = Math.max(0, usedCredits - lane.credit);
                lane.assigned = -1;
                lane.credit = 0;
                const sample = platform.residentSetBytes();
                if (sample > dispatchPeakRss) dispatchPeakRss = sample;
                dispatchIdle();
                return;
              }
              if (tag === messageErrorTag) {
                const err = decodeErrorMessage(payload);
                hostPort.release(entry.packet);
                failAll("worker error: " + err.message);
                return;
              }
              hostPort.release(entry.packet);
              failAll("unexpected coordinator message tag");
            },
            (): void => {
              if (!lane.closed) {
                lane.closed = true;
                lane.port.close();
              }
              if (lane.assigned >= 0)
                failAll("worker closed port with range in flight");
            },
          );
          if (!sendRaw(hostPort, packetMem, initPayload)) {
            failAll("failed to send prepared wire init to worker");
            break;
          }
        }
        // Drive the real event loop until every worker has exited (joined).
        loop.loop.run("callback");
      } finally {
        for (const lane of lanes)
          if (lane !== undefined && !lane.closed) {
            lane.closed = true;
            lane.port.close();
          }
        loop.close();
      }

      if (
        failureReason !== undefined ||
        completed !== rangeCount ||
        alive !== 0
      ) {
        if (reportStats)
          report(
            "parallel-emission: fallback to serial after attempt " +
              String(attemptIndex) +
              " (" +
              (failureReason ?? "incomplete ranges") +
              ")",
          );
        unmapWire();
        releaseWireSpill();
        currentAttempt.abort();
        finalEmission = session.emitSerialFallback();
        break;
      }

      // Spill the immutable wire once if not yet spilled, then unmap the wire
      // generation BEFORE final placement so neither workers nor wire overlap
      // with placement buffers.
      if (wireSegment === undefined && wireBase !== 0)
        wireSegment = packetSpill.write(packetMem.view(wireBase, wireLen));
      unmapWire();
      const afterJoinRss = platform.residentSetBytes();
      const outcome = currentAttempt.finish();
      const afterPlacementRss = platform.residentSetBytes();
      if (reportStats)
        report(
          "parallel-emission: attempt=" +
            String(attemptIndex) +
            " outcome=" +
            outcome.kind +
            " dispatch-peak=" +
            formatMiB(dispatchPeakRss) +
            " after-join=" +
            formatMiB(afterJoinRss) +
            " after-placement=" +
            formatMiB(afterPlacementRss),
        );
      if (outcome.kind === "done") {
        releaseWireSpill();
        finalEmission = outcome.emission;
        break;
      }
      if (outcome.kind === "serial") {
        releaseWireSpill();
        finalEmission = session.emitSerialFallback();
        break;
      }
      currentAttempt = outcome.attempt;
    }

    if (finalEmission === undefined)
      return {
        ok: false,
        error: {
          stage: "emit",
          message: "parallel emission produced no result",
        },
      };
    return build.finish(finalEmission);
  } catch (error) {
    build.abort();
    throw error;
  } finally {
    unmapWire();
    releaseWireSpill();
    packetSpill.close();
    build.abort();
  }
}

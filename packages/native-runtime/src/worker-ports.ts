import {
  attachNativeAgentMailbox,
  createNativeAgentMailbox,
  type NativeAgentMailbox,
} from "./agent-messages.ts";
import type { ReactorEventLoop } from "./event-loop-reactor.ts";
import type { EventLoopHandle } from "./event-loop.ts";
import {
  compareNumber,
  readNumber,
  writeNumber,
  type NativeSharedMemoryHost,
  type NativeSharedBlockRegistry,
} from "./shared-memory-host.ts";
import type { NativeWaiterParkingHost } from "./shared-waiters.ts";
import type {
  NativeWorkerThreadHost,
  WorkerControlPipe,
} from "./worker-lifecycle.ts";

/** Unique ownership of one endpoint, carried as scalar data in a packet.
 * Internal to the product host. Every grant must be adopted or discarded once. */
export interface NativeMessagePortGrant {
  readonly base: number;
  readonly side: number;
  readonly generation: number;
}
export interface NativeMessagePort {
  /** The trusted commit runs after packet allocation, before publication.
   * False means the packet and its grants still belong to the caller. */
  send(packet: string, commit?: () => void): boolean;
  take(): string | undefined;
  watch(
    message: (packet: string) => void,
    peerClose: () => void,
  ): EventLoopHandle;
  inspect(): NativeMessagePortGrant | undefined;
  transfer(): NativeMessagePortGrant;
  close(): void;
}
export interface NativeMessagePortPair {
  readonly first: NativeMessagePort;
  readonly second: NativeMessagePort;
}
export interface NativeMessagePorts {
  create(): NativeMessagePortPair;
  adopt(grant: NativeMessagePortGrant): NativeMessagePort;
  discard(grant: NativeMessagePortGrant): void;
}

const PAGE = 16384;
const ENDPOINTS = 16;
const ENDPOINT_BYTES = 40;
const REMAINING = 8;
const STATE = 0;
const GENERATION = 8;
const INPUT = 16;
const OUTPUT = 24;
const MAILBOX = 32;
const OWNED = 1;
const IN_FLIGHT = 2;
const CLOSED = 3;
const INTERRUPTED = -4;

/** The pair lock protects endpoint state, publication and fd lifetime.
 * Packet preparation, decoding, callbacks and disposal run outside it. */
export function createNativeMessagePorts(
  memory: NativeSharedMemoryHost,
  parking: NativeWaiterParkingHost,
  threads: NativeWorkerThreadHost,
  reactor: ReactorEventLoop,
  disposePacket: (packet: string) => void,
): NativeMessagePorts {
  const scratch = new Uint32Array(2);
  const signal = new Uint8Array(1);
  const notifications = new Uint8Array(256);
  function registry(base: number): NativeSharedBlockRegistry {
    return { base, byteLength: PAGE, engineId: base };
  }
  function lock(pair: NativeSharedBlockRegistry): void {
    while (compareNumber(memory, pair, 0, 0, 1, scratch) !== 0)
      parking.park(pair.base, 1, 1000000);
  }
  function unlock(pair: NativeSharedBlockRegistry): void {
    writeNumber(memory, pair, 0, 0);
    parking.wake(pair.base);
  }
  function read(pair: NativeSharedBlockRegistry, offset: number): number {
    return readNumber(memory, pair, offset, scratch);
  }
  function write(
    pair: NativeSharedBlockRegistry,
    offset: number,
    value: number,
  ): void {
    writeNumber(memory, pair, offset, value);
  }
  function notify(fd: number): void {
    let status = threads.write(fd, signal);
    while (status === INTERRUPTED) status = threads.write(fd, signal);
    if (status !== 1 && status !== threads.wouldBlock)
      throw new Error("message port wake failed: " + String(status));
  }
  function endpoint(side: number): number {
    if (side !== 0 && side !== 1) throw "NATIVE_MESSAGE_PORT_SIDE";
    return ENDPOINTS + side * ENDPOINT_BYTES;
  }
  function mailbox(
    pair: NativeSharedBlockRegistry,
    offset: number,
  ): NativeAgentMailbox {
    const attached = attachNativeAgentMailbox(memory, parking, {
      base: read(pair, offset + MAILBOX),
      byteLength: PAGE,
      engineId: pair.engineId,
    });
    if (!attached.ok) throw "NATIVE_MESSAGE_PORT_MAILBOX";
    return attached.value;
  }
  function ensureLease(
    pair: NativeSharedBlockRegistry,
    local: number,
    generation: number,
    state: number,
  ): void {
    if (
      read(pair, local + GENERATION) !== generation ||
      read(pair, local + STATE) !== state
    )
      throw new Error("message port grant is no longer valid");
  }
  function releaseMemory(base: number): void {
    if (memory.unmapMemory(base, PAGE) !== 0)
      throw "NATIVE_MESSAGE_PORT_RELEASE";
  }
  function releaseEndpoint(
    grant: NativeMessagePortGrant,
    state: number,
    queue: NativeAgentMailbox,
  ): void {
    const pair = registry(grant.base);
    const local = endpoint(grant.side);
    const peer = endpoint(1 - grant.side);
    lock(pair);
    try {
      ensureLease(pair, local, grant.generation, state);
      write(pair, local + STATE, CLOSED);
      if (read(pair, peer + STATE) !== CLOSED)
        notify(read(pair, peer + OUTPUT));
    } finally {
      unlock(pair);
    }

    try {
      threads.close(read(pair, local + INPUT));
      threads.close(read(pair, local + OUTPUT));
      for (;;) {
        const packet = queue.receive();
        if (packet === undefined) break;
        disposePacket(packet);
      }
    } finally {
      // Once this decrement succeeds the other closer may unmap the pair.
      // Only the final owner accesses the record after dropping its lease.
      let remaining = read(pair, REMAINING);
      for (;;) {
        const observed = compareNumber(
          memory,
          pair,
          REMAINING,
          remaining,
          remaining - 1,
          scratch,
        );
        if (observed === remaining) break;
        remaining = observed;
      }
      if (remaining === 1) {
        releaseMemory(read(pair, local + MAILBOX));
        releaseMemory(read(pair, peer + MAILBOX));
        releaseMemory(pair.base);
      }
    }
  }
  function port(grant: NativeMessagePortGrant): NativeMessagePort {
    const pair = registry(grant.base);
    const local = endpoint(grant.side);
    const peer = endpoint(1 - grant.side);
    const input = read(pair, local + INPUT);
    const incoming = mailbox(pair, local);
    const outgoing = mailbox(pair, peer);
    function notifyPeer(): void {
      notify(read(pair, peer + OUTPUT));
    }
    let owned = true;
    let watch: EventLoopHandle | undefined;
    return {
      send: (packet, commit): boolean => {
        if (!owned) return false;
        const prepared = outgoing.prepare(packet);
        if (!prepared.ok)
          throw new Error("message port packet allocation failed");
        try {
          if (commit !== undefined) commit();
          if (!owned) return false;
          lock(pair);
          try {
            if (read(pair, peer + STATE) === CLOSED) return false;
            prepared.value.publish(notifyPeer);
            return true;
          } finally {
            unlock(pair);
          }
        } finally {
          prepared.value.discard();
        }
      },
      take: (): string | undefined => {
        if (!owned) return undefined;
        if (watch !== undefined)
          throw new Error("message port is already watched");
        return incoming.receive();
      },
      watch: (message, peerClose): EventLoopHandle => {
        if (!owned) throw new Error("message port is closed");
        if (watch !== undefined)
          throw new Error("message port is already watched");
        let scheduled = false;
        let active = true;
        function schedule(): void {
          if (!active || scheduled) return;
          scheduled = true;
          reactor.loop.enqueueIO((): void => {
            scheduled = false;
            if (!active) return;
            const packet = incoming.receive();
            if (packet !== undefined) {
              schedule();
              message(packet);
            } else if (read(pair, peer + STATE) === CLOSED) {
              handle.close();
              peerClose();
            }
          });
        }
        const source = reactor.watchReadable(input, (): void => {
          let status = threads.read(input, notifications);
          while (status === INTERRUPTED)
            status = threads.read(input, notifications);
          if (status <= 0 && status !== threads.wouldBlock)
            throw new Error("message port read failed: " + String(status));
          schedule();
        });
        const handle: EventLoopHandle = {
          kind: "handle",
          ref: (): EventLoopHandle => {
            source.ref();
            return handle;
          },
          unref: (): EventLoopHandle => {
            source.unref();
            return handle;
          },
          hasRef: (): boolean => source.hasRef(),
          close: (): void => {
            if (!active) return;
            active = false;
            watch = undefined;
            source.close();
          },
        };
        watch = handle;
        schedule();
        return handle;
      },
      inspect: (): NativeMessagePortGrant | undefined =>
        owned ? grant : undefined,
      transfer: (): NativeMessagePortGrant => {
        if (!owned) throw new Error("message port is closed");
        const next = {
          base: grant.base,
          side: grant.side,
          generation: grant.generation + 1,
        };
        watch?.close();
        lock(pair);
        try {
          ensureLease(pair, local, grant.generation, OWNED);
          write(pair, local + GENERATION, next.generation);
          write(pair, local + STATE, IN_FLIGHT);
        } finally {
          unlock(pair);
        }
        owned = false;
        return next;
      },
      close: (): void => {
        if (!owned) return;
        watch?.close();
        owned = false;
        releaseEndpoint(grant, OWNED, incoming);
      },
    };
  }
  function initialize(
    pair: NativeSharedBlockRegistry,
    base: number,
    signals: WorkerControlPipe,
    side: number,
  ): void {
    const local = endpoint(side);
    write(pair, local + STATE, OWNED);
    write(pair, local + GENERATION, 1);
    write(pair, local + MAILBOX, base);
    write(pair, local + INPUT, signals.input);
    write(pair, local + OUTPUT, signals.output);
  }
  function allocateMailbox(base: number): NativeAgentMailbox {
    const created = createNativeAgentMailbox(memory, parking, base);
    if (!created.ok) throw new Error("message port mailbox allocation failed");
    return created.value;
  }
  function closePipe(pipe: WorkerControlPipe | undefined): void {
    if (pipe === undefined) return;
    threads.close(pipe.input);
    threads.close(pipe.output);
  }
  return {
    create: (): NativeMessagePortPair => {
      const base = memory.mapMemory(PAGE);
      if (base <= 0) throw new Error("message port allocation failed");
      const pair = registry(base);
      let first: NativeAgentMailbox | undefined;
      let second: NativeAgentMailbox | undefined;
      let readFirst: WorkerControlPipe | undefined;
      let readSecond: WorkerControlPipe | undefined;
      try {
        first = allocateMailbox(base);
        second = allocateMailbox(base);
        readFirst = threads.controlPipe();
        readSecond = threads.controlPipe();
        write(pair, REMAINING, 2);
        initialize(pair, first.registry.base, readFirst, 0);
        initialize(pair, second.registry.base, readSecond, 1);
        return {
          first: port({ base, side: 0, generation: 1 }),
          second: port({ base, side: 1, generation: 1 }),
        };
      } catch (error) {
        closePipe(readFirst);
        closePipe(readSecond);
        if (first !== undefined) releaseMemory(first.registry.base);
        if (second !== undefined) releaseMemory(second.registry.base);
        releaseMemory(base);
        throw error;
      }
    },
    adopt: (grant): NativeMessagePort => {
      const pair = registry(grant.base);
      const local = endpoint(grant.side);
      const owned = port(grant);
      lock(pair);
      try {
        ensureLease(pair, local, grant.generation, IN_FLIGHT);
        write(pair, local + STATE, OWNED);
      } finally {
        unlock(pair);
      }
      return owned;
    },
    discard: (grant): void => {
      const pair = registry(grant.base);
      releaseEndpoint(grant, IN_FLIGHT, mailbox(pair, endpoint(grant.side)));
    },
  };
}

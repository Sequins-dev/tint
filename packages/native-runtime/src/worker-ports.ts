import {
  attachNativeAgentMailbox,
  createNativeAgentPacketProducer,
  createNativeAgentMailbox,
  drainNativeAgentPackets,
  nativeAgentPacketsQueued,
  publishNativeAgentPacket,
  releaseNativeAgentMailboxBlocks,
  releaseNativeAgentPacket,
  restoreNativeAgentPackets,
  settleNativeAgentPackets,
  type MutableSharedWindow,
  type NativeAgentMailbox,
  type NativeAgentPacket,
  type NativeAgentPacketEntry,
} from "./agent-messages.ts";
import type { ReactorEventLoop } from "./event-loop-reactor.ts";
import type { EventLoopHandle } from "./event-loop.ts";
import {
  compareNumber,
  lockRegistryWord,
  readNumber,
  unlockRegistryWord,
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
/** Binary packets cross a port by pointer (docs/design-worker-runtime.md).
 * A sender allocates a packet from the peer's mailbox, fills its payload and
 * sends it; a receiver takes or is handed each packet and releases it once
 * decoded, before running script. */
export interface NativeMessagePort {
  /** A packet with room for `payload` bytes, owned by the caller until sent
   * or released. */
  allocate(payload: number): NativeAgentPacket;
  /** Return a packet that was allocated or received and is no longer used. */
  release(packet: NativeAgentPacket): void;
  /** The trusted commit runs before publication. False means the packet and
   * its grants still belong to the caller. */
  send(packet: NativeAgentPacket, used: number, commit?: () => void): boolean;
  take(): NativeAgentPacketEntry | undefined;
  watch(
    message: (entry: NativeAgentPacketEntry) => void,
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
const ENDPOINT_BYTES = 48;
const REMAINING = 8;
const STATE = 0;
const GENERATION = 8;
const INPUT = 16;
const OUTPUT = 24;
const MAILBOX = 32;
// Set by a sender that wrote the receiver's signal byte and cleared by the
// receiver once a drain finds its queue empty, so sends to a receiver that
// is still delivering write no pipe.
const SIGNALED = 40;
// Packets one I/O task delivers before yielding to the rest of the loop.
const deliveriesPerTask = 1000;
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
  /** Discards the grants of a packet that will never be delivered; the
   * ports release the packet itself. */
  disposePacket: (entry: NativeAgentPacketEntry) => void,
): NativeMessagePorts {
  const scratch = new Uint32Array(2);
  const packetHeader: MutableSharedWindow = {
    base: 0,
    byteLength: 32,
    engineId: 0,
  };
  const signal = new Uint8Array(1);
  const notifications = new Uint8Array(256);
  function registry(base: number): NativeSharedBlockRegistry {
    return { base, byteLength: PAGE, engineId: base };
  }
  function lock(pair: NativeSharedBlockRegistry): void {
    lockRegistryWord(memory, parking, pair, 0, scratch);
  }
  function unlock(pair: NativeSharedBlockRegistry): void {
    unlockRegistryWord(memory, parking, pair, 0, scratch);
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
  /** The final owner frees a mailbox's recycled payloads, then its page. */
  function releaseMailbox(base: number): void {
    releaseNativeAgentMailboxBlocks(memory, registry(base));
    releaseMemory(base);
  }
  function releaseEndpoint(
    grant: NativeMessagePortGrant,
    state: number,
    queue: NativeAgentMailbox,
    pending: readonly NativeAgentPacketEntry[],
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
      const undelivered = pending.slice();
      for (const entry of drainNativeAgentPackets(
        memory,
        parking,
        queue.registry,
        undefined,
        scratch,
        packetHeader,
      ))
        undelivered.push(entry);
      for (const entry of undelivered) {
        try {
          disposePacket(entry);
        } finally {
          releaseNativeAgentPacket(
            memory,
            parking,
            queue.registry,
            entry.packet,
            scratch,
            packetHeader,
          );
        }
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
        // Signal pipes close with the pair, so a sender can write its
        // peer's pipe after releasing the pair lock.
        for (const side of [local, peer]) {
          threads.close(read(pair, side + INPUT));
          threads.close(read(pair, side + OUTPUT));
        }
        releaseMailbox(read(pair, local + MAILBOX));
        releaseMailbox(read(pair, peer + MAILBOX));
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
    // Runs under the pair lock: signal only a receiver not already signaled.
    /** Under the peer's queue lock: whether this send must wake it. */
    function signalPeer(): boolean {
      if (read(pair, peer + SIGNALED) !== 0) return false;
      write(pair, peer + SIGNALED, 1);
      return true;
    }
    function clearSignal(): void {
      write(pair, local + SIGNALED, 0);
    }
    let owned = true;
    let watch: EventLoopHandle | undefined;
    // Small packets for the peer share segments of the peer's mailbox.
    const producer = createNativeAgentPacketProducer(
      memory,
      parking,
      outgoing.registry,
    );
    // Packets drained from the incoming queue; those from `cursor` on are
    // not yet delivered. The array itself is reused across drains.
    const pending: NativeAgentPacketEntry[] = [];
    let cursor = 0;
    function shift(): NativeAgentPacketEntry | undefined {
      const entry = pending[cursor];
      if (entry !== undefined) cursor++;
      return entry;
    }
    /** The undelivered packets, which leave this port's hands. */
    function undelivered(): NativeAgentPacketEntry[] {
      const entries = cursor < pending.length ? pending.slice(cursor) : [];
      pending.length = 0;
      cursor = 0;
      return entries;
    }
    function next(): NativeAgentPacketEntry | undefined {
      if (cursor === pending.length) {
        drainNativeAgentPackets(
          memory,
          parking,
          incoming.registry,
          undefined,
          scratch,
          packetHeader,
          pending,
        );
        cursor = 0;
      }
      return shift();
    }
    /** The next packet for a watcher. A drain that finds the queue empty
     * clears the signal flag in the queue-lock hold in which senders decide
     * to signal, so senders skip the wake while the watcher still has work
     * and the first send after it runs dry wakes it again. */
    function nextWatched(): NativeAgentPacketEntry | undefined {
      if (cursor === pending.length) {
        drainNativeAgentPackets(
          memory,
          parking,
          incoming.registry,
          clearSignal,
          scratch,
          packetHeader,
          pending,
        );
        cursor = 0;
      }
      return shift();
    }
    /** Undelivered packets go back ahead of the queue for the next owner. */
    function requeue(): void {
      restoreNativeAgentPackets(
        memory,
        parking,
        incoming.registry,
        undelivered(),
      );
    }
    return {
      allocate: (payload): NativeAgentPacket => {
        const packet = producer.allocate(payload);
        if (packet === undefined)
          throw new Error("message port packet allocation failed");
        return packet;
      },
      release: (packet): void => {
        // Every block, sent or received, joins the free stack of the mailbox
        // this side sends into, where a reply finds it. The pair's final
        // owner frees both stacks.
        producer.release(packet);
      },
      send: (packet, used, commit): boolean => {
        if (!owned) return false;
        producer.commit(packet, used);
        if (commit !== undefined) commit();
        if (!owned) return false;
        let wake = -1;
        lock(pair);
        try {
          if (read(pair, peer + STATE) === CLOSED) return false;
          if (
            publishNativeAgentPacket(
              memory,
              parking,
              outgoing.registry,
              packet,
              used,
              signalPeer,
              scratch,
              packetHeader,
            )
          )
            wake = read(pair, peer + OUTPUT);
        } finally {
          unlock(pair);
        }
        // The pipe write follows both unlocks, so the woken peer finds
        // neither lock held. The pipe lives as long as the pair, which this
        // sender's endpoint keeps alive.
        if (wake >= 0) notify(wake);
        return true;
      },
      take: (): NativeAgentPacketEntry | undefined => {
        if (!owned) return undefined;
        if (watch !== undefined)
          throw new Error("message port is already watched");
        return next();
      },
      watch: (message, peerClose): EventLoopHandle => {
        if (!owned) throw new Error("message port is closed");
        if (watch !== undefined)
          throw new Error("message port is already watched");
        let scheduled = false;
        let active = true;
        // Whether this port delivered since the loop last went idle.
        let recent = false;
        // Like Node's MessagePort, one I/O task delivers the queued packets,
        // with a microtask checkpoint after each (the loop runs the last),
        // draining again until the queue runs dry or a bounded count is
        // delivered. A packet stays pending through each checkpoint, so a
        // close or transfer it runs still hands it on; if a listener
        // throws, the next task is queued before the error leaves.
        const deliver = (): void => {
          scheduled = false;
          if (!active) return;
          let delivered = 0;
          try {
            for (;;) {
              const entry = nextWatched();
              if (entry === undefined) {
                if (read(pair, peer + STATE) === CLOSED) {
                  handle.close();
                  peerClose();
                }
                return;
              }
              message(entry);
              recent = true;
              if (!active) return;
              if (++delivered === deliveriesPerTask) {
                schedule();
                return;
              }
              reactor.loop.checkpointWithin();
              if (!active) return;
            }
          } catch (error) {
            schedule();
            throw error;
          }
        };
        function schedule(): void {
          if (!active || scheduled) return;
          scheduled = true;
          reactor.loop.enqueueIO(deliver);
        }
        // Before the loop blocks, a port that just delivered tells senders
        // it is awake (so they skip the pipe write) and polls its queue; it
        // settles under the queue lock, so a send after that wakes it.
        const stopPolling = reactor.pollWhileIdle({
          arm: (): boolean => {
            if (!active || !recent) return false;
            recent = false;
            write(pair, local + SIGNALED, 1);
            return true;
          },
          ready: (): boolean =>
            nativeAgentPacketsQueued(memory, incoming.registry, scratch),
          settle: (): boolean => {
            if (
              !settleNativeAgentPackets(
                memory,
                parking,
                incoming.registry,
                clearSignal,
                scratch,
              )
            )
              return false;
            schedule();
            return true;
          },
        });
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
            stopPolling();
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
        requeue();
        producer.close();
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
        producer.close();
        releaseEndpoint(grant, OWNED, incoming, undelivered());
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
    const created = createNativeAgentMailbox(memory, parking, base, true);
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
      releaseEndpoint(
        grant,
        IN_FLIGHT,
        mailbox(pair, endpoint(grant.side)),
        [],
      );
    },
  };
}

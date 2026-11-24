// A fair FIFO queue in front of the shared timing and launch locks.
//
// Every with-lock.sh request takes a numbered ticket. A ticket waits until
// every earlier ticket that shares a lock with it has finished, then takes its
// locks in the fixed order timing, launch and runs. Requests with disjoint
// locks run concurrently; a request never overtakes an earlier one it
// conflicts with. The kernel locks still provide mutual exclusion, including
// with callers outside the queue.
//
// Each ticket file is flocked by its owner for the owner's lifetime. Waiting
// for an earlier ticket is a blocking pathname lockf on that file, so the
// kernel wakes the waiter when the owner finishes or dies. A ticket left by a
// killed owner is unlocked and removed by the next process that finds it.
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  holdGateLock,
  isLocked,
  lockDescriptor,
  tryAcquire,
  waitForGateLock,
  type HeldLock,
  type Interrupted,
} from "./flock.ts";

export type GateResource = "launch" | "timing" | "both";

export interface GateLockPaths {
  launch: string;
  timing: string;
}

/** The lock paths with-lock.sh exports; an empty variable means unset. */
export function gateLockPaths(env = process.env): GateLockPaths {
  return {
    launch:
      env.TINT_GATE_EXCLUSIVE_LOCK || join(homedir(), ".t3", "tint-gate.lock"),
    timing:
      env.TINT_GATE_TIMING_LOCK || join(homedir(), ".t3", "tint-timing.lock"),
  };
}

/** Requests that share a launch lock share its directory's queue. */
export function gateQueueDirectory(env = process.env): string {
  return (
    env.TINT_GATE_LOCK_QUEUE ||
    join(dirname(gateLockPaths(env).launch), "tint-gate-queue")
  );
}

/** A resource's locks in the global acquisition order: timing, then launch. */
export function resourceLocks(
  resource: GateResource,
  paths: GateLockPaths,
): string[] {
  if (resource === "launch") return [paths.launch];
  if (resource === "timing") return [paths.timing];
  return [paths.timing, paths.launch];
}

/** Tickets identify locks by canonical path; lock files need not exist. */
function canonicalLock(file: string): string {
  try {
    return join(realpathSync(dirname(file)), basename(file));
  } catch {
    return file;
  }
}

interface TicketRecord {
  version: 1;
  pid: number;
  label: string;
  resource: GateResource;
  locks: string[];
  command: string;
  cwd: string;
  requestedAt: number;
}

interface TicketEvent {
  state: "acquiring" | "running";
  at: number;
  /** While acquiring: the lock being waited for and the locks already held. */
  lock?: string;
  held?: string[];
}

interface QueuedTicket {
  seq: number;
  path: string;
  /** Undefined when the file cannot be parsed; it then conflicts with all. */
  record: TicketRecord | undefined;
  events: TicketEvent[];
}

const TICKET = /^(\d{10})\.ticket$/;
const PENDING = /^\.pending-(\d+)-[0-9a-f]+$/;

function ticketName(seq: number) {
  return String(seq).padStart(10, "0") + ".ticket";
}

function readTicket(directory: string, name: string): QueuedTicket | undefined {
  const seq = Number(TICKET.exec(name)![1]);
  const path = join(directory, name);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const [first = "", ...rest] = text.split("\n");
  const record = parseLine(first) as TicketRecord | undefined;
  if (record?.version !== 1 || !Array.isArray(record.locks))
    return { seq, path, record: undefined, events: [] };
  // The record is complete before the ticket is visible. Its owner appends
  // events later, so a reader can see a partial last line.
  const events = rest.map(parseLine).filter((event) => event !== undefined);
  return { seq, path, record, events: events as TicketEvent[] };
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function conflicts(ticket: QueuedTicket, locks: readonly string[]) {
  return (
    ticket.record === undefined ||
    ticket.record.locks.some((lock) => locks.includes(lock))
  );
}

function readTickets(directory: string): QueuedTicket[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter((name) => TICKET.test(name))
    .sort()
    .map((name) => readTicket(directory, name))
    .filter((ticket) => ticket !== undefined);
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Removes half-created tickets whose creator has exited. */
function removeAbandonedPending(directory: string) {
  for (const name of readdirSync(directory)) {
    const pid = PENDING.exec(name)?.[1];
    if (pid !== undefined && !processAlive(Number(pid)))
      rmSync(join(directory, name), { force: true });
  }
}

/** Serializes ticket numbering; it is held only to name one ticket. */
async function acquireRegistry(
  file: string,
): Promise<{ fd: number } | Interrupted> {
  for (;;) {
    const fd = tryAcquire(file);
    if (fd !== undefined) return { fd };
    const interrupted = await waitForGateLock(file);
    if (interrupted !== undefined) return interrupted;
  }
}

/** Allocates the next ticket number. Callers hold the registry lock. */
function nextSeq(directory: string): number {
  const counter = join(directory, "counter");
  let last = 0;
  try {
    last = Number(readFileSync(counter, "utf8").trim()) || 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Never reuse a number that a remaining ticket holds, even if the counter
  // was lost.
  for (const name of readdirSync(directory)) {
    const seq = TICKET.exec(name)?.[1];
    if (seq !== undefined) last = Math.max(last, Number(seq));
  }
  const seq = last + 1;
  writeFileSync(counter + ".tmp", seq + "\n");
  renameSync(counter + ".tmp", counter);
  return seq;
}

export interface GateRequest {
  resource: GateResource;
  label: string;
  /** Lock paths in acquisition order. */
  locks: string[];
  command: string[];
}

export class GateTicket {
  readonly #fd: number;
  readonly seq: number;
  readonly path: string;
  /** Canonical lock paths in acquisition order. */
  readonly locks: readonly string[];

  constructor(seq: number, path: string, locks: string[], fd: number) {
    this.seq = seq;
    this.path = path;
    this.locks = locks;
    this.#fd = fd;
  }

  /** Earlier tickets that share a lock with this one. */
  predecessors(): QueuedTicket[] {
    return readTickets(dirname(this.path)).filter(
      (ticket) => ticket.seq < this.seq && conflicts(ticket, this.locks),
    );
  }

  /**
   * Waits until every earlier conflicting ticket has finished. Tickets are
   * visible before their numbers are handed out, so no earlier ticket can
   * appear after this one was created.
   */
  async waitTurn(): Promise<Interrupted | undefined> {
    for (const ticket of this.predecessors()) {
      const interrupted = await waitForGateLock(ticket.path, {
        mustExist: true,
      });
      if (interrupted !== undefined) return interrupted;
      // An owner removes its ticket before releasing it, so a file that is
      // still present belonged to a process that died. Numbers are never
      // reused, so the path cannot name a newer ticket.
      if (existsSync(ticket.path)) rmSync(ticket.path, { force: true });
    }
  }

  record(event: TicketEvent) {
    writeSync(this.#fd, JSON.stringify(event) + "\n");
  }

  /** Records a wait for `locks[index]` while holding the earlier locks. */
  recordLockWait(index: number) {
    this.record({
      state: "acquiring",
      at: Date.now(),
      lock: this.locks[index]!,
      held: this.locks.slice(0, index),
    });
  }

  close() {
    rmSync(this.path, { force: true });
    closeSync(this.#fd);
  }
}

/**
 * Creates a ticket for the request. The ticket is locked and complete before
 * it becomes visible under its numbered name.
 */
export async function enterGateQueue(
  directory: string,
  request: GateRequest,
): Promise<GateTicket | Interrupted> {
  mkdirSync(directory, { recursive: true });
  removeAbandonedPending(directory);
  const locks = request.locks.map(canonicalLock);
  const record: TicketRecord = {
    version: 1,
    pid: process.pid,
    label: request.label,
    resource: request.resource,
    locks,
    command: request.command.join(" ").slice(0, 500),
    cwd: process.cwd(),
    requestedAt: Date.now(),
  };
  const pending = join(
    directory,
    `.pending-${process.pid}-${randomBytes(4).toString("hex")}`,
  );
  const fd = openSync(pending, "wx");
  let ticket: GateTicket | undefined;
  try {
    if (!lockDescriptor(fd, pending))
      throw Error("Could not lock a new queue ticket: " + pending);
    writeSync(fd, JSON.stringify(record) + "\n");
    const registry = await acquireRegistry(join(directory, "registry.lock"));
    if (typeof registry === "number") return registry;
    try {
      const seq = nextSeq(directory);
      const path = join(directory, ticketName(seq));
      renameSync(pending, path);
      ticket = new GateTicket(seq, path, locks, fd);
      return ticket;
    } finally {
      closeSync(registry.fd);
    }
  } finally {
    if (ticket === undefined) {
      rmSync(pending, { force: true });
      closeSync(fd);
    }
  }
}

/**
 * Takes the locks in order, waiting in each lock's kernel queue while holding
 * the earlier ones. Conflicting tickets never reach this point together, so
 * the only competitors are callers outside the queue, none of which holds
 * launch while waiting for timing.
 */
export async function acquireInOrder(
  locks: readonly string[],
  onWait: (index: number) => void,
): Promise<HeldLock[] | Interrupted> {
  const held: HeldLock[] = [];
  let complete = false;
  try {
    for (const [index, lock] of locks.entries()) {
      const fd = tryAcquire(lock);
      if (fd !== undefined) {
        held.push({ release: async () => closeSync(fd) });
        continue;
      }
      onWait(index);
      const hold = await holdGateLock(lock);
      if (typeof hold === "number") return hold;
      held.push(hold);
    }
    complete = true;
    return held;
  } finally {
    if (!complete) await releaseAll(held);
  }
}

export async function releaseAll(held: HeldLock[]) {
  for (const lock of held.reverse()) await lock.release();
}

function duration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Processes with the lock file open: holders, not blocked waiters. */
function lockHolders(file: string): string[] {
  const lsof = spawnSync("/usr/sbin/lsof", ["-t", "--", file], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const pids = (lsof.stdout ?? "")
    .split("\n")
    .filter((pid) => /^\d+$/.test(pid) && Number(pid) !== process.pid);
  if (pids.length === 0) return [];
  const ps = spawnSync(
    "/bin/ps",
    ["-o", "pid=,etime=,command=", "-p", pids.join(",")],
    { encoding: "utf8", timeout: 10_000 },
  );
  return (ps.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.length > 160 ? line.slice(0, 157) + "..." : line));
}

/** Describes the lock holders and the queue, oldest ticket first. */
export function gateQueueStatus(env = process.env): string {
  const paths = gateLockPaths(env);
  const directory = gateQueueDirectory(env);
  const now = Date.now();
  const lines = [`Tint gate locks (queue ${directory})`];

  const notes: string[] = [];
  const tickets = readTickets(directory).filter((ticket) => {
    const live = isLocked(ticket.path);
    if (live === false) {
      rmSync(ticket.path, { force: true });
      notes.push(`removed #${ticket.seq}, whose owner exited`);
    }
    return live === true;
  });

  for (const [name, file] of Object.entries(paths)) {
    const lock = canonicalLock(file);
    const owner = tickets.find((ticket) => {
      const last = ticket.events.at(-1);
      return last?.state === "running"
        ? ticket.record!.locks.includes(lock)
        : last?.held?.includes(lock);
    });
    let description: string;
    if (!isLocked(file)) description = "free";
    else if (owner)
      description = `held by #${owner.seq} (${owner.record!.label})`;
    else {
      const holders = lockHolders(file);
      description =
        "held outside the queue" +
        (holders.length
          ? ":\n" + holders.map((holder) => "           " + holder).join("\n")
          : "");
    }
    lines.push(`  ${name.padEnd(7)} ${file}  ${description}`);
  }

  if (tickets.length === 0) lines.push("Queue: empty");
  else lines.push("Queue (oldest first):");
  for (const ticket of tickets) {
    const record = ticket.record;
    if (!record) {
      lines.push(`  #${ticket.seq} unreadable ticket ${ticket.path}`);
      continue;
    }
    const last = ticket.events.at(-1);
    const waited = duration(
      (ticket.events.find((event) => event.state === "running")?.at ?? now) -
        record.requestedAt,
    );
    let detail: string;
    if (last?.state === "running") {
      detail = `running ${duration(now - last.at)} after waiting ${waited}`;
    } else if (last?.state === "acquiring") {
      detail =
        `waiting ${waited}, first in line` +
        (last.lock ? ` for ${basename(last.lock)}` : "");
    } else {
      const ahead = tickets
        .filter(
          (other) => other.seq < ticket.seq && conflicts(other, record.locks),
        )
        .map((other) => "#" + other.seq);
      detail =
        `waiting ${waited}` +
        (ahead.length ? ` behind ${ahead.join(", ")}` : "");
    }
    lines.push(
      `  #${ticket.seq} ${record.resource.padEnd(6)} ${record.label}  pid ${record.pid}  ${detail}`,
      `      ${record.cwd}$ ${record.command}`,
    );
  }
  lines.push(...notes.map((note) => "Note: " + note));
  return lines.join("\n");
}

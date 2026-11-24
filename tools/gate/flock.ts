// BSD flock primitives built on /usr/bin/lockf, the only flock interface that
// both Node and the shell scripts share on macOS. Every pathname acquisition
// uses -k so lock files keep their inodes between holders.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { closeSync, fstatSync, openSync, statSync } from "node:fs";

/** The shell exit status for an interrupted wait (SIGINT or SIGTERM). */
export type Interrupted = 130 | 143;

const LOCKF = "/usr/bin/lockf";
const EX_UNAVAILABLE = 69;
const EX_TEMPFAIL = 75;

/**
 * Takes a non-blocking flock on an open descriptor. The lock belongs to the
 * open file description, so it stays held after lockf exits and is released
 * when the caller closes the descriptor or dies.
 */
export function lockDescriptor(fd: number, file: string): boolean {
  const result = spawnSync(LOCKF, ["-k", "-s", "-t", "0", "3"], {
    stdio: ["ignore", "ignore", "inherit", fd],
  });
  if (result.error !== undefined) throw result.error;
  if (result.status === EX_TEMPFAIL) return false;
  if (result.status !== 0)
    throw Error(
      "lockf failed for " + file + ": " + (result.signal ?? result.status),
    );
  return true;
}

export function tryAcquire(file: string): number | undefined {
  const fd = openSync(file, "a");
  let acquired = false;
  try {
    if (!lockDescriptor(fd, file)) return undefined;
    // Legacy lockf callers can unlink the pathname as they release their lock.
    // Never enter a critical section on an inode the pathname no longer names.
    const held = fstatSync(fd);
    const current = statSync(file, { throwIfNoEntry: false });
    acquired = held.ino === current?.ino && held.dev === current.dev;
    return acquired ? fd : undefined;
  } finally {
    if (!acquired) closeSync(fd);
  }
}

/**
 * Reports whether another process holds an existing lock file, or undefined
 * when the file does not exist. A free lock is held only for the probe.
 */
export function isLocked(file: string): boolean | undefined {
  const result = spawnSync(
    LOCKF,
    ["-k", "-n", "-s", "-t", "0", file, "/usr/bin/true"],
    { stdio: "ignore" },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return false;
  if (result.status === EX_TEMPFAIL) return true;
  if (result.status === EX_UNAVAILABLE) return undefined;
  throw Error(
    "lockf probe failed for " + file + ": " + (result.signal ?? result.status),
  );
}

function interruptible(child: ChildProcess, onInterrupt?: () => void) {
  let interrupted: Interrupted | undefined;
  const stop = (signal: NodeJS.Signals) => {
    interrupted ??= signal === "SIGINT" ? 130 : 143;
    child.kill();
    onInterrupt?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return {
    get interrupted() {
      return interrupted;
    },
    dispose() {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    },
  };
}

/**
 * Waits in the kernel's queue until no process holds the lock, without
 * keeping it. A pathname wait retains its position through long holds and
 * does not spin as blocking descriptor-mode lockf does on Darwin. With
 * `mustExist`, a missing file counts as released.
 */
export async function waitForGateLock(
  file: string,
  { mustExist = false } = {},
): Promise<Interrupted | undefined> {
  const missing = mustExist ? ["-n"] : [];
  // A waiter outlives a killed caller until the lock is free. It must not
  // keep the caller's output pipes open; -s leaves only the exit status.
  const child = spawn(LOCKF, ["-k", "-s", ...missing, file, "/usr/bin/true"], {
    stdio: "ignore",
  });
  const signals = interruptible(child);
  try {
    const [status, signal] = await once(child, "exit");
    if (signals.interrupted !== undefined) return signals.interrupted;
    if (mustExist && status === EX_UNAVAILABLE) return undefined;
    if (status !== 0)
      throw Error("lockf wait failed for " + file + ": " + (signal ?? status));
  } finally {
    signals.dispose();
  }
}

export interface HeldLock {
  release(): Promise<void>;
}

/**
 * Waits in the kernel's queue for the lock and keeps it. A detached lockf
 * process holds the lock until the caller releases it or exits: its command
 * reads the pipe from this process, so the lock is released when the pipe
 * closes, including when this process is killed. A holder orphaned while it
 * waits takes the lock when it is free, finds the pipe closed and exits.
 */
export function holdGateLock(file: string): Promise<HeldLock | Interrupted> {
  const holder = spawn(
    LOCKF,
    ["-k", "-s", file, "/bin/sh", "-c", "echo held && exec cat >/dev/null"],
    { detached: true, stdio: ["pipe", "pipe", "ignore"] },
  );
  // A spawn failure rejects the returned promise through the error listener,
  // and ending the pipe to a holder that already exited is not an error.
  const exited = once(holder, "exit").catch(() => undefined);
  holder.stdin!.on("error", () => {});
  const release = async () => {
    holder.stdin!.end();
    if (holder.exitCode === null && holder.signalCode === null) await exited;
  };
  return new Promise((resolve, reject) => {
    let held = false;
    const signals = interruptible(holder, () => holder.stdin!.end());
    let output = "";
    holder.stdout!.setEncoding("utf8");
    holder.stdout!.on("data", (chunk: string) => {
      output += chunk;
      if (held || !output.includes("held\n")) return;
      held = true;
      signals.dispose();
      if (signals.interrupted !== undefined) {
        void release().then(() => resolve(signals.interrupted!), reject);
      } else {
        resolve({ release });
      }
    });
    holder.once("error", (error) => {
      signals.dispose();
      reject(error);
    });
    holder.once("exit", (status, signal) => {
      if (held) {
        if (!holder.stdin!.writableEnded)
          console.error(`Lost ${file}: its lockf holder exited unexpectedly`);
        return;
      }
      signals.dispose();
      if (signals.interrupted !== undefined) resolve(signals.interrupted);
      else
        reject(
          Error("lockf hold failed for " + file + ": " + (signal ?? status)),
        );
    });
  });
}

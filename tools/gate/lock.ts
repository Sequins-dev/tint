import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

const sleep = new Int32Array(new SharedArrayBuffer(4));

function tryAcquire(file: string): number | undefined {
  const fd = openSync(file, "a");
  let acquired = false;
  try {
    const result = spawnSync("/usr/bin/lockf", ["-s", "-t", "0", "3"], {
      stdio: ["ignore", "ignore", "inherit", fd],
    });
    if (result.error !== undefined) throw result.error;
    if (result.status === 75) return undefined;
    if (result.status !== 0)
      throw Error(
        "lockf failed for " + file + ": " + (result.signal ?? result.status),
      );
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

export function withGateLock<T>(
  files: readonly string[],
  label: string,
  timing: string | undefined,
  run: (fd: number) => T,
): T {
  if (files.length === 0) throw Error("No gate locks configured");
  for (;;) {
    for (const file of files) {
      const fd = tryAcquire(file);
      if (fd === undefined) continue;
      const startedAt = Date.now();
      const start = performance.now();
      try {
        return run(fd);
      } finally {
        const elapsed = Math.round(performance.now() - start);
        closeSync(fd);
        if (timing)
          appendFileSync(
            timing,
            [label, file, startedAt, elapsed].join("\t") + "\n",
          );
      }
    }
    // Darwin's descriptor-mode lockf can spin when asked to block.
    // Probe once per slot and sleep while every slot is occupied.
    Atomics.wait(sleep, 0, 0, 250);
  }
}

export function withGateLaunch<T>(label: string, run: () => T): T {
  const file = process.env.TINT_GATE_LAUNCH_LOCK;
  return file
    ? withGateLock([file], label, process.env.TINT_GATE_LOCK_TIMING, run)
    : run();
}

if (import.meta.main) {
  const [resource, label, command, ...args] = process.argv.slice(2);
  if (!resource || !label || !command)
    throw Error("Expected resource, label and command");
  let files: string[];
  if (resource === "exclusive") {
    const file = process.env.TINT_GATE_EXCLUSIVE_LOCK;
    if (!file) throw Error("Missing exclusive gate lock path");
    files = [file];
  } else if (resource === "memory") {
    const directory = process.env.TINT_GATE_MEMORY_DIRECTORY;
    const count = process.env.TINT_GATE_MEMORY_SLOTS ?? "3";
    if (!directory || !/^[1-9][0-9]?$/.test(count))
      throw Error("Expected a gate memory directory and 1–99 slots");
    mkdirSync(directory, { recursive: true });
    files = Array.from({ length: Number(count) }, (_, i) =>
      join(directory, "slot-" + (i + 1) + ".lock"),
    );
  } else {
    throw Error("Unknown gate resource: " + resource);
  }
  process.exitCode = withGateLock(
    files,
    label,
    process.env.TINT_GATE_LOCK_TIMING,
    (fd) => {
      const result = spawnSync(command, args, {
        stdio: ["inherit", "inherit", "inherit", fd],
      });
      if (result.error !== undefined) throw result.error;
      if (result.signal !== null)
        console.error(command, "terminated by", result.signal);
      return result.status ?? 1;
    },
  );
}

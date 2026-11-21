import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { nativeBatchWaiting } from "./native-batch-clock.ts";

import {
  killGateProcess,
  runWithDeadline,
  runWithWatchdog,
  stageInferior,
} from "./watchdog.ts";

const sleep = new Int32Array(new SharedArrayBuffer(4));

function tryAcquire(file: string): number | undefined {
  const fd = openSync(file, "a");
  let acquired = false;
  try {
    const result = spawnSync("/usr/bin/lockf", ["-k", "-s", "-t", "0", "3"], {
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

export interface GateLock {
  fd: number;
  release(): void;
}

function probeGateLocks(
  files: readonly string[],
  label: string,
  timing: string | undefined,
): GateLock | undefined {
  if (files.length === 0) throw Error("No gate locks configured");
  for (const file of files) {
    const fd = tryAcquire(file);
    if (fd === undefined) continue;
    const startedAt = Date.now();
    const start = performance.now();
    return {
      fd,
      release() {
        const elapsed = Math.round(performance.now() - start);
        closeSync(fd);
        if (timing)
          appendFileSync(
            timing,
            [label, file, startedAt, elapsed].join("\t") + "\n",
          );
      },
    };
  }
  return undefined;
}

export async function acquireGateLock(
  files: readonly string[],
  label: string,
  timing: string | undefined,
): Promise<GateLock> {
  for (;;) {
    const lock = probeGateLocks(files, label, timing);
    if (lock) return lock;
    await delay(250);
  }
}

export function acquireGateLockSync(
  files: readonly string[],
  label: string,
  timing: string | undefined,
): GateLock {
  for (;;) {
    const lock = probeGateLocks(files, label, timing);
    if (lock) return lock;
    Atomics.wait(sleep, 0, 0, 250);
  }
}

async function acquireTimingAndLaunch(
  launch: string,
  timing: string,
  label: string,
): Promise<() => void> {
  if (timing === launch)
    throw Error("Expected distinct timing and launch lock paths");
  for (;;) {
    const launchLock = probeGateLocks([launch], label, undefined);
    if (launchLock) {
      let timingLock: GateLock | undefined;
      try {
        timingLock = probeGateLocks([timing], label, undefined);
        const acquired = timingLock;
        if (acquired)
          return () => {
            try {
              acquired.release();
            } finally {
              launchLock.release();
            }
          };
      } finally {
        if (!timingLock) launchLock.release();
      }
    }
    // A legacy caller can hold timing while waiting for launch. Only probe
    // timing, and release launch before retrying, so neither side deadlocks.
    await delay(250);
  }
}

export function withGateLock<T>(
  files: readonly string[],
  label: string,
  timing: string | undefined,
  run: (fd: number) => T,
): T {
  const lock = acquireGateLockSync(files, label, timing);
  try {
    return run(lock.fd);
  } finally {
    lock.release();
  }
}

export function gateMemorySlots(env: NodeJS.ProcessEnv): string[] {
  const directory = env.TINT_GATE_MEMORY_DIRECTORY;
  const count = env.TINT_GATE_MEMORY_SLOTS ?? "3";
  if (!directory || !/^[1-9][0-9]?$/.test(count))
    throw Error("Expected a gate memory directory and 1–99 slots");
  mkdirSync(directory, { recursive: true });
  return Array.from({ length: Number(count) }, (_, i) =>
    join(directory, "slot-" + (i + 1) + ".lock"),
  );
}

export function gateLaunch<T>(label: string, tool: string, args: string[]): T {
  const script = fileURLToPath(new URL("./exclusive-step.sh", import.meta.url));
  const result = spawnSync(
    "sh",
    [script, label, process.execPath, tool, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TINT_GATE_EXCLUSIVE_LOCK: process.env.TINT_GATE_LAUNCH_LOCK,
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw Error(
      "Exclusive native launch failed: " + (result.signal ?? result.status),
    );
  return JSON.parse(result.stdout) as T;
}

function runGateCommand(command: string, args: string[], fd?: number): number {
  const result = spawnSync(command, args, {
    stdio: ["inherit", "inherit", "inherit", ...(fd === undefined ? [] : [fd])],
  });
  if (result.error !== undefined) throw result.error;
  if (result.signal !== null)
    console.error(command, "terminated by", result.signal);
  return result.status ?? 1;
}

async function runTimed(
  files: string[],
  label: string,
  command: string,
  args: string[],
): Promise<number> {
  const startedAt = Date.now();
  const start = performance.now();
  const evidence = process.env.TINT_GATE_EVIDENCE;
  if (!evidence) {
    process.env.TINT_GATE_EVIDENCE = mkdtempSync(join(tmpdir(), "tint-lock-"));
  }
  process.env.TINT_GATE_STEP_TIMEOUT ??= "3600";
  try {
    markStepReady();
    return await runWithWatchdog(label, command, args, true);
  } finally {
    const timing = process.env.TINT_GATE_LOCK_TIMING;
    if (timing)
      appendFileSync(
        timing,
        files
          .map((file) =>
            [
              label,
              file,
              startedAt,
              Math.round(performance.now() - start),
            ].join("\t"),
          )
          .join("\n") + "\n",
      );
  }
}

function markStepReady() {
  const file = process.env.TINT_GATE_STEP_READY;
  if (file) writeFileSync(file, "");
}

function runMacGateBudget(command: string, args: string[]): Promise<number> {
  const budget = Number(process.env.TINT_GATE_BUDGET ?? "3600");
  if (!Number.isInteger(budget) || budget < 1 || budget > 2_147_483)
    throw Error("Expected TINT_GATE_BUDGET (1–2147483 seconds)");

  const wall = Number(
    process.env.TINT_GATE_WALL_TIMEOUT ?? Math.max(7200, budget),
  );
  if (!Number.isInteger(wall) || wall < 1 || wall > 2_147_483)
    throw Error("Expected TINT_GATE_WALL_TIMEOUT (1–2147483 seconds)");

  let step = "admission";
  let resource = "";
  let evidence: string | undefined;
  let batchWaiting: (() => boolean) | undefined;
  function stopGate(pid: number) {
    let inferior: number | undefined;
    try {
      if (evidence && (step === "stage2" || step === "stage3"))
        inferior = stageInferior(join(evidence, step + ".pid"));
    } finally {
      killGateProcess(pid, inferior);
    }
  }
  function timeout(pid: number, kind: "active" | "wall", seconds: number) {
    const message = `BUDGET kind=${kind} step=${step} timeout-seconds=${seconds}`;
    console.error(message + (evidence ? " evidence=" + evidence : ""));
    try {
      if (evidence)
        appendFileSync(
          join(evidence, "budget.tsv"),
          `${step}\t${seconds}\t${kind}\n`,
        );
    } finally {
      stopGate(pid);
    }
  }
  return runWithDeadline(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      "mac-admission",
      "mac-gate",
      command,
      ...args,
    ],
    budget,
    {
      waiting: () => {
        if (step === "admission") return true;
        if (step === "check-native") return batchWaiting?.() ?? false;
        return (
          evidence !== undefined &&
          /^(memory|memory-watchdog|exclusive)$/.test(resource) &&
          !existsSync(join(evidence, "ready-" + step))
        );
      },
      onClock: (active, queued) => {
        console.log(`gate-budget active-ms=${active} queue-ms=${queued}`);
      },
      onTimeout: (pid) => timeout(pid, "active", budget),
      wallLimit: {
        seconds: wall,
        onTimeout: (pid) => timeout(pid, "wall", wall),
      },
      onInterrupt: stopGate,
      onLine: (line) => {
        const gate = /^head=[a-f0-9]+ evidence=(.+)$/.exec(line);
        const started = /^\S+ start ([a-zA-Z0-9_-]+) resource=([a-z-]+)/.exec(
          line,
        );
        if (gate) {
          evidence = gate[1]!;
          batchWaiting = nativeBatchWaiting(
            join(evidence, "native-images.jsonl"),
          );
          step = "setup";
        } else if (started) {
          step = started[1]!;
          resource = started[2]!;
        } else if (/^\S+ finish [a-zA-Z0-9_-]+ exit=/.test(line)) {
          step = "between-steps";
          resource = "";
        }
      },
    },
  );
}

if (import.meta.main) {
  const [resource, label, command, ...args] = process.argv.slice(2);
  if (!resource || !label || !command)
    throw Error("Expected resource, label and command");
  const timing = process.env.TINT_GATE_LOCK_TIMING;
  if (resource === "mac-budget") {
    process.exitCode = await runMacGateBudget(command, args);
  } else if (resource === "mac-admission") {
    const directory =
      process.env.TINT_GATE_ADMISSION_DIRECTORY ??
      join(homedir(), ".t3", "tint-gate-admission");
    mkdirSync(directory, { recursive: true });
    const files = ["slot-1.lock", "slot-2.lock"].map((slot) =>
      join(directory, slot),
    );
    process.exitCode = withGateLock(files, label, undefined, (fd) =>
      runGateCommand(command, args, fd),
    );
  } else if (resource === "watchdog") {
    process.exitCode = await runWithWatchdog(label, command, args);
  } else if (resource === "timed") {
    const file = process.env.TINT_GATE_HELD_LOCK;
    if (!file) throw Error("Expected TINT_GATE_HELD_LOCK");
    process.exitCode = await runTimed([file], label, command, args);
  } else if (resource === "timing-and-launch") {
    const launch = process.env.TINT_GATE_EXCLUSIVE_LOCK;
    const timingLock = process.env.TINT_GATE_TIMING_LOCK;
    if (!launch || !timingLock)
      throw Error("Expected timing and launch lock paths");
    const release = await acquireTimingAndLaunch(launch, timingLock, label);
    try {
      process.exitCode = await runTimed(
        [launch, timingLock],
        label,
        command,
        args,
      );
    } finally {
      release();
    }
  } else if (resource === "memory") {
    process.exitCode = withGateLock(
      gateMemorySlots(process.env),
      label,
      timing,
      (fd) => {
        markStepReady();
        return runGateCommand(command, args, fd);
      },
    );
  } else {
    throw Error("Unknown gate resource: " + resource);
  }
}

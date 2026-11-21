import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  rmSync,
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

async function waitForGateLock(file: string): Promise<130 | 143 | undefined> {
  // A pathname wait retains its position through long holds and does not spin
  // as blocking descriptor-mode lockf can on Darwin.
  const child = spawn("/usr/bin/lockf", ["-k", "-s", file, "/usr/bin/true"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  let interrupted: 130 | 143 | undefined;
  const stop = (signal: NodeJS.Signals) => {
    interrupted ??= signal === "SIGINT" ? 130 : 143;
    child.kill();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const [status, signal] = await once(child, "exit");
    if (interrupted !== undefined) return interrupted;
    if (status !== 0)
      throw Error("lockf wait failed for " + file + ": " + (signal ?? status));
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function acquireGateLockSet(
  files: readonly string[],
): Promise<(() => void) | 130 | 143> {
  if (new Set(files).size !== files.length)
    throw Error("Expected distinct paths for every lock in the set");

  for (;;) {
    const descriptors: number[] = [];
    const release = () => {
      while (descriptors.length > 0) closeSync(descriptors.pop()!);
    };
    let busy: string | undefined;
    try {
      // All callers use launch before timing, including after a queue wakeup.
      for (const file of files) {
        const fd = tryAcquire(file);
        if (fd === undefined) {
          busy = file;
          break;
        }
        descriptors.push(fd);
      }
      if (busy === undefined) return release;
    } finally {
      if (descriptors.length !== files.length) release();
    }
    const interrupted = await waitForGateLock(busy);
    if (interrupted !== undefined) return interrupted;
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
  const ready = process.env.TINT_GATE_STEP_READY;
  const queued = ready === undefined ? undefined : ready + ".queued";
  if (queued) writeFileSync(queued, "");
  try {
    const result = spawnSync(
      "sh",
      [script, label, process.execPath, tool, ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TINT_GATE_EXCLUSIVE_LOCK: process.env.TINT_GATE_LAUNCH_LOCK,
          TINT_GATE_QUEUE_FILE: queued,
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
  } finally {
    if (queued) rmSync(queued, { force: true });
  }
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
    const queued = process.env.TINT_GATE_QUEUE_FILE;
    if (queued) rmSync(queued, { force: true });
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

  let step = "admission";
  let resource = "";
  let evidence: string | undefined;
  let batchWaiting: (() => boolean) | undefined;
  let stepActive = 0;
  let stepQueued = 0;
  function reportStep() {
    if (resource || step === "admission") {
      const active = Math.round(stepActive);
      const queued = Math.round(stepQueued);
      console.log(
        `gate-step step=${step} active-ms=${active} queue-ms=${queued}`,
      );
    }
    stepActive = 0;
    stepQueued = 0;
  }
  function stopGate(pid: number) {
    let inferior: number | undefined;
    try {
      if (evidence && (step === "stage2" || step === "stage3"))
        inferior = stageInferior(join(evidence, step + ".pid"));
    } finally {
      killGateProcess(pid, inferior);
    }
  }
  function timeout(pid: number) {
    const message = `BUDGET kind=active step=${step} timeout-seconds=${budget}`;
    console.error(message + (evidence ? " evidence=" + evidence : ""));
    try {
      if (evidence)
        appendFileSync(
          join(evidence, "budget.tsv"),
          `${step}\t${budget}\tactive\n`,
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
          (!existsSync(join(evidence, "ready-" + step)) ||
            existsSync(join(evidence, "ready-" + step + ".queued")))
        );
      },
      onInterval: (elapsed, queued) => {
        if (queued) stepQueued += elapsed;
        else stepActive += elapsed;
      },
      onClock: (active, queued) => {
        reportStep();
        console.log(`gate-budget active-ms=${active} queue-ms=${queued}`);
      },
      onTimeout: timeout,
      onInterrupt: stopGate,
      onLine: (line) => {
        const gate = /^head=[a-f0-9]+ evidence=(.+)$/.exec(line);
        const started = /^\S+ start ([a-zA-Z0-9_-]+) resource=([a-z-]+)/.exec(
          line,
        );
        if (gate) {
          reportStep();
          evidence = gate[1]!;
          batchWaiting = nativeBatchWaiting(
            join(evidence, "native-images.jsonl"),
          );
          step = "setup";
        } else if (started) {
          reportStep();
          step = started[1]!;
          resource = started[2]!;
        } else if (/^\S+ finish [a-zA-Z0-9_-]+ exit=/.test(line)) {
          reportStep();
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
    const release = await acquireGateLockSet([launch, timingLock]);
    if (typeof release === "number") {
      process.exitCode = release;
    } else {
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

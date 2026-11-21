import { appendFileSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  acquireGateLock,
  acquireGateLockSync,
  gateMemorySlots,
  withGateLock,
  type GateLock,
} from "./lock.ts";

function record(
  output: string,
  phase: string,
  started: number,
  fields: {
    path?: string;
    bytes?: number;
    fixture?: string;
    failed?: boolean;
    memoryWaitMs?: number;
  },
  worker = Number(process.env.TINT_GATE_NATIVE_WORKER_PID) || undefined,
) {
  const elapsedMs = performance.now() - started;
  appendFileSync(
    output,
    JSON.stringify({
      phase,
      elapsedMs,
      pid: process.pid,
      worker,
      endedAt: Date.now(),
      ...fields,
    }) + "\n",
  );
}

export function withNativeFixtureMemory<T>(
  run: (waitMs: number) => T,
  env = process.env,
): T {
  if (!env.TINT_GATE_NATIVE_IMAGES) return run(0);
  const queued = performance.now();
  return withGateLock(
    gateMemorySlots(env),
    "fixture-build",
    env.TINT_GATE_LOCK_TIMING,
    () => run(performance.now() - queued),
  );
}

export function buildNativeFixture(
  fixture: string,
  build: () => string,
  env = process.env,
): string {
  const output = env.TINT_GATE_NATIVE_IMAGES;
  if (!output) return build();
  record(output, "memory-wait-start", performance.now(), { fixture });
  return withNativeFixtureMemory((memoryWaitMs) => {
    const started = performance.now();
    record(output, "build-start", started, { fixture, memoryWaitMs });
    try {
      const path = resolve(build());
      record(output, "build", started, {
        fixture,
        path,
        bytes: statSync(path).size,
        memoryWaitMs,
      });
      return path;
    } catch (error) {
      record(output, "build", started, {
        fixture,
        failed: true,
        memoryWaitMs,
      });
      throw error;
    }
  }, env);
}

// Only paths that still identify the admitted executable can skip admission.
const admitted = new Map<
  string,
  { dev: number; ino: number; ctimeMs: number }
>();

function queueNativeFixture(
  image: string,
  admit: (() => void) | undefined,
  env: NodeJS.ProcessEnv,
  output: string,
) {
  const file = env.TINT_GATE_EXCLUSIVE_LOCK;
  if (!file)
    throw Error("Native fixture execution requires TINT_GATE_EXCLUSIVE_LOCK");
  const path = resolve(image);
  const stat = statSync(path);
  const worker = Number(env.TINT_GATE_NATIVE_WORKER_PID) || undefined;
  const fields = { path, bytes: stat.size };
  const queued = performance.now();
  record(output, "lock-wait-start", queued, fields, worker);
  function begin(lock: GateLock, admissionOnly = false): () => void {
    const acquired = performance.now();
    function releaseLock() {
      try {
        record(output, "lock-release", acquired, fields, worker);
      } finally {
        lock.release();
      }
    }
    let started: number;
    try {
      record(output, "lock-wait", queued, fields, worker);
      const previous = admitted.get(path);
      if (
        admit &&
        !(
          previous?.dev === stat.dev &&
          previous.ino === stat.ino &&
          previous.ctimeMs === stat.ctimeMs
        )
      ) {
        const admissionStarted = performance.now();
        record(output, "admission-start", admissionStarted, fields, worker);
        try {
          admit();
          admitted.set(path, {
            dev: stat.dev,
            ino: stat.ino,
            ctimeMs: stat.ctimeMs,
          });
          record(output, "admission", admissionStarted, fields, worker);
        } catch (error) {
          record(
            output,
            "admission",
            admissionStarted,
            { ...fields, failed: true },
            worker,
          );
          throw error;
        }
      }
      started = performance.now();
      if (!admissionOnly)
        record(output, "execution-start", started, fields, worker);
    } catch (error) {
      releaseLock();
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      try {
        if (!admissionOnly)
          record(output, "execution", started, fields, worker);
      } finally {
        releaseLock();
      }
    };
  }
  return { file, begin };
}

export async function beginNativeFixtureExecution(
  image: string,
  admit: (() => void) | undefined,
  env = process.env,
): Promise<() => void> {
  const output = env.TINT_GATE_NATIVE_IMAGES;
  if (!output) {
    admit?.();
    return () => {};
  }
  const { file, begin } = queueNativeFixture(image, admit, env, output);
  return begin(
    await acquireGateLock([file], "fixture-launch", env.TINT_GATE_LOCK_TIMING),
  );
}

export function runNativeFixture<T>(
  image: string,
  execute: () => T,
  admit?: () => void,
  env = process.env,
  admissionOnly = false,
): T {
  const output = env.TINT_GATE_NATIVE_IMAGES;
  if (!output) {
    admit?.();
    return execute();
  }
  // These callers perform admission and execution synchronously, releasing
  // the launch lock before returning to the event loop.
  const { file, begin } = queueNativeFixture(image, admit, env, output);
  const release = begin(
    acquireGateLockSync([file], "fixture-launch", env.TINT_GATE_LOCK_TIMING),
    admissionOnly,
  );
  try {
    return execute();
  } finally {
    release();
  }
}

/** In the gate, callers with their own launch path defer admission to it. */
export function nativeFixtureBuildOnlyMode(): string {
  return process.env.TINT_GATE_NATIVE_IMAGES ? "defer-admission" : "1";
}

if (import.meta.main) {
  const journal = process.argv[2];
  if (!journal) throw Error("Expected a native fixture journal");
  const images = {
    built: new Set<string>(),
    admitted: new Set<string>(),
    launched: new Set<string>(),
  };
  if (statSync(journal, { throwIfNoEntry: false })) {
    for (const line of readFileSync(journal, "utf8").trimEnd().split("\n")) {
      if (!line) continue;
      const event = JSON.parse(line) as {
        phase: string;
        path?: string;
        failed?: boolean;
      };
      if (event.path && !event.failed) {
        if (event.phase === "build") images.built.add(event.path);
        if (event.phase === "admission") images.admitted.add(event.path);
        if (event.phase === "execution-start") images.launched.add(event.path);
      }
    }
  }
  console.log(
    `native-images built=${images.built.size} admitted=${images.admitted.size} launch-attempted=${images.launched.size} journal=${journal}`,
  );
}

import { writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";

interface Settings {
  intervalMs: number;
  stallMs: number;
}
export interface HeartbeatState {
  selection: string;
  phase: string;
  since: number;
  total: number;
  done: number;
  pass: number;
  fail: number;
  unsupported: number;
  infra: number;
}
export function heartbeatSettings(env: NodeJS.ProcessEnv): Settings {
  const parse = (name: string, fallback: number, minimum: number) => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > 2147483647
    )
      throw Error(
        name + " must be an integer between " + minimum + " and 2147483647",
      );
    return value;
  };
  const intervalMs = parse("TINT_TEST262_HEARTBEAT_MS", 30000, 0);
  return {
    intervalMs,
    stallMs: parse(
      "TINT_TEST262_STALL_MS",
      Math.min(2147483647, 5 * (intervalMs || 30000)),
      1,
    ),
  };
}
interface Timer {
  unref(): void;
}
interface Dependencies {
  now?: () => number;
  write?: (line: string) => void;
  waitingPids?: () => string;
  schedule?: (callback: () => void, interval: number) => Timer;
  cancel?: (timer: Timer) => void;
}
const stderr = (line: string) => {
  writeSync(2, line + "\n");
};
/** The timer runs in a worker: compilation, spawnSync and pause waits block the main thread. */
export class Heartbeat {
  state: HeartbeatState | undefined;
  readonly #settings: Settings;
  readonly #deps: Dependencies;
  #timer: Timer | undefined;
  #closed = false;
  constructor(settings: Settings, deps: Dependencies = {}) {
    this.#settings = settings;
    this.#deps = deps;
    if (settings.intervalMs > 0) {
      this.#timer = (deps.schedule ?? setInterval)(
        () => this.tick(),
        settings.intervalMs,
      );
      this.#timer.unref();
    }
  }
  update(state: HeartbeatState, emit = true): void {
    this.state = state;
    if (emit) this.tick();
  }
  tick(): void {
    if (
      this.#closed ||
      this.#settings.intervalMs === 0 ||
      this.state === undefined
    )
      return;
    const now = (this.#deps.now ?? Date.now)();
    const s = this.state,
      elapsed = Math.max(0, now - s.since);
    const stalled = elapsed >= this.#settings.stallMs;
    // JSON strings keep paths/selections containing newlines on one physical line.
    (this.#deps.write ?? stderr)(
      new Date(now).toISOString() +
        " [Test262" +
        (stalled ? " STALL" : "") +
        "] selection=" +
        JSON.stringify(s.selection) +
        " phase=" +
        JSON.stringify(s.phase) +
        " elapsed=" +
        elapsed +
        "ms done=" +
        s.done +
        "/" +
        s.total +
        " pass=" +
        s.pass +
        " fail=" +
        s.fail +
        " unsupported=" +
        s.unsupported +
        " infra=" +
        s.infra +
        (stalled
          ? " waiting " +
            (this.#deps.waitingPids?.() ?? "runner=" + process.pid)
          : ""),
    );
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer !== undefined)
      (
        this.#deps.cancel ?? ((timer) => clearInterval(timer as NodeJS.Timeout))
      )(this.#timer);
  }
}
/** Include all descendants: LLDB may be waiting for a stub before it records an inferior. */
function waitingPids(runner: number): string {
  const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid="], {
    encoding: "utf8",
    timeout: 1000,
  });
  if (result.status !== 0)
    return "runner=" + runner + " child/inferior PIDs unavailable";
  const rows = result.stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number));
  const descendants = new Set([runner]);
  let size: number;
  do {
    size = descendants.size;
    for (const [pid, parent] of rows)
      if (
        pid !== result.pid &&
        parent !== undefined &&
        descendants.has(parent) &&
        pid !== undefined
      )
        descendants.add(pid);
  } while (size !== descendants.size);
  descendants.delete(runner);
  return (
    "runner=" +
    runner +
    " child/inferior=" +
    ([...descendants].join(",") || "none")
  );
}
export function startNativeHeartbeat(selection: string) {
  const settings = heartbeatSettings(process.env);
  const display = new Heartbeat(settings, {
    schedule: () => ({ unref() {} }),
    cancel() {},
  });
  let state: HeartbeatState = {
    selection,
    phase: "initializing",
    since: Date.now(),
    total: 0,
    done: 0,
    pass: 0,
    fail: 0,
    unsupported: 0,
    infra: 0,
  };
  display.update(state);
  const worker =
    settings.intervalMs === 0
      ? undefined
      : new Worker(new URL(import.meta.url), {
          execArgv: process.execArgv.filter(
            (arg) => !arg.startsWith("--input-type"),
          ),
          workerData: {
            nativeHeartbeat: true,
            settings,
            state,
            runner: process.pid,
          },
        });
  worker?.unref();
  worker?.on("error", (error) =>
    stderr(
      new Date().toISOString() +
        " [Test262 STALL] heartbeat worker failed: " +
        String(error),
    ),
  );
  return {
    phase(phase: string) {
      state = { ...state, phase, since: Date.now() };
      display.update(state);
      worker?.postMessage(state);
    },
    counts(
      counts: Pick<
        HeartbeatState,
        "total" | "done" | "pass" | "fail" | "unsupported" | "infra"
      >,
    ) {
      state = { ...state, ...counts };
      display.update(state, false);
      worker?.postMessage(state);
    },
    async close() {
      display.close();
      await worker?.terminate();
    },
  };
}
if (!isMainThread && workerData?.nativeHeartbeat === true) {
  const heartbeat = new Heartbeat(workerData.settings, {
    waitingPids: () => waitingPids(workerData.runner),
  });
  heartbeat.update(workerData.state, false);
  parentPort!.on("message", (state: HeartbeatState) =>
    heartbeat.update(state, false),
  );
  parentPort!.on("close", () => heartbeat.close());
}

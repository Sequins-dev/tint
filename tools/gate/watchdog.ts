import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { nativeBatchState } from "./native-batch-clock.ts";

interface ProcessEntry {
  pid: number;
  parent: number;
  state: string;
  cpuTime: string;
  command: string;
}

function processTree(root: number, includeRoot = false): ProcessEntry[] {
  const result = spawnSync(
    "/bin/ps",
    ["-ax", "-o", "pid=,ppid=,state=,time=,comm="],
    {
      encoding: "utf8",
      timeout: 2000,
      killSignal: "SIGKILL",
    },
  );
  const children = new Map<number, ProcessEntry[]>();
  let rootEntry: ProcessEntry | undefined;
  for (const line of (result.stdout ?? "").split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const parent = Number(match[2]);
    const entry = {
      pid: Number(match[1]),
      parent,
      state: match[3]!,
      cpuTime: match[4]!,
      command: basename(match[5]!),
    };
    if (entry.pid === root) rootEntry = entry;
    const siblings = children.get(parent);
    if (siblings) siblings.push(entry);
    else children.set(parent, [entry]);
  }

  const tree: ProcessEntry[] = [];
  function collect(pid: number) {
    for (const child of children.get(pid) ?? []) {
      collect(child.pid);
      tree.push(child);
    }
  }
  collect(root);
  if (includeRoot && rootEntry) tree.push(rootEntry);
  return tree;
}

export function stageInferior(
  pidFile = process.env.TINT_GATE_INFERIOR_PID_FILE,
): number | undefined {
  if (!pidFile) return undefined;
  try {
    const pid = Number(readFileSync(pidFile, "utf8"));
    return Number.isSafeInteger(pid) && pid > 1 ? pid : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

export function killGateProcess(
  root: number,
  inferior?: number,
  earlierTree: ProcessEntry[] = [],
) {
  const remaining = processTree(root);
  if (inferior !== undefined) kill(inferior);
  kill(-root);
  kill(root);
  for (const pid of new Set(
    [...remaining, ...earlierTree].map(({ pid }) => pid),
  ))
    kill(pid);
}

function kill(pid: number) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH")
      console.error("Watchdog could not kill PID/group", pid, error);
  }
}

function isDebugger({ command }: ProcessEntry): boolean {
  return /^(lldb|lldb-dap|lldb-server|debugserver)$/.test(command);
}

function findInferiors(tree: ProcessEntry[]): ProcessEntry[] {
  const explicit = stageInferior();
  const known = tree.find(({ pid }) => pid === explicit);
  if (known) return [known];
  const inferiorParents = new Set(
    tree
      .filter(({ command }) =>
        /^(debugserver|lldb-server|pprofessor)$/.test(command),
      )
      .map(({ pid }) => pid),
  );
  return tree.filter(
    (entry) => inferiorParents.has(entry.parent) && !isDebugger(entry),
  );
}

function diagnoseStall(
  root: number,
  label: string,
  seconds: number,
  evidence: string,
  idle?: { target: number; tree: ProcessEntry[] },
) {
  const tree = idle?.tree ?? processTree(root, true);
  let inferior: number | undefined;
  try {
    inferior = findInferiors(tree)[0]?.pid;
    const target = idle?.target ?? inferior ?? tree[0]?.pid ?? root;
    const status = idle ? 125 : 124;
    const report = join(evidence, "stall-" + label + ".txt");
    console.error(
      `STALL ${label} ${idle ? "made no progress for" : "exceeded"} ${seconds}s (PID ${target}); evidence: ${report}`,
    );
    appendFileSync(
      join(evidence, "stalls.tsv"),
      `${label}\t${seconds}\t${target}\t${report}\t${status}\n`,
    );
    if (process.platform === "darwin") {
      const sample = spawnSync(
        "/usr/bin/sample",
        [String(target), "5", "-file", report],
        {
          stdio: ["ignore", "inherit", "inherit"],
          timeout: 10_000,
          killSignal: "SIGKILL",
        },
      );
      if (sample.status !== 0)
        appendFileSync(
          report,
          `sample failed for PID ${target}: ${sample.error ?? sample.signal ?? sample.status}\n`,
        );
    } else {
      appendFileSync(report, `Timed out after ${seconds}s (PID ${target})\n`);
    }
    appendFileSync(
      report,
      "\nPID PPID STATE CPU-TIME COMMAND\n" +
        tree
          .map((p) =>
            [p.pid, p.parent, p.state, p.cpuTime, p.command].join(" "),
          )
          .join("\n") +
        "\n",
    );
  } finally {
    // The job has its own group. Also kill descendants such as debugger
    // inferiors and detached helpers that may have started their own groups.
    killGateProcess(root, inferior, tree);
  }
}

function watchProgress(
  seconds: number,
  scope: (root: number) => number | undefined,
): (root: number) => { target: number; tree: ProcessEntry[] } | undefined {
  let lastRoot: number | undefined;
  let lastProgress = performance.now();
  let previous = new Map<number, string>();
  return (root) => {
    const holder = scope(root);
    const tree = holder === undefined ? [] : processTree(holder, true);
    const inferiors = findInferiors(tree);
    const debuggers = tree.filter(isDebugger);
    const watched = inferiors.length
      ? inferiors
      : debuggers.length
        ? debuggers
        : tree;
    const now = performance.now();
    const current = new Map(watched.map((p) => [p.pid, p.cpuTime]));
    // Inspect cumulative CPU time, not ps's decaying percentage. Ignore CPU
    // used by the debugger or profiler once the inferior can be identified.
    if (
      holder !== lastRoot ||
      watched.length === 0 ||
      watched.some((p) => previous.get(p.pid) !== p.cpuTime) ||
      [...previous.keys()].some((pid) => !current.has(pid))
    ) {
      lastProgress = now;
    }
    lastRoot = holder;
    previous = current;
    if (now - lastProgress >= seconds * 1000)
      return { target: watched[0]!.pid, tree };
  };
}

/** Validates a watched step's label and deadlines from the environment. */
export function watchdogSettings(label: string, env = process.env) {
  const seconds = Number(env.TINT_GATE_STEP_TIMEOUT);
  const evidence = env.TINT_GATE_EVIDENCE;
  if (
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > 2_147_483 ||
    !evidence
  )
    throw Error(
      "Expected TINT_GATE_STEP_TIMEOUT (1–2147483 seconds) and TINT_GATE_EVIDENCE",
    );
  if (!/^[a-zA-Z0-9_-]+$/.test(label))
    throw Error("Invalid gate step: " + label);
  const idleSeconds = Number(env.TINT_GATE_IDLE_TIMEOUT ?? "120");
  if (
    !Number.isInteger(idleSeconds) ||
    idleSeconds < 1 ||
    idleSeconds > 2_147_483
  )
    throw Error("Expected TINT_GATE_IDLE_TIMEOUT (1–2147483 seconds)");
  return { seconds, evidence, idleSeconds };
}

export async function runWithWatchdog(
  label: string,
  command: string,
  args: string[],
  locked = false,
): Promise<number> {
  const { seconds, evidence, idleSeconds } = watchdogSettings(label);
  const journal = process.env.TINT_GATE_NATIVE_IMAGES;
  const native =
    label === "check-native" && journal ? nativeBatchState(journal) : undefined;
  const progress =
    locked || native
      ? watchProgress(
          idleSeconds,
          native ? () => native().holder : (root) => root,
        )
      : undefined;
  return runWithDeadline(command, args, seconds, {
    onTimeout: (pid) => diagnoseStall(pid, label, seconds, evidence),
    onInterrupt: killGateProcess,
    waiting: native ? () => native().waiting : undefined,
    ...(native
      ? {
          onClock: (active: number, queued: number) => {
            console.log(
              `native-batch active-ms=${active} all-workers-wait-ms=${queued}`,
            );
          },
        }
      : {}),
    idle: progress
      ? (pid) => {
          const stalled = progress(pid);
          if (!stalled) return;
          return () =>
            diagnoseStall(pid, label, idleSeconds, evidence, stalled);
        }
      : undefined,
  });
}

interface DeadlineHandlers {
  onTimeout: (pid: number) => void;
  onInterval?: (elapsedMs: number, queued: boolean) => void;
  onClock?: (activeMs: number, waitingMs: number) => void;
  onInterrupt?: (pid: number) => void;
  onLine?: (line: string) => void;
  waiting?: (() => boolean) | undefined;
  idle?: ((pid: number) => (() => void) | undefined) | undefined;
}

export function runWithDeadline(
  command: string,
  args: string[],
  seconds: number,
  {
    onTimeout,
    onInterrupt,
    onLine,
    waiting,
    idle,
    onInterval,
    onClock,
  }: DeadlineHandlers,
): Promise<number> {
  const child = spawn(command, args, {
    detached: true,
    stdio: ["inherit", onLine ? "pipe" : "inherit", "inherit"],
  });
  if (child.stdout && onLine) {
    child.stdout.pipe(process.stdout, { end: false });
  }
  return new Promise((resolve, reject) => {
    function stop(status: number, cleanup: (pid: number) => void) {
      clearDeadline();
      try {
        if (child.pid !== undefined) cleanup(child.pid);
      } catch (error) {
        console.error(`${command}: watchdog cleanup failed:`, error);
      } finally {
        child.unref();
        resolve(status);
      }
    }
    const interrupt = () => stop(130, onInterrupt!);
    const terminate = () => stop(143, onInterrupt!);
    const budgetMs = seconds * 1000;
    let tick = performance.now();
    let activeMs = 0;
    let waitingMs = 0;
    let paused = waiting?.() ?? false;
    let finished = false;
    function account() {
      const now = performance.now();
      const elapsed = now - tick;
      if (paused) waitingMs += elapsed;
      else activeMs += elapsed;
      onInterval?.(elapsed, paused);
      tick = now;
    }
    if (child.stdout && onLine) {
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (finished) return;
        account();
        onLine(line);
        paused = waiting?.() ?? false;
      });
    }
    let nextIdleCheck = tick;
    const timer =
      waiting || idle
        ? setInterval(() => {
            account();
            try {
              paused = waiting?.() ?? false;
              if (idle && child.pid !== undefined && tick >= nextIdleCheck) {
                nextIdleCheck = tick + 500;
                const stalled = idle(child.pid);
                if (stalled) {
                  stop(125, stalled);
                  return;
                }
              }
            } catch (error) {
              console.error("Could not inspect gate progress:", error);
              stop(1, killGateProcess);
              return;
            }
            if (activeMs >= budgetMs) stop(124, onTimeout);
          }, 100)
        : setTimeout(() => stop(124, onTimeout), budgetMs);
    function clearDeadline() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (onClock) {
        account();
        onClock(Math.round(activeMs), Math.round(waitingMs));
      }
      if (onInterrupt) {
        process.off("SIGINT", interrupt);
        process.off("SIGTERM", terminate);
      }
    }
    if (onInterrupt) {
      process.once("SIGINT", interrupt);
      process.once("SIGTERM", terminate);
    }
    child.once("error", (error) => {
      clearDeadline();
      reject(error);
    });
    child.once("close", (status, signal) => {
      clearDeadline();
      if (signal !== null) console.error(command, "terminated by", signal);
      resolve(status ?? 1);
    });
  });
}

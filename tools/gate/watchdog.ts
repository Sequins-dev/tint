import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

interface ProcessEntry {
  pid: number;
  parent: number;
  command: string;
}

function processTree(root: number): ProcessEntry[] {
  const result = spawnSync("/bin/ps", ["-ax", "-o", "pid=,ppid=,comm="], {
    encoding: "utf8",
    timeout: 2000,
    killSignal: "SIGKILL",
  });
  const children = new Map<number, ProcessEntry[]>();
  for (const line of (result.stdout ?? "").split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const parent = Number(match[2]);
    const entry = {
      pid: Number(match[1]),
      parent,
      command: basename(match[3]!),
    };
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

function diagnoseStall(
  root: number,
  label: string,
  seconds: number,
  evidence: string,
) {
  const tree = processTree(root);
  let inferior: number | undefined;
  try {
    inferior = stageInferior();
    const debuggerPids = new Set(
      tree
        .filter(({ command }) =>
          /^(lldb|lldb-server|debugserver)$/.test(command),
        )
        .map(({ pid }) => pid),
    );
    const target =
      inferior ??
      tree.find(
        ({ pid, parent }) => debuggerPids.has(parent) && !debuggerPids.has(pid),
      )?.pid ??
      tree[0]?.pid ??
      root;
    const report = join(evidence, "stall-" + label + ".txt");
    console.error(
      `STALL ${label} exceeded ${seconds}s (PID ${target}); evidence: ${report}`,
    );
    appendFileSync(
      join(evidence, "stalls.tsv"),
      `${label}\t${seconds}\t${target}\t${report}\n`,
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
  } finally {
    // The job has its own group. Also kill descendants such as debugger
    // inferiors and detached helpers that may have started their own groups.
    killGateProcess(root, inferior, tree);
  }
}

export async function runWithWatchdog(
  label: string,
  command: string,
  args: string[],
): Promise<number> {
  const seconds = Number(process.env.TINT_GATE_STEP_TIMEOUT);
  const evidence = process.env.TINT_GATE_EVIDENCE;
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

  return runWithDeadline(command, args, seconds, {
    onTimeout: (pid) => diagnoseStall(pid, label, seconds, evidence),
  });
}

interface DeadlineHandlers {
  onTimeout: (pid: number) => void;
  onInterrupt?: (pid: number) => void;
  onLine?: (line: string) => void;
}

export function runWithDeadline(
  command: string,
  args: string[],
  seconds: number,
  { onTimeout, onInterrupt, onLine }: DeadlineHandlers,
): Promise<number> {
  const child = spawn(command, args, {
    detached: true,
    stdio: ["inherit", onLine ? "pipe" : "inherit", "inherit"],
  });
  if (child.stdout && onLine) {
    child.stdout.pipe(process.stdout, { end: false });
    createInterface({ input: child.stdout }).on("line", onLine);
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
    const timer = setTimeout(() => stop(124, onTimeout), seconds * 1000);
    function clearDeadline() {
      clearTimeout(timer);
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

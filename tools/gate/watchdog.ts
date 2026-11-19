import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

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

function stageInferior(): number | undefined {
  const pidFile = process.env.TINT_GATE_INFERIOR_PID_FILE;
  if (!pidFile) return undefined;
  try {
    const pid = Number(readFileSync(pidFile, "utf8"));
    return Number.isSafeInteger(pid) && pid > 1 ? pid : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
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
    if (inferior !== undefined) kill(inferior);
    const remaining = processTree(root);
    kill(-root);
    kill(root);
    for (const pid of new Set([...remaining, ...tree].map(({ pid }) => pid)))
      kill(pid);
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

  const child = spawn(command, args, { detached: true, stdio: "inherit" });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        diagnoseStall(child.pid!, label, seconds, evidence);
      } catch (error) {
        console.error(
          `STALL ${label} exceeded ${seconds}s; watchdog diagnostics failed:`,
          error,
        );
      } finally {
        child.unref();
        resolve(124);
      }
    }, seconds * 1000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (status, signal) => {
      clearTimeout(timer);
      if (signal !== null) console.error(command, "terminated by", signal);
      resolve(status ?? 1);
    });
  });
}

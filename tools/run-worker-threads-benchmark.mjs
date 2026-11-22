import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const [host, image] = process.argv.slice(2);
if (host !== "node" && !(host === "native" && image))
  throw new Error(
    "Usage: node run-worker-threads-benchmark.mjs node|native [image]",
  );

const workload = new URL("./worker-threads-benchmark.mjs", import.meta.url);
const child =
  host === "node"
    ? spawn(
        process.execPath,
        [
          "-e",
          "import(process.argv[1]).then(({run}) => run(process.argv[2], () => performance.now())).then(status => { process.exitCode = status; });",
          workload.href,
          fileURLToPath(workload),
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      )
    : spawn(
        process.env.TINT_WORKER_BENCH_LLDB ?? "lldb",
        [
          "--no-lldbinit",
          "--batch",
          "-o",
          "settings set target.disable-aslr false",
          "-o",
          "process launch --stop-at-entry",
          "-o",
          "script assert lldb.process.GetState() == lldb.eStateStopped; print('WORKER_BENCH_PID', lldb.process.GetProcessID())",
          "-o",
          "continue",
          "-o",
          "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42; print('INFERIOR_EXIT', 42)",
          "--",
          resolve(image),
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );

const linux = process.platform === "linux";
const ticksPerSecond = linux
  ? Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }))
  : undefined;
let pid = host === "node" ? child.pid : undefined;
function cpuMs() {
  if (pid === undefined) throw new Error("benchmark process ID unavailable");
  if (linux) {
    const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
    const fields = stat
      .slice(stat.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/);
    return ((Number(fields[11]) + Number(fields[12])) / ticksPerSecond) * 1000;
  }
  const time = execFileSync("ps", ["-p", String(pid), "-o", "time="], {
    encoding: "utf8",
  }).trim();
  const seconds = time
    .split(":")
    .reduce((total, item) => total * 60 + Number(item), 0);
  return seconds * 1000;
}

const idle = new Map();
let inferredExit = false;
let failure;
const output = createInterface({ input: child.stdout });
output.on("line", (line) => {
  console.log(line);
  try {
    const inferior = /^WORKER_BENCH_PID (\d+)$/.exec(line);
    if (inferior) pid = Number(inferior[1]);
    if (line === "INFERIOR_EXIT 42") inferredExit = true;
    const marker = /^WORKER_BENCH_IDLE_(BEGIN|END) (\d+)$/.exec(line.trim());
    if (marker) {
      const workers = Number(marker[2]);
      if (marker[1] === "BEGIN") idle.set(workers, cpuMs());
      else {
        const start = idle.get(workers);
        if (start === undefined) throw new Error("missing initial CPU sample");
        console.log(
          "WORKER_BENCH_IDLE_CPU " +
            JSON.stringify({
              workers,
              milliseconds: cpuMs() - start,
            }),
        );
      }
    }
  } catch (error) {
    failure ??= error;
  }
});
child.stderr.pipe(process.stderr);
const timeout = setTimeout(() => {
  failure ??= new Error("worker benchmark timed out");
  child.kill("SIGTERM");
}, 180000);
try {
  const status = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (failure !== undefined) throw failure;
  if (host === "node" ? status !== 42 : status !== 0 || !inferredExit)
    throw new Error(host + " benchmark exit " + status);
} finally {
  clearTimeout(timeout);
}

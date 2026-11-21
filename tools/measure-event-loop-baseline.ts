import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";

const image = process.argv[2];
if (process.platform !== "darwin" || image === undefined)
  throw Error(
    "usage on macOS: node tools/measure-event-loop-baseline.ts IMAGE",
  );

for (let round = 1; round <= 3; round++) {
  const child = spawn(
    "lldb",
    [
      "--no-lldbinit",
      "--batch",
      "-o",
      "settings set target.disable-aslr false",
      "-o",
      "process launch --stop-at-entry",
      "-o",
      "script assert lldb.process.GetState() == lldb.eStateStopped; print('BASELINE_PID', lldb.process.GetProcessID(), flush=True)",
      "-o",
      "continue",
      "-o",
      "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42; print('BASELINE_EXIT', 42)",
      "--",
      image,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const startup: number[] = [];
  const rss = new Map<string, number>();
  let pid: string | undefined;
  let rtt: number | undefined;
  let inferiorExited = false;
  for await (const line of createInterface({ input: child.stdout })) {
    console.log(line);
    const [marker, value] = line.split(" ");
    if (value === undefined) continue;
    if (marker === "BASELINE_PID") pid = value;
    if (marker === "BASELINE_CREATE_US") startup.push(Number(value));
    if (marker === "BASELINE_RTT_US") rtt = Number(value);
    if (marker === "BASELINE_EXIT") inferiorExited = value === "42";
    if (marker === "BASELINE_RSS") {
      assert(pid);
      const sample = execFileSync("/bin/ps", ["-o", "rss=", "-p", pid], {
        encoding: "utf8",
      });
      const kib = Number(sample.trim());
      assert(kib > 0);
      rss.set(value, kib);
    }
  }
  assert.equal(await exit, 0);
  assert(inferiorExited);
  assert.equal(startup.length, 32);
  assert(startup.every((time) => Number.isFinite(time) && time > 0));
  assert(rtt !== undefined && rtt > 0);
  const before = rss.get("before");
  const workers = rss.get("workers");
  assert(before !== undefined && workers !== undefined);
  startup.sort((a, b) => a - b);
  console.log("BASELINE_SUMMARY", {
    round,
    startupMedianUs: (startup[15]! + startup[16]!) / 2,
    startupMinUs: startup[0],
    startupMaxUs: startup[31],
    rttMeanUs: rtt,
    baselineRssKiB: before,
    workersRssKiB: workers,
    deltaRssKiB: workers - before,
  });
}

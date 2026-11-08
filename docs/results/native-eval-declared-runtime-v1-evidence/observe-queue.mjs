// Observe test images launched by a queue process tree: retain each executing
// image once and record lifetime inferior CPU counters. Read-only observer.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync, chmodSync, existsSync } from "node:fs";
import { loadavg } from "node:os";
const [queuePid, root, stopFile] = process.argv.slice(2);
mkdirSync(root, { recursive: true });
const seen = new Set(), records = [], children = [];
let last = 0;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
while (alive(Number(queuePid)) && !existsSync(stopFile)) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" }).split("\n").flatMap((line) => { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return m ? [{ pid: +m[1], parent: +m[2], command: m[3] }] : []; });
  const ids = new Set([Number(queuePid)]);
  for (let n = 0; n < 10; n++) for (const row of rows) if (ids.has(row.parent)) ids.add(row.pid);
  for (const row of rows) {
    if (!ids.has(row.pid) || seen.has(row.pid) || !/\/tint-test262-image-[^/]+\/test \d+$/.test(row.command)) continue;
    seen.add(row.pid);
    const image = row.command.slice(0, row.command.lastIndexOf(" ")), index = records.length, directory = root + "/obs-" + index;
    mkdirSync(directory);
    try { copyFileSync(image, directory + "/image"); chmodSync(directory + "/image", 0o755); } catch (error) { }
    const record = { index, pid: row.pid, command: row.command, observedUTC: new Date().toISOString(), load: loadavg() };
    records.push(record);
    writeFileSync(directory + "/initial.json", JSON.stringify(record, null, 2) + "\n");
    writeFileSync(root + "/observations.json", JSON.stringify(records, null, 2) + "\n");
    const c = spawn("python3", [".tint-bootstrap/perf/observe-selfbuild-cpu-v2.py", directory], { stdio: ["ignore", "inherit", "inherit"] });
    children.push(new Promise((resolve) => c.once("close", resolve)));
  }
  if (Date.now() - last > 60000) { last = Date.now(); console.log(new Date().toISOString(), "observer alive; images", records.length); }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
await Promise.all(children);
console.log("observer done", records.length);

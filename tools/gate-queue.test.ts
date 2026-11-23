import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const darwinOnly = { skip: process.platform !== "darwin", timeout: 120_000 };
const withLock = fileURLToPath(new URL("./gate/with-lock.sh", import.meta.url));

interface Finished {
  status: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}

interface Job {
  child: ChildProcess;
  pid: number;
  /** Settles once the output pipes close, after any orphaned descendants. */
  done: Promise<Finished>;
}

/** Waits for a killed job's own process, not the descendants it orphaned. */
function killed(job: Job): Promise<NodeJS.Signals | null> {
  job.child.kill("SIGKILL");
  return job.child.exitCode !== null || job.child.signalCode !== null
    ? Promise.resolve(job.child.signalCode)
    : once(job.child, "exit").then(([, signal]) => signal);
}

/** An isolated queue: temporary lock paths, queue and evidence directory. */
class Queue {
  readonly directory = mkdtempSync(join(tmpdir(), "tint-gate-queue-"));
  readonly launch = join(this.directory, "launch.lock");
  readonly timing = join(this.directory, "timing.lock");
  readonly env: NodeJS.ProcessEnv;
  readonly #jobs: Job[] = [];

  constructor() {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TINT_GATE_EXCLUSIVE_LOCK: this.launch,
      TINT_GATE_TIMING_LOCK: this.timing,
      TINT_GATE_EVIDENCE: this.directory,
      TINT_GATE_STEP_TIMEOUT: "120",
      TINT_GATE_IDLE_TIMEOUT: "120",
    };
    // The test may itself run under a gate lock.
    for (const name of [
      "TINT_GATE_TICKET",
      "TINT_GATE_LOCK_QUEUE",
      "TINT_GATE_HELD_LOCK",
      "TINT_GATE_LOCK_TIMING",
      "TINT_GATE_STEP_READY",
      "TINT_GATE_QUEUE_FILE",
    ])
      delete env[name];
    this.env = env;
  }

  spawn(command: string, args: string[]): Job {
    const child = spawn(command, args, {
      cwd: this.directory,
      env: this.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const done = new Promise<Finished>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) =>
        resolve({ status, signal, output }),
      );
    });
    const job = { child, pid: child.pid!, done };
    this.#jobs.push(job);
    return job;
  }

  /** with-lock.sh execs Node, so the job's pid is the queue process. */
  request(resource: string, label: string, script: string): Job {
    return this.spawn("sh", [withLock, resource, label, "sh", "-c", script]);
  }

  /** A raw lockf holder outside the queue, as legacy callers use. */
  outside(lock: string, label: string): Job {
    return this.spawn("/usr/bin/lockf", ["-k", lock, "sh", "-c", hold(label)]);
  }

  status(): string {
    const result = spawnSync("sh", [withLock, "status"], {
      cwd: this.directory,
      env: this.env,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }

  ticket(seq: number) {
    return join(
      this.directory,
      "tint-gate-queue",
      String(seq).padStart(10, "0") + ".ticket",
    );
  }

  tickets() {
    return readdirSync(join(this.directory, "tint-gate-queue")).filter((name) =>
      name.endsWith(".ticket"),
    );
  }

  order(): string[] {
    const file = join(this.directory, "order");
    return existsSync(file)
      ? readFileSync(file, "utf8").split("\n").filter(Boolean)
      : [];
  }

  started(label: string) {
    return existsSync(join(this.directory, label + ".started"));
  }

  release(label: string) {
    writeFileSync(join(this.directory, label + ".release"), "");
  }

  /** Probes a lock without waiting: true when another process holds it. */
  held(lock: string) {
    const status = spawnSync("/usr/bin/lockf", [
      "-k",
      "-s",
      "-t",
      "0",
      lock,
      "/usr/bin/true",
    ]).status;
    assert.ok(status === 0 || status === 75, "lockf probe failed: " + status);
    return status === 75;
  }

  async close() {
    for (const label of readdirSync(this.directory))
      if (label.endsWith(".started")) this.release(label.slice(0, -8));
    for (const { child } of this.#jobs)
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    await Promise.allSettled(this.#jobs.map((job) => job.done));
    rmSync(this.directory, { recursive: true, force: true });
  }
}

/**
 * Holds until the test releases the label, then records it. An orphaned
 * holder also stops once the test removes its directory.
 */
function hold(label: string) {
  return `touch ${label}.started
    until [ -e ${label}.release ] || [ ! -d "$PWD" ]; do sleep 0.02; done
    echo ${label} >> order`;
}

function record(label: string) {
  return `echo ${label} >> order`;
}

async function waitUntil(condition: () => boolean, what: string) {
  const deadline = performance.now() + 30_000;
  while (!condition()) {
    if (performance.now() > deadline)
      throw Error("Timed out waiting for " + what);
    await delay(20);
  }
}

/** Child processes of `parent` whose command line names `path`. */
function childrenNaming(parent: number, path: string) {
  const ps = spawnSync("/bin/ps", ["-axww", "-o", "pid=,ppid=,command="], {
    encoding: "utf8",
  });
  return ps.stdout
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match && Number(match[2]) === parent)
    .filter((match) => match![3]!.split(" ").includes(path))
    .map((match) => Number(match![1]));
}

async function succeeded(job: Job) {
  const result = await job.done;
  assert.equal(result.status, 0, result.output);
  return result;
}

async function withQueue(run: (queue: Queue) => Promise<void>) {
  const queue = new Queue();
  try {
    await run(queue);
  } finally {
    await queue.close();
  }
}

test(
  "a dual-lock request runs before later single-lock requests",
  darwinOnly,
  () =>
    withQueue(async (queue) => {
      const first = queue.request("timing", "first", hold("first"));
      await waitUntil(() => queue.started("first"), "the timing holder");
      const dual = queue.request("both", "dual", record("dual"));
      await waitUntil(() => existsSync(queue.ticket(2)), "the dual ticket");
      const launch = queue.request("launch", "launch", record("launch"));
      await waitUntil(() => existsSync(queue.ticket(3)), "the launch ticket");
      const timing = queue.request("timing", "timing", record("timing"));
      // The launch lock stays free, but the later launch request waits for the
      // earlier dual request instead of overtaking it.
      await waitUntil(
        () => childrenNaming(launch.pid, queue.ticket(2)).length === 1,
        "the launch request to wait for the dual ticket",
      );
      await waitUntil(
        () => existsSync(queue.ticket(4)),
        "the timing request's ticket",
      );
      assert.equal(queue.held(queue.launch), false);
      assert.deepEqual(queue.order(), []);

      const report = queue.status();
      assert.match(report, /^ {2}launch +\S+ +free$/m);
      assert.match(report, /^ {2}timing +\S+ +held by #1 \(first\)$/m);
      assert.match(report, /^ {2}#1 timing first +pid \d+ +running \S+ after/m);
      assert.match(
        report,
        /^ {2}#2 both +dual +pid \d+ +waiting \S+ behind #1$/m,
      );
      assert.match(
        report,
        /^ {2}#3 launch launch +pid \d+ +waiting \S+ behind #2$/m,
      );
      assert.match(
        report,
        /^ {2}#4 timing timing +pid \d+ +waiting \S+ behind #1, #2$/m,
      );

      queue.release("first");
      await Promise.all([first, dual, launch, timing].map(succeeded));
      const order = queue.order();
      assert.deepEqual(order.slice(0, 2), ["first", "dual"]);
      assert.deepEqual(order.slice(2).sort(), ["launch", "timing"]);
      assert.deepEqual(queue.tickets(), []);
    }),
);

test(
  "mixed queued and outside contention keeps exclusion and ticket order without deadlock",
  darwinOnly,
  () =>
    withQueue(async (queue) => {
      const events = join(queue.directory, "events");
      // Each job logs its interval; appends are atomic, so line order is the
      // real order of starts and ends.
      const logInterval = (label: string) => [
        process.execPath,
        "-e",
        `
          const { appendFileSync } = require("node:fs");
          const ticket = process.env.TINT_GATE_TICKET ?? "";
          const seq = /(\\d{10})\\.ticket$/.exec(ticket)?.[1] ?? "outside";
          const log = (event) =>
            appendFileSync(${JSON.stringify(events)}, [event, Number(seq) || seq, ${JSON.stringify(label)}].join(" ") + "\\n");
          log("start");
          const end = performance.now() + 20 + Math.random() * 60;
          while (performance.now() < end) {}
          log("end");
        `,
      ];
      const resources = [
        "both",
        "launch",
        "timing",
        "both",
        "timing",
        "launch",
        "both",
        "launch",
        "timing",
        "launch",
        "both",
        "timing",
      ];
      const jobs: Job[] = [];
      for (const [index, resource] of resources.entries()) {
        if (index === 3)
          jobs.push(
            queue.spawn("/usr/bin/lockf", [
              "-k",
              queue.launch,
              ...logInterval("launch"),
            ]),
          );
        if (index === 7)
          jobs.push(
            queue.spawn("/usr/bin/lockf", [
              "-k",
              queue.timing,
              ...logInterval("timing"),
            ]),
          );
        jobs.push(
          queue.spawn("sh", [
            withLock,
            resource,
            "job-" + index,
            ...logInterval(resource),
          ]),
        );
        await delay(15);
      }
      await Promise.all(jobs.map(succeeded));

      const uses = (resource: string, lock: string) =>
        resource === "both" || resource === lock;
      const active = { launch: 0, timing: 0 };
      const intervals = new Map<
        number,
        { resource: string; start: number; end: number }
      >();
      const lines = readFileSync(events, "utf8").trim().split("\n");
      for (const [index, line] of lines.entries()) {
        const [event, seq, resource] = line.split(" ") as [
          string,
          string,
          string,
        ];
        for (const lock of ["launch", "timing"] as const) {
          if (!uses(resource, lock)) continue;
          if (event === "start") {
            assert.equal(
              active[lock],
              0,
              `${lock} overlap at line ${index}: ${line}`,
            );
            active[lock]++;
          } else active[lock]--;
        }
        if (seq === "outside") continue;
        const interval = intervals.get(Number(seq)) ?? {
          resource,
          start: -1,
          end: -1,
        };
        interval[event as "start" | "end"] = index;
        intervals.set(Number(seq), interval);
      }
      assert.equal(lines.length, 2 * (resources.length + 2));
      assert.equal(intervals.size, resources.length);
      // A conflicting request never starts before an earlier ticket ends.
      for (const [first, earlier] of intervals)
        for (const [second, later] of intervals)
          if (
            first < second &&
            ["launch", "timing"].some(
              (lock) =>
                uses(earlier.resource, lock) && uses(later.resource, lock),
            )
          )
            assert.ok(
              earlier.end < later.start,
              `#${second} (${later.resource}) started before #${first} (${earlier.resource}) ended`,
            );
      assert.deepEqual(queue.tickets(), []);
    }),
);

test(
  "a killed waiter leaves the queue without blocking later requests",
  darwinOnly,
  () =>
    withQueue(async (queue) => {
      const first = queue.request("timing", "first", hold("first"));
      await waitUntil(() => queue.started("first"), "the timing holder");
      const dual = queue.request("both", "dual", record("dual"));
      await waitUntil(() => existsSync(queue.ticket(2)), "the dual ticket");
      const launch = queue.request("launch", "launch", record("launch"));
      await waitUntil(
        () => childrenNaming(launch.pid, queue.ticket(2)).length === 1,
        "the launch request to wait for the dual ticket",
      );

      assert.equal(await killed(dual), "SIGKILL");
      // The launch request no longer waits for anything it conflicts with.
      await succeeded(launch);
      assert.deepEqual(queue.order(), ["launch"]);
      assert.equal(existsSync(queue.ticket(2)), false);
      assert.match(
        queue.status(),
        /^Queue \(oldest first\):\n {2}#1 timing first /m,
      );

      queue.release("first");
      await succeeded(first);
      assert.deepEqual(queue.tickets(), []);
    }),
);

test(
  "a killed holder releases its locks and its place in the queue",
  darwinOnly,
  () =>
    withQueue(async (queue) => {
      const dual = queue.request("both", "dual", hold("dual"));
      await waitUntil(() => queue.started("dual"), "the dual holder");
      const launch = queue.request("launch", "launch", record("launch"));
      const timing = queue.request("timing", "timing", record("timing"));
      for (const job of [launch, timing])
        await waitUntil(
          () => childrenNaming(job.pid, queue.ticket(1)).length === 1,
          "a single-lock request to wait for the dual ticket",
        );

      assert.equal(await killed(dual), "SIGKILL");
      // The orphaned command keeps running, but the locks die with the queue
      // process that held them.
      await Promise.all([launch, timing].map(succeeded));
      assert.deepEqual(queue.order().sort(), ["launch", "timing"]);
      assert.equal(queue.held(queue.launch), false);
      assert.equal(queue.held(queue.timing), false);
      // The first waiter to see the dead owner's ticket removed it.
      assert.equal(existsSync(queue.ticket(1)), false);
      assert.match(queue.status(), /^Queue: empty$/m);
      queue.release("dual");
      await waitUntil(
        () => queue.order().includes("dual"),
        "the orphan to end",
      );
    }),
);

test(
  "a dual-lock request holds timing while queued behind an outside launch holder, and a kill releases both",
  darwinOnly,
  () =>
    withQueue(async (queue) => {
      const outside = queue.outside(queue.launch, "outside");
      await waitUntil(() => queue.started("outside"), "the outside holder");
      const dual = queue.request("both", "dual", record("dual"));
      await waitUntil(
        () => childrenNaming(dual.pid, queue.launch).length === 1,
        "the dual request to queue for launch",
      );
      assert.equal(queue.held(queue.timing), true);
      const report = queue.status();
      assert.match(report, /^ {2}timing +\S+ +held by #1 \(dual\)$/m);
      assert.match(
        report,
        /^ {2}launch +\S+ +held outside the queue:\n +\d+ /m,
      );
      assert.match(
        report,
        /#1 both +dual +pid \d+ +waiting \S+, first in line for launch\.lock$/m,
      );

      const holder = childrenNaming(dual.pid, queue.launch)[0]!;
      assert.equal(await killed(dual), "SIGKILL");
      await waitUntil(() => !queue.held(queue.timing), "timing to be released");
      queue.release("outside");
      await succeeded(outside);
      // The orphaned holder takes launch from the queue, finds its parent
      // gone and exits.
      await waitUntil(() => {
        try {
          process.kill(holder, 0);
          return false;
        } catch {
          return true;
        }
      }, "the orphaned launch holder to exit");
      assert.equal(queue.held(queue.launch), false);
      assert.deepEqual(queue.order(), ["outside"]);
      // No later request found the dead owner's ticket; status removes it.
      assert.match(queue.status(), /^Note: removed #1, whose owner exited$/m);
      assert.match(queue.status(), /^Queue: empty$/m);
    }),
);

test("a nested request is refused instead of deadlocking", darwinOnly, () =>
  withQueue(async (queue) => {
    const result = await queue.request(
      "launch",
      "outer",
      `sh ${JSON.stringify(withLock)} timing inner true`,
    ).done;
    assert.equal(result.status, 2, result.output);
    assert.match(
      result.output,
      /inner requested a lock inside the job holding \S+0000000001\.ticket/,
    );
    assert.deepEqual(queue.tickets(), []);
  }),
);

test("bad labels fail before a request joins the queue", darwinOnly, () =>
  withQueue(async (queue) => {
    const held = queue.outside(queue.launch, "outside");
    await waitUntil(() => queue.started("outside"), "the outside holder");
    const result = await queue.request("launch", "bad label", "true").done;
    assert.equal(result.status, 1);
    assert.match(result.output, /Invalid gate step: bad label/);
    queue.release("outside");
    await succeeded(held);
  }),
);

test("the dual-lock watchdog starts after acquisition", darwinOnly, () =>
  withQueue(async (queue) => {
    queue.env.TINT_GATE_IDLE_TIMEOUT = "1";
    queue.env.TINT_GATE_STEP_TIMEOUT = "10";
    const outside = queue.outside(queue.launch, "outside");
    await waitUntil(() => queue.started("outside"), "the outside holder");
    const dual = queue.spawn("sh", [
      withLock,
      "both",
      "benchmark",
      process.execPath,
      "-e",
      `
        const end = performance.now() + 2200;
        while (performance.now() < end) {}
        console.log("measured");
      `,
    ]);
    await waitUntil(
      () => childrenNaming(dual.pid, queue.launch).length === 1,
      "the dual request to queue for launch",
    );
    // Queue time without CPU progress exceeds the idle timeout.
    await delay(1500);
    queue.release("outside");
    await succeeded(outside);
    assert.match((await succeeded(dual)).output, /measured/);
  }),
);

test(
  "a dual-lock request waiting for an outside timing holder leaves launch free",
  darwinOnly,
  () =>
    withQueue(async (queue) => {
      const outside = queue.outside(queue.timing, "outside");
      await waitUntil(() => queue.started("outside"), "the outside holder");
      const dual = queue.request("both", "dual", record("dual"));
      await waitUntil(
        () => childrenNaming(dual.pid, queue.timing).length === 1,
        "the dual request to queue for timing",
      );
      assert.equal(queue.held(queue.launch), false);
      queue.release("outside");
      await Promise.all([outside, dual].map(succeeded));
      assert.deepEqual(queue.order(), ["outside", "dual"]);
    }),
);

test(
  "a queued dual-lock request keeps its place amid repeated outside launch contenders",
  darwinOnly,
  () =>
    withQueue(async (queue) => {
      const outside = queue.outside(queue.launch, "outside");
      await waitUntil(() => queue.started("outside"), "the outside holder");
      const dual = queue.request("both", "dual", record("dual"));
      await waitUntil(
        () => childrenNaming(dual.pid, queue.launch).length === 1,
        "the dual request to queue for launch",
      );
      const holder = childrenNaming(dual.pid, queue.launch)[0]!;
      // Raw lockf traffic queues for launch behind the dual request's holder.
      const contenders = queue.spawn("sh", [
        "-eu",
        "-c",
        `
          for i in $(seq 40); do
            /usr/bin/lockf -k "$1" sleep 0.035
            if grep -qx dual order 2>/dev/null; then exit 0; fi
            sleep 0.02
          done
          echo "Outside traffic drained before the dual request ran" >&2
          exit 1
        `,
        "contenders",
        queue.launch,
      ]);
      await waitUntil(
        () => childrenNaming(contenders.pid, queue.launch).length === 1,
        "an outside contender to queue for launch",
      );
      // The holder keeps its position through a long hold.
      await delay(2500);
      process.kill(holder, 0);
      queue.release("outside");
      await Promise.all([outside, dual, contenders].map(succeeded));
    }),
);

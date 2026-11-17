// The DevTools bridge's Profiler domain: CPU profiles with source frames
// from pprofessor (re-symbolised from DWARF, inlined frames included) and
// from backend stack sampling, on a clang -g C program and a Tint debug
// build, as .cpuprofile objects DevTools loads.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { findLldbDap } from "./devtools/backend.ts";
import { startDevTools } from "./devtools/cli.ts";
import { CpuProfiler, findPprofessor } from "./devtools/profiler.ts";
import { TintPlugin } from "./devtools/tint-plugin.ts";
import { CdpTestClient } from "./devtools/test-client.ts";
import type { CpuProfile } from "./profiling/devtools-profiles.ts";
import { tintSession } from "./devtools-fixture.ts";

// The inlined callee does most of the work: a wall-clock sampler on a busy
// host sees a descheduled thread at its preemption point, so a profile
// holds far fewer independent observations than samples, and a rarely
// sampled inlined frame could be missed.
const source = `static inline __attribute__((always_inline)) void weight(volatile long *t, int v) {
  for (int k = 0; k < 8; k++) *t += v * 2 + k;
}
int spin(int n) {
  volatile long total = 0;
  for (long i = 0; i < n * 100000L; i++) weight(&total, (int)i);
  return (int)total;
}
int main(void) {
  int sum = 0;
  for (int r = 0; r < 20000; r++) sum += spin(10);
  return sum == 0;
}
`;
const clang = spawnSync("xcrun", ["-f", "clang"], { encoding: "utf8" });
const debuggable =
  process.platform === "darwin" &&
  clang.status === 0 &&
  findLldbDap() !== undefined;
const pprofessor = findPprofessor() !== undefined;

/** Structural checks DevTools' CPU profile model relies on; returns the
 * hit count under nodes named `name` (inclusive). */
function checkProfile(
  profile: CpuProfile,
  name: string,
): {
  total: number;
  under: number;
} {
  const ids = new Map(profile.nodes.map((node) => [node.id, node]));
  assert.equal(ids.size, profile.nodes.length);
  assert.equal(profile.nodes[0]?.callFrame.functionName, "(root)");
  for (const node of profile.nodes)
    for (const child of node.children ?? []) assert.ok(ids.has(child));
  assert.equal(profile.samples.length, profile.timeDeltas.length);
  for (const sample of profile.samples) assert.ok(ids.has(sample));
  const hits = profile.nodes.reduce((sum, node) => sum + node.hitCount, 0);
  assert.equal(hits, profile.samples.length);
  assert.ok(profile.endTime >= profile.startTime);
  let under = 0;
  const walk = (id: number, inside: boolean): void => {
    const node = ids.get(id);
    if (node === undefined) return;
    const here = inside || node.callFrame.functionName === name;
    if (here) under += node.hitCount;
    for (const child of node.children ?? []) walk(child, here);
  };
  walk(profile.nodes[0]?.id ?? 1, false);
  return { total: hits, under };
}

async function profileC(
  sampler: "pprofessor" | "backend",
  interval: number,
  duration: number,
): Promise<{
  profile: CpuProfile;
  url: string;
  scriptId: string;
  paused: boolean;
}> {
  const dir = mkdtempSync(join(tmpdir(), "tint-devtools-cpu-"));
  const file = join(dir, "spin.c"),
    program = join(dir, "spin");
  writeFileSync(file, source);
  const built = spawnSync(
    "xcrun",
    ["clang", "-g", "-O0", file, "-o", program],
    {
      encoding: "utf8",
    },
  );
  assert.equal(built.status, 0, built.stderr);
  const session = await startDevTools({
    program,
    port: 0,
    wait: true,
    plugins: [new CpuProfiler(sampler)],
    log: () => {},
  });
  const client = await CdpTestClient.connect(session.server.webSocketUrl);
  try {
    await client.send("Runtime.enable");
    await client.send("Debugger.enable");
    const url = pathToFileURL(file).href;
    const parsed = await client.next(
      "Debugger.scriptParsed",
      (params) => params.url === url,
      10000,
      0,
    );
    await client.send("Profiler.enable");
    await client.send("Profiler.setSamplingInterval", { interval });
    await client.send("Runtime.runIfWaitingForDebugger");
    const mark = client.events.length;
    await client.send("Profiler.start");
    await new Promise((resolve) => setTimeout(resolve, duration));
    const { profile } = await client.send<{ profile: CpuProfile }>(
      "Profiler.stop",
    );
    return {
      profile,
      url,
      scriptId: String(parsed.params.scriptId),
      paused: client.events
        .slice(mark)
        .some((event) => event.method === "Debugger.paused"),
    };
  } finally {
    client.close();
    await session.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test(
  "CPU profiles from pprofessor carry DWARF source frames",
  {
    skip:
      (!debuggable || !pprofessor) && "needs clang, lldb-dap and pprofessor",
    timeout: 180000,
  },
  async () => {
    const { profile, url, scriptId, paused } = await profileC(
      "pprofessor",
      1000,
      1500,
    );
    assert.ok(!paused);
    const { total, under } = checkProfile(profile, "spin");
    assert.ok(total > 50, `${total} samples`);
    assert.ok(under > total * 0.8, `${under} of ${total} under spin`);
    // Profiling starts once the program runs its own code: none of the
    // dyld startup the debugger holds at its image-load stops (which a
    // busy host stretches over the whole window).
    assert.ok(
      !profile.nodes.some((node) =>
        /lldb_image_notifier|^dyld4::prepare/.test(node.callFrame.functionName),
      ),
      "the profile includes debugger-held startup",
    );
    const spin = profile.nodes.find(
      (node) => node.callFrame.functionName === "spin",
    );
    assert.equal(spin?.callFrame.url, url);
    assert.equal(spin?.callFrame.scriptId, scriptId);
    assert.equal(spin?.callFrame.lineNumber, 3, "spin starts on line 4");
    // The inlined callee is its own node under spin, with line ticks.
    const weight = profile.nodes.find(
      (node) => node.callFrame.functionName === "weight",
    );
    assert.ok(
      weight !== undefined && (spin?.children ?? []).includes(weight.id),
      "weight is an inlined child of spin: " +
        JSON.stringify(
          profile.nodes.map((node) => [
            node.callFrame.functionName,
            node.hitCount,
            node.children,
          ]),
        ),
    );
    assert.ok((weight.positionTicks ?? []).some((tick) => tick.line === 2));
  },
);

test(
  "CPU profiles from backend stack sampling",
  { skip: !debuggable && "needs clang and lldb-dap", timeout: 180000 },
  async () => {
    const { profile, url, paused } = await profileC("backend", 20000, 2000);
    assert.ok(!paused, "sampling stops are internal");
    const { total, under } = checkProfile(profile, "spin");
    assert.ok(total >= 5, `${total} samples`);
    assert.ok(under > total * 0.6, `${under} of ${total} under spin`);
    assert.equal(
      profile.nodes.find((node) => node.callFrame.functionName === "spin")
        ?.callFrame.url,
      url,
    );
  },
);

test(
  "CPU profiles of a Tint debug build name source functions",
  {
    skip: (!debuggable || !pprofessor) && "needs lldb-dap and pprofessor",
    timeout: 300000,
  },
  async () => {
    const { client, url, close } = await tintSession("devtools-cpu", [
      new TintPlugin(),
      new CpuProfiler("pprofessor"),
    ]);
    try {
      await client.send("Profiler.enable");
      await client.send("Runtime.runIfWaitingForDebugger");
      await client.send("Profiler.start");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const { profile } = await client.send<{ profile: CpuProfile }>(
        "Profiler.stop",
      );
      const { total, under } = checkProfile(profile, "churn");
      assert.ok(total > 50, `${total} samples`);
      assert.ok(under > total * 0.5, `${under} of ${total} under churn`);
      const make = profile.nodes.find(
        (node) => node.callFrame.functionName === "makeChain",
      );
      assert.equal(make?.callFrame.url, url);
      assert.notEqual(make?.callFrame.scriptId, "0");
    } finally {
      await close();
    }
  },
);

import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const source = String.raw`
import process, { arch, cwd, nextTick, pid, platform } from "node:process";
import timers, { setTimeout as after, clearTimeout as cancel, setImmediate, clearImmediate } from "node:timers";
import promises, { setTimeout as delay, setImmediate as immediate, setInterval as interval } from "node:timers/promises";
import nodeConsole, { Console, log } from "node:console";

export async function run(tint: boolean = true): Promise<number> {
  if (typeof pid !== "number" || pid <= 0 || platform !== process.platform ||
      arch !== process.arch || cwd().length === 0 || process.uptime() < 0) return 1;
  if (nodeConsole !== console || log !== console.log || Console !== nodeConsole.Console ||
      after !== timers.setTimeout || after !== globalThis.setTimeout) return 2;
  if (tint && ("process" in globalThis || "setImmediate" in globalThis ||
      "clearImmediate" in globalThis)) return 3;
  const lines: string[] = [];
  const logger = new Console({ stdout: { write(line: string) { lines.push(line); return true; },
    on() {}, removeListener() {}, listenerCount() { return 0; }, once() {} } });
  logger.log("%s:%d", "item", 7);
  logger.group("heading");
  logger.dir({ a: true });
  logger.groupEnd();
  if (lines.join("") !== "item:7\nheading\n  { a: true }\n") return 4;
  const trace: string[] = [];
  const cancelled = setImmediate(() => trace.push("cancelled"));
  clearImmediate(cancelled);
  if (cancelled.hasRef()) return 5;
  const handle = after(() => trace.push("bad timeout"), 5000);
  if (handle.unref() !== handle || handle.hasRef() || !handle.ref().hasRef() ||
      handle.refresh() !== handle) return 6;
  cancel(+handle);
  await new Promise(resolve => {
    nextTick((value: string) => trace.push(value), "tick");
    setImmediate(() => { trace.push("immediate"); resolve(undefined); });
  });
  if (trace.join(",") !== "tick,immediate") return 7;
  const controller = new AbortController();
  const waiting = delay(5000, 0, { signal: controller.signal });
  controller.abort("why");
  try { await waiting; return 8; } catch (err) {
    if (err.name !== "AbortError" || err.code !== "ABORT_ERR" || err.cause !== "why") return 9;
  }
  const signal = new AbortController();
  const ticks = interval(1, "tick", { signal: signal.signal });
  if ((await ticks.next()).value !== "tick") return 10;
  await ticks.return();
  if (!(await ticks.next()).done || await immediate(17) !== 17 || await promises.scheduler.yield() !== undefined) return 11;
  if (await delay(1, 42) !== 42) return 12;
  if ((await import("node:console")).default !== console ||
      (await import("node:timers")).setImmediate !== setImmediate ||
      (await import("node:process")).default !== process) return 13;
  let fired = 0;
  const refreshed = await new Promise(resolve => {
    const timer = after(() => { fired++; resolve(timer); }, 1);
  });
  refreshed.refresh();
  await delay(10);
  if (fired !== 2 || !refreshed.hasRef()) return 14;
  const abortInterval = new AbortController();
  const pendingTicks = interval(5000, "unexpected", { signal: abortInterval.signal });
  const pendingTick = pendingTicks.next();
  abortInterval.abort("stop interval");
  try { await pendingTick; return 15; } catch (err) {
    if (err.code !== "ABORT_ERR" || err.cause !== "stop interval") return 16;
  }
  if (!(await pendingTicks.next()).done) return 17;
  try { await immediate(undefined, { signal: AbortSignal.abort(19) }); return 18; }
  catch (err) { if (err.code !== "ABORT_ERR" || err.cause !== 19) return 19; }
  if (tint) after(() => { throw new Error("unref kept the loop alive"); }, 5000).unref();
  return 42;
}
`;

test("process, timers and console fixture matches Node", async () => {
  const module = (await import(
    "data:text/javascript," + encodeURIComponent(stripTypeScriptTypes(source))
  )) as { run(tint: boolean): Promise<number> };
  assert.equal(await module.run(false), 42);
});

test("process, timers and console share the native realm and event loop", () => {
  const compiled: { general?: readonly string[] } = {};
  verifyHostedFixture(
    source,
    "m1p6-process-timers-console",
    [
      ["node:process", "packages/native-runtime/src/node/process.ts"],
      ["node:timers", "packages/native-runtime/src/node/timers.ts"],
      [
        "node:timers/promises",
        "packages/native-runtime/src/node/timers-promises.ts",
      ],
      ["node:console", "packages/native-runtime/src/node/console.ts"],
    ],
    [],
    [],
    [],
    {
      nodeEventLoop: true,
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      onGeneralFallback(modules) {
        compiled.general = modules;
      },
    },
  );
  assert.ok(
    compiled.general?.includes(
      "packages/native-runtime/src/node/timers-promises.ts",
    ),
  );
  assert.equal(
    compiled.general?.includes(
      "packages/native-runtime/src/node/process-host.ts",
    ),
    false,
  );
});

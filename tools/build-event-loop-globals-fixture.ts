import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The Node globals fixture must run under LLDB");

verifyHostedFixture(
  `
const trace = [];
process.nextTick(() => trace.push("esm tick"));
Promise.resolve().then(() => trace.push("esm promise"));
queueMicrotask(() => trace.push("esm microtask"));

export function run() {
  const blocked = setTimeout(() => { throw new Error("cancelled timer"); }, 100);
  clearInterval(blocked);
  const unref = setTimeout(() => { throw new Error("unref timer"); }, 100);
  if (unref.unref() !== unref || unref.hasRef())
    throw new Error("timeout ref state");
  setImmediate((n) => {
    if (n !== 42) throw new Error("immediate argument");
    trace.push("immediate");
    process.nextTick(() => trace.push("tick"));
    queueMicrotask(() => trace.push("microtask"));
    setTimeout(() => {
      if (trace.join(",") !== "esm promise,esm microtask,esm tick,immediate,tick,microtask")
        throw new Error(trace.join(","));
    }, { valueOf: () => 1 });
  }, 42);
  return 42;
}
`,
  "event-loop-globals-v2",
  [],
  [],
  [],
  [],
  {
    managedBytes: 4194304,
    allocationCapacity: 65536,
    // x86-64 module initialization needs more than the small fixture stack.
    stackBytes: 16777216,
    nodeEventLoop: true,
    ...(nativeFixtureTarget().arch === "x86_64"
      ? { runtimeEntry: "initializeGenerationalRuntime" }
      : {}),
  },
);

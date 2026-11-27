import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The Node globals fixture must run under LLDB");

verifyHostedFixture(
  `
const trace = [];
if ("process" in globalThis || "setImmediate" in globalThis || "clearImmediate" in globalThis)
  throw new Error("unexpected Node global");
Promise.resolve().then(() => trace.push("esm promise"));
queueMicrotask(() => trace.push("esm microtask"));

export function run() {
  const blocked = setTimeout(() => { throw new Error("cancelled timer"); }, 100);
  clearInterval(blocked);
  const unref = setTimeout(() => { throw new Error("unref timer"); }, 100);
  if (unref.unref() !== unref || unref.hasRef())
    throw new Error("timeout ref state");
  setTimeout((n) => {
    if (n !== 42) throw new Error("timer argument");
    trace.push("timer");
    queueMicrotask(() => trace.push("microtask"));
    setTimeout(() => {
      if (trace.join(",") !== "esm promise,esm microtask,timer,microtask")
        throw new Error(trace.join(","));
    }, { valueOf: () => 1 });
  }, 0, 42);
  return 42;
}
`,
  "event-loop-globals-v2",
  [],
  [],
  [],
  [],
  {
    // The globalThis check enables the full intrinsic set.
    managedBytes: 33554432,
    allocationCapacity: 524288,
    // x86-64 module initialization needs more than the small fixture stack.
    stackBytes: 16777216,
    nodeEventLoop: true,
    ...(nativeFixtureTarget().arch === "x86_64"
      ? { runtimeEntry: "initializeGenerationalRuntime" }
      : {}),
  },
);

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cgroupProcessorLimitFrom,
  cpuMaxProcessors,
  unifiedCgroupPath,
} from "../src/processors.ts";
import { collectorWorkerCount } from "../src/generational.ts";

const encoder = new TextEncoder(),
  decoder = new TextDecoder();
function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}
function cpuMax(text: string): number {
  const encoded = bytes(text);
  return cpuMaxProcessors(encoded, encoded.length);
}
/** A file system of path -> contents; reads record each requested path. */
function files(contents: Record<string, string>): {
  readonly read: (path: Uint8Array, buffer: Uint8Array) => number;
  readonly requested: string[];
} {
  const requested: string[] = [];
  return {
    requested,
    read: (path, buffer) => {
      const terminator = path.indexOf(0);
      assert.ok(terminator >= 0, "paths are NUL-terminated");
      const name = decoder.decode(path.subarray(0, terminator));
      requested.push(name);
      const text = contents[name];
      if (text === undefined) return -2;
      const encoded = bytes(text),
        count = Math.min(encoded.length, buffer.length);
      buffer.set(encoded.subarray(0, count));
      return count;
    },
  };
}

test("cpu.max quotas round up to whole CPUs; max and malformed mean no limit", () => {
  assert.equal(cpuMax("800000 100000\n"), 8);
  assert.equal(cpuMax("150000 100000\n"), 2);
  assert.equal(cpuMax("100000 100000"), 1);
  assert.equal(cpuMax("1000 100000\n"), 1);
  assert.equal(cpuMax("max 100000\n"), 0);
  for (const malformed of [
    "",
    "\n",
    "800000\n",
    "800000 \n",
    " 100000\n",
    "0 100000\n",
    "800000 0\n",
    "-1 100000\n",
    "8e5 100000\n",
    "99999999999999999999 1\n",
  ])
    assert.equal(cpuMax(malformed), 0, JSON.stringify(malformed));
});

test("the unified hierarchy path is the 0:: line, wherever it appears", () => {
  const unified = bytes("0::/user.slice/session-2.scope\n");
  assert.equal(unifiedCgroupPath(unified, unified.length), 3);
  const hybrid = bytes(
    "12:cpu,cpuacct:/user.slice\n1:name=systemd:/user.slice\n0::/user.slice/x\n",
  );
  const at = unifiedCgroupPath(hybrid, hybrid.length);
  assert.equal(
    decoder.decode(hybrid.subarray(at, hybrid.indexOf(10, at))),
    "/user.slice/x",
  );
  const legacy = bytes("12:cpu,cpuacct:/user.slice\n");
  assert.equal(unifiedCgroupPath(legacy, legacy.length), -1);
  // A truncated read never runs past the reported length.
  assert.equal(unifiedCgroupPath(unified, 2), -1);
});

test("the tightest limit of the cgroup and its ancestors applies", () => {
  const fs = files({
    "/proc/self/cgroup": "0::/a/b\n",
    "/sys/fs/cgroup/a/b/cpu.max": "max 100000\n",
    "/sys/fs/cgroup/a/cpu.max": "300000 100000\n",
    "/sys/fs/cgroup/cpu.max": "500000 100000\n",
  });
  assert.equal(cgroupProcessorLimitFrom(fs.read), 3);
  assert.deepEqual(fs.requested, [
    "/proc/self/cgroup",
    "/sys/fs/cgroup/a/b/cpu.max",
    "/sys/fs/cgroup/a/cpu.max",
    "/sys/fs/cgroup/cpu.max",
  ]);
});

test("a cgroup namespace's top (path /) carries the container limit", () => {
  const fs = files({
    "/proc/self/cgroup": "0::/\n",
    "/sys/fs/cgroup/cpu.max": "800000 100000\n",
  });
  assert.equal(cgroupProcessorLimitFrom(fs.read), 8);
  assert.deepEqual(fs.requested, [
    "/proc/self/cgroup",
    "/sys/fs/cgroup/cpu.max",
  ]);
});

test("no cgroup data (macOS, cgroup v1, unreadable files) means no limit", () => {
  assert.equal(cgroupProcessorLimitFrom(files({}).read), 0);
  assert.equal(
    cgroupProcessorLimitFrom(
      files({ "/proc/self/cgroup": "4:cpu:/docker/abc\n" }).read,
    ),
    0,
  );
  // The real root has no cpu.max; missing files at any level are skipped.
  assert.equal(
    cgroupProcessorLimitFrom(
      files({
        "/proc/self/cgroup": "0::/a/b\n",
        "/sys/fs/cgroup/a/cpu.max": "200000 100000\n",
      }).read,
    ),
    2,
  );
  // A path that does not fit the read buffer is not trusted.
  assert.equal(
    cgroupProcessorLimitFrom(
      files({ "/proc/self/cgroup": "0::/" + "x".repeat(5000) + "\n" }).read,
    ),
    0,
  );
});

test("collector workers follow available CPUs and bandwidth limits, at most six", () => {
  assert.equal(collectorWorkerCount(0, 0), 6);
  assert.equal(collectorWorkerCount(18, 0), 6);
  assert.equal(collectorWorkerCount(9, 8), 6);
  assert.equal(collectorWorkerCount(4, 0), 4);
  assert.equal(collectorWorkerCount(9, 2), 2);
  assert.equal(collectorWorkerCount(2, 4), 2);
  // One CPU: a single worker, which keeps collections serial.
  assert.equal(collectorWorkerCount(1, 0), 1);
  assert.equal(collectorWorkerCount(0, 1), 1);
});

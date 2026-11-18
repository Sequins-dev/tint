import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cgroupFileNumber,
  cgroupProcessorLimitFrom,
  cpuMaxProcessors,
  legacyCpuCgroupPath,
  legacyCpuMount,
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

test("no cgroup data (macOS, unmounted cgroup v1, unreadable files) means no limit", () => {
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

// cgroup v1: a typical systemd host's /proc/self/mountinfo (abridged).
const legacyMounts =
  "22 1 259:1 / / rw,relatime shared:1 - ext4 /dev/root rw\n" +
  "25 22 0:23 / /sys/fs/cgroup ro,nosuid shared:4 - tmpfs tmpfs ro,mode=755\n" +
  "30 25 0:27 / /sys/fs/cgroup/cpuset rw,nosuid shared:9 - cgroup cgroup rw,cpuset\n" +
  "31 25 0:28 / /sys/fs/cgroup/cpu,cpuacct rw,nosuid shared:10 - cgroup cgroup rw,cpu,cpuacct\n" +
  "32 25 0:29 / /sys/fs/cgroup/memory rw,nosuid shared:11 - cgroup cgroup rw,memory\n";
const legacyCgroup =
  "12:memory:/user.slice/job\n4:cpu,cpuacct:/user.slice/job\n3:cpuset:/\n1:name=systemd:/user.slice/job\n";

test("the cgroup v1 cpu controller line and mount are found by controller name", () => {
  const cgroup = bytes(legacyCgroup);
  const at = legacyCpuCgroupPath(cgroup, cgroup.length);
  assert.equal(
    decoder.decode(cgroup.subarray(at, cgroup.indexOf(10, at))),
    "/user.slice/job",
  );
  // cpuacct and cpuset are other controllers; the v2 line has none.
  for (const text of ["4:cpuacct:/a\n3:cpuset:/b\n0::/c\n", "4:cpu\n", ""]) {
    const other = bytes(text);
    assert.equal(legacyCpuCgroupPath(other, other.length), -1, text);
  }
  const mounts = bytes(legacyMounts);
  const line = legacyCpuMount(mounts, mounts.length);
  assert.ok(
    decoder
      .decode(mounts.subarray(line, mounts.indexOf(10, line)))
      .startsWith("31 25"),
  );
  // A cgroup2 mount (type cgroup2) is not the v1 controller, and a line cut
  // off by a truncated read is never used.
  const unified = bytes(
    "29 22 0:26 / /sys/fs/cgroup rw shared:5 - cgroup2 cgroup2 rw,nsdelegate\n",
  );
  assert.equal(legacyCpuMount(unified, unified.length), -1);
  assert.equal(legacyCpuMount(mounts, mounts.indexOf(10, line) - 1), -1);
});

test("cgroup v1 files hold one number; -1 and malformed contents are none", () => {
  const number = (text: string): number => {
    const encoded = bytes(text);
    return cgroupFileNumber(encoded, encoded.length);
  };
  assert.equal(number("150000\n"), 150000);
  assert.equal(number("100000"), 100000);
  for (const malformed of ["-1\n", "", "\n", "1 2\n", "1e5\n"])
    assert.equal(number(malformed), -1, JSON.stringify(malformed));
});

test("cgroup v1 CFS quotas apply like cpu.max, tightest of the cgroup and its ancestors", () => {
  const mount = "/sys/fs/cgroup/cpu,cpuacct";
  const fs = files({
    "/proc/self/cgroup": legacyCgroup,
    "/proc/self/mountinfo": legacyMounts,
    [mount + "/user.slice/job/cpu.cfs_quota_us"]: "250000\n",
    [mount + "/user.slice/job/cpu.cfs_period_us"]: "100000\n",
    [mount + "/user.slice/cpu.cfs_quota_us"]: "-1\n",
    [mount + "/user.slice/cpu.cfs_period_us"]: "100000\n",
    [mount + "/cpu.cfs_quota_us"]: "-1\n",
    [mount + "/cpu.cfs_period_us"]: "100000\n",
  });
  // 2.5 CPUs round up to 3.
  assert.equal(cgroupProcessorLimitFrom(fs.read), 3);
  // Unlimited quotas skip the period read.
  assert.deepEqual(fs.requested, [
    "/proc/self/cgroup",
    "/proc/self/mountinfo",
    mount + "/user.slice/job/cpu.cfs_quota_us",
    mount + "/user.slice/job/cpu.cfs_period_us",
    mount + "/user.slice/cpu.cfs_quota_us",
    mount + "/cpu.cfs_quota_us",
  ]);
  // An ancestor's tighter quota wins; a sub-CPU quota is still one CPU.
  assert.equal(
    cgroupProcessorLimitFrom(
      files({
        "/proc/self/cgroup": legacyCgroup,
        "/proc/self/mountinfo": legacyMounts,
        [mount + "/user.slice/job/cpu.cfs_quota_us"]: "800000\n",
        [mount + "/user.slice/job/cpu.cfs_period_us"]: "100000\n",
        [mount + "/user.slice/cpu.cfs_quota_us"]: "5000\n",
        [mount + "/user.slice/cpu.cfs_period_us"]: "100000\n",
      }).read,
    ),
    1,
  );
});

test("cgroup v1 paths are taken relative to the mounted root", () => {
  // A container without a cgroup namespace: its own cgroup is the mount's
  // root, and the mount point (with an escaped space) holds its quota.
  const container = files({
    "/proc/self/cgroup": "5:cpu:/docker/abc\n",
    "/proc/self/mountinfo":
      "40 30 0:30 /docker/abc /sys/fs/cgroup/cpu\\040x rw - cgroup cgroup rw,cpu\n",
    "/sys/fs/cgroup/cpu x/cpu.cfs_quota_us": "400000\n",
    "/sys/fs/cgroup/cpu x/cpu.cfs_period_us": "100000\n",
  });
  assert.equal(cgroupProcessorLimitFrom(container.read), 4);
  assert.deepEqual(container.requested.slice(2), [
    "/sys/fs/cgroup/cpu x/cpu.cfs_quota_us",
    "/sys/fs/cgroup/cpu x/cpu.cfs_period_us",
  ]);
  // A cgroup outside the mounted root (or sharing only a name prefix) is
  // not visible: no limit, and nothing below the mount is read.
  for (const path of ["/other", "/docker/abcdef", "/"]) {
    const outside = files({
      "/proc/self/cgroup": "5:cpu:" + path + "\n",
      "/proc/self/mountinfo":
        "40 30 0:30 /docker/abc /sys/fs/cgroup/cpu rw - cgroup cgroup rw,cpu\n",
    });
    assert.equal(cgroupProcessorLimitFrom(outside.read), 0, path);
    assert.equal(outside.requested.length, 2, path);
  }
});

test("hybrid hierarchies take the tighter of the v2 and v1 limits", () => {
  const fs = files({
    "/proc/self/cgroup": "4:cpu:/\n0::/x\n",
    "/proc/self/mountinfo":
      "31 25 0:28 / /sys/fs/cgroup/cpu rw - cgroup cgroup rw,cpu\n",
    "/sys/fs/cgroup/x/cpu.max": "600000 100000\n",
    "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "200000\n",
    "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000\n",
  });
  assert.equal(cgroupProcessorLimitFrom(fs.read), 2);
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

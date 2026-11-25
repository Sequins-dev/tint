import { nativeTargetOSLinux } from "@tint/abi/host";
import {
  closeRuntimeFile,
  openRuntimeFile,
  readRuntimeFile,
  runtimeTargetOS,
} from "./intrinsics/memory.ts";
/** CPU bandwidth limits of Linux control groups, which bound how many
 * threads can usefully run at once even when the affinity mask allows more
 * (container CPU limits are usually quotas): cgroup v2 `cpu.max`, and the
 * legacy cgroup v1 cpu controller's `cpu.cfs_quota_us` / `cpu.cfs_period_us`
 * (found through /proc/self/cgroup and /proc/self/mountinfo). Off Linux the
 * files do not exist and no limit applies. */

const asciiSlash = 47,
  asciiColon = 58,
  asciiComma = 44,
  asciiHyphen = 45,
  asciiBackslash = 92,
  asciiNewline = 10,
  asciiSpace = 32,
  asciiZero = 48;
/** Offset of the cgroup v2 path in /proc/self/cgroup contents (the line
 * "0::<path>"), or -1 when the process has none. */
export function unifiedCgroupPath(bytes: Uint8Array, length: number): number {
  let line = 0;
  while (line < length) {
    if (
      line + 3 < length &&
      bytes[line] === asciiZero &&
      bytes[line + 1] === asciiColon &&
      bytes[line + 2] === asciiColon &&
      bytes[line + 3] === asciiSlash
    )
      return line + 3;
    while (line < length && bytes[line] !== asciiNewline) line++;
    line++;
  }
  return -1;
}
/** Whether bytes[start, end) spell `text`. */
function spells(
  bytes: Uint8Array,
  start: number,
  end: number,
  text: string,
): boolean {
  if (end - start !== text.length) return false;
  for (let i = 0; i < text.length; i++)
    if (bytes[start + i] !== text.charCodeAt(i)) return false;
  return true;
}
/** Whether the comma-separated list in bytes[start, end) has the item
 * `item` ("cpu" in "cpu,cpuacct", not in "cpuacct" or "cpuset"). */
function listHas(
  bytes: Uint8Array,
  start: number,
  end: number,
  item: string,
): boolean {
  let at = start;
  while (at < end) {
    let next = at;
    while (next < end && bytes[next] !== asciiComma) next++;
    if (spells(bytes, at, next, item)) return true;
    at = next + 1;
  }
  return false;
}
/** Offset of the cgroup v1 cpu controller's path in /proc/self/cgroup
 * contents (the line "<id>:<controllers>:<path>" whose controllers include
 * cpu), or -1 when the process has none. */
export function legacyCpuCgroupPath(bytes: Uint8Array, length: number): number {
  let line = 0;
  while (line < length) {
    let end = line;
    while (end < length && bytes[end] !== asciiNewline) end++;
    let first = line;
    while (first < end && bytes[first] !== asciiColon) first++;
    let second = first + 1;
    while (second < end && bytes[second] !== asciiColon) second++;
    if (
      second + 1 < end &&
      bytes[second + 1] === asciiSlash &&
      listHas(bytes, first + 1, second, "cpu")
    )
      return second + 1;
    line = end + 1;
  }
  return -1;
}
/** The end of the space-separated field starting at `start`. */
function fieldEnd(bytes: Uint8Array, start: number, end: number): number {
  let at = start;
  while (at < end && bytes[at] !== asciiSpace) at++;
  return at;
}
/** Offset of the line in /proc/self/mountinfo contents that mounts the
 * cgroup v1 cpu controller (file system type "cgroup", super options
 * including cpu), or -1. Only whole lines count: a truncated read never
 * yields a partial mount. */
export function legacyCpuMount(bytes: Uint8Array, length: number): number {
  let line = 0;
  while (line < length) {
    let end = line;
    while (end < length && bytes[end] !== asciiNewline) end++;
    if (end >= length) return -1;
    // ID, parent, major:minor, root, mount point, options, then optional
    // fields up to a lone "-", then type, source and super options.
    let at = line,
      field = 0,
      separator = -1;
    while (at < end && separator < 0) {
      const stop = fieldEnd(bytes, at, end);
      if (field >= 6 && stop === at + 1 && bytes[at] === asciiHyphen)
        separator = stop + 1;
      at = stop + 1;
      field++;
    }
    if (separator >= 0 && separator < end) {
      const typeEnd = fieldEnd(bytes, separator, end),
        sourceEnd = fieldEnd(bytes, typeEnd + 1, end),
        optionsEnd = fieldEnd(bytes, sourceEnd + 1, end);
      if (
        spells(bytes, separator, typeEnd, "cgroup") &&
        sourceEnd < end &&
        listHas(bytes, sourceEnd + 1, optionsEnd, "cpu")
      )
        return line;
    }
    line = end + 1;
  }
  return -1;
}
/** Copies a mountinfo path field (octal escapes such as \040 decoded)
 * from bytes[start, end) into target at `at`; returns the end offset in
 * target, or -1 when it does not fit. */
function copyMountPath(
  bytes: Uint8Array,
  start: number,
  end: number,
  target: Uint8Array,
  at: number,
): number {
  let out = at;
  for (let i = start; i < end; i++) {
    if (out >= target.length) return -1;
    const byte = bytes[i] ?? 0;
    if (byte === asciiBackslash && i + 3 < end) {
      target[out++] =
        ((bytes[i + 1] ?? 0) - asciiZero) * 64 +
        ((bytes[i + 2] ?? 0) - asciiZero) * 8 +
        ((bytes[i + 3] ?? 0) - asciiZero);
      i += 3;
    } else target[out++] = byte;
  }
  return out;
}
/** Whole decimal digits of `bytes` in [start, end), or -1 when the range is
 * empty or holds anything else (or exceeds 2^53). */
function decimal(bytes: Uint8Array, start: number, end: number): number {
  if (start >= end) return -1;
  let value = 0;
  for (let at = start; at < end; at++) {
    const digit = (bytes[at] ?? 0) - asciiZero;
    if (digit < 0 || digit > 9) return -1;
    value = value * 10 + digit;
    if (value > 9007199254740991) return -1;
  }
  return value;
}
/** The CPUs a cpu.max file allows ("<quota> <period>": quota / period
 * rounded up, at least 1), or 0 for "max" (no limit) and anything
 * malformed. */
export function cpuMaxProcessors(bytes: Uint8Array, length: number): number {
  let space = 0;
  while (space < length && bytes[space] !== asciiSpace) space++;
  let end = space + 1;
  while (end < length && bytes[end] !== asciiNewline) end++;
  return bandwidthProcessors(
    decimal(bytes, 0, space),
    decimal(bytes, space + 1, end),
  );
}
/** CPUs a bandwidth of `quota` per `period` allows: rounded up, at least 1;
 * 0 (no limit) unless both are positive. */
function bandwidthProcessors(quota: number, period: number): number {
  if (quota <= 0 || period <= 0) return 0;
  return Math.max(1, Math.ceil(quota / period));
}
/** The decimal number a cgroup v1 file such as cpu.cfs_quota_us holds (one
 * line), or -1 for anything else ("-1", the unlimited quota, included). */
export function cgroupFileNumber(bytes: Uint8Array, length: number): number {
  let end = length;
  if (end > 0 && bytes[end - 1] === asciiNewline) end--;
  return decimal(bytes, 0, end);
}
/** Reads the start of a file named by NUL-terminated bytes until the buffer
 * is full or the file ends (proc files return at most a page per read);
 * returns the byte count, or -1 when it cannot be opened or read. */
function readStart(path: Uint8Array, buffer: Uint8Array): number {
  const fd = openRuntimeFile(path);
  if (fd < 0) return -1;
  const chunk = new Uint8Array(4096);
  let total = 0;
  while (total < buffer.length) {
    const count = readRuntimeFile(fd, chunk);
    if (count < 0) {
      total = -1;
      break;
    }
    if (count === 0) break;
    for (let i = 0; i < count && total < buffer.length; i++)
      buffer[total++] = chunk[i] ?? 0;
  }
  closeRuntimeFile(fd);
  return total;
}
function appendText(target: Uint8Array, at: number, text: string): number {
  for (let i = 0; i < text.length; i++) target[at + i] = text.charCodeAt(i);
  return at + text.length;
}
/** The tightest CPU bandwidth limit on this process's cgroups (v2, and the
 * v1 cpu controller's) and their ancestors (CPUs, rounded up), or 0 when
 * none applies or none is visible. */
export function cgroupProcessorLimit(): number {
  if (runtimeTargetOS() !== nativeTargetOSLinux) return 0;
  return cgroupProcessorLimitFrom(readStart);
}
/** cgroupProcessorLimit over `readFile(path, buffer)`, which fills buffer
 * from the start of the file named by NUL-terminated bytes and returns the
 * byte count, or -1. */
export function cgroupProcessorLimitFrom(
  readFile: (path: Uint8Array, buffer: Uint8Array) => number,
): number {
  const buffer = new Uint8Array(4096),
    self = new Uint8Array(18);
  appendText(self, 0, "/proc/self/cgroup");
  const length = readFile(self, buffer);
  if (length <= 0 || length >= buffer.length) return 0;
  const unified = unifiedLimit(readFile, buffer, length),
    legacy = legacyLimit(readFile, buffer, length);
  return unified > 0 && (legacy === 0 || unified < legacy) ? unified : legacy;
}
/** The tightest cgroup v2 cpu.max limit given /proc/self/cgroup contents. */
function unifiedLimit(
  readFile: (path: Uint8Array, buffer: Uint8Array) => number,
  buffer: Uint8Array,
  length: number,
): number {
  const start = unifiedCgroupPath(buffer, length);
  if (start < 0) return 0;
  let end = start;
  while (end < length && buffer[end] !== asciiNewline) end++;
  const root = "/sys/fs/cgroup",
    leaf = "/cpu.max",
    path = new Uint8Array(root.length + (end - start) + leaf.length + 1),
    contents = new Uint8Array(64);
  appendText(path, 0, root);
  for (let at = start; at < end; at++)
    path[root.length + at - start] = buffer[at] ?? 0;
  // Each ancestor from the process's own cgroup up to the hierarchy's top
  // (inside a cgroup namespace the top is the container's cgroup; the real
  // root has no cpu.max).
  let limit = 0,
    directory = root.length + (end - start);
  while (true) {
    if (directory > root.length && path[directory - 1] === asciiSlash)
      directory--;
    const terminator = appendText(path, directory, leaf);
    path[terminator] = 0;
    const count = readFile(path, contents);
    if (count > 0 && count < contents.length) {
      const processors = cpuMaxProcessors(contents, count);
      if (processors > 0 && (limit === 0 || processors < limit))
        limit = processors;
    }
    if (directory <= root.length) break;
    while (directory > root.length && path[directory - 1] !== asciiSlash)
      directory--;
  }
  return limit;
}
/** The tightest cgroup v1 CFS quota given /proc/self/cgroup contents: the
 * cpu controller's cgroup path is found relative to the root of its mount
 * in /proc/self/mountinfo, and the cgroup and each ancestor up to the mount
 * point (cpu.cfs_quota_us / cpu.cfs_period_us) are read. A path outside
 * the mounted root is not visible and imposes no limit. */
function legacyLimit(
  readFile: (path: Uint8Array, buffer: Uint8Array) => number,
  cgroup: Uint8Array,
  length: number,
): number {
  const start = legacyCpuCgroupPath(cgroup, length);
  if (start < 0) return 0;
  let end = start;
  while (end < length && cgroup[end] !== asciiNewline) end++;
  const mountinfo = new Uint8Array(65536),
    self = new Uint8Array(21);
  appendText(self, 0, "/proc/self/mountinfo");
  const count = readFile(self, mountinfo);
  if (count <= 0) return 0;
  // A truncated read still holds whole lines before the cut.
  const line = legacyCpuMount(mountinfo, Math.min(count, mountinfo.length));
  if (line < 0) return 0;
  let lineEnd = line;
  while (lineEnd < count && mountinfo[lineEnd] !== asciiNewline) lineEnd++;
  let rootStart = line;
  for (let field = 0; field < 3; field++)
    rootStart = fieldEnd(mountinfo, rootStart, lineEnd) + 1;
  const rootEnd = fieldEnd(mountinfo, rootStart, lineEnd),
    mountEnd = fieldEnd(mountinfo, rootEnd + 1, lineEnd);
  // The mounted root, decoded; "/" contributes no prefix.
  const root = new Uint8Array(rootEnd - rootStart);
  let rootLength = copyMountPath(mountinfo, rootStart, rootEnd, root, 0);
  if (rootLength < 0) return 0;
  if (rootLength === 1 && root[0] === asciiSlash) rootLength = 0;
  if (end - start < rootLength) return 0;
  for (let i = 0; i < rootLength; i++)
    if (cgroup[start + i] !== root[i]) return 0;
  const relative = start + rootLength;
  if (relative < end && cgroup[relative] !== asciiSlash) return 0;
  const quotaLeaf = "/cpu.cfs_quota_us",
    periodLeaf = "/cpu.cfs_period_us",
    path = new Uint8Array(
      mountEnd - (rootEnd + 1) + (end - relative) + periodLeaf.length + 1,
    ),
    contents = new Uint8Array(64);
  const mount = copyMountPath(mountinfo, rootEnd + 1, mountEnd, path, 0);
  if (mount <= 0) return 0;
  for (let at = relative; at < end; at++)
    path[mount + at - relative] = cgroup[at] ?? 0;
  let limit = 0,
    directory = mount + (end - relative);
  while (true) {
    if (directory > mount && path[directory - 1] === asciiSlash) directory--;
    path[appendText(path, directory, quotaLeaf)] = 0;
    let read = readFile(path, contents);
    const quota =
      read > 0 && read < contents.length
        ? cgroupFileNumber(contents, read)
        : -1;
    if (quota > 0) {
      path[appendText(path, directory, periodLeaf)] = 0;
      read = readFile(path, contents);
      const period =
        read > 0 && read < contents.length
          ? cgroupFileNumber(contents, read)
          : -1;
      const processors = bandwidthProcessors(quota, period);
      if (processors > 0 && (limit === 0 || processors < limit))
        limit = processors;
    }
    if (directory <= mount) break;
    while (directory > mount && path[directory - 1] !== asciiSlash) directory--;
  }
  return limit;
}

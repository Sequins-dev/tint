import {
  closeRuntimeFile,
  openRuntimeFile,
  readRuntimeFile,
} from "./intrinsics/memory.ts";
/** CPU bandwidth limits of Linux control groups (cgroup v2), which bound
 * how many threads can usefully run at once even when the affinity mask
 * allows more (container CPU limits are usually quotas). The legacy cgroup
 * v1 hierarchy is not consulted. Off Linux the files do not exist and no
 * limit applies. */

const asciiSlash = 47,
  asciiColon = 58,
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
  const quota = decimal(bytes, 0, space),
    period = decimal(bytes, space + 1, end);
  if (quota <= 0 || period <= 0) return 0;
  return Math.max(1, Math.ceil(quota / period));
}
/** Reads the start of a file named by NUL-terminated bytes; returns the
 * byte count, or -1 when it cannot be opened or read. */
function readStart(path: Uint8Array, buffer: Uint8Array): number {
  const fd = openRuntimeFile(path);
  if (fd < 0) return -1;
  const count = readRuntimeFile(fd, buffer);
  closeRuntimeFile(fd);
  return count;
}
function appendText(target: Uint8Array, at: number, text: string): number {
  for (let i = 0; i < text.length; i++) target[at + i] = text.charCodeAt(i);
  return at + text.length;
}
/** The tightest CPU bandwidth limit on this process's cgroup v2 and its
 * ancestors (CPUs, rounded up), or 0 when none applies or none is visible. */
export function cgroupProcessorLimit(): number {
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

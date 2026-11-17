// Host developer tools with per-OS spellings: LLVM binaries (xcrun on
// macOS, the distribution's llvm packages on Linux) and process measurement
// (BSD `/usr/bin/time -l` on macOS; GNU time plus `perf stat` on Linux).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const llvmPaths = new Map<string, string | undefined>();
/** An LLVM tool (`llvm-objdump`, `llvm-dwarfdump`, `lldb-dap`, ...): the
 * Xcode toolchain's on macOS; on Linux the unversioned name on PATH, else
 * the newest versioned one (Debian installs `llvm-objdump-19`). */
export function findLlvmTool(name: string): string | undefined {
  if (llvmPaths.has(name)) return llvmPaths.get(name);
  let found: string | undefined;
  if (process.platform === "darwin") {
    const result = spawnSync("xcrun", ["--find", name], { encoding: "utf8" });
    const path = result.stdout?.trim();
    if (result.status === 0 && path !== undefined && existsSync(path))
      found = path;
  } else {
    for (const candidate of [name, ...versionedNames(name)]) {
      const result = spawnSync("sh", ["-c", 'command -v "$0"', candidate], {
        encoding: "utf8",
      });
      const path = result.stdout?.trim();
      if (result.status === 0 && path !== undefined && path !== "") {
        found = path;
        break;
      }
    }
  }
  llvmPaths.set(name, found);
  return found;
}
function versionedNames(name: string): string[] {
  const names: string[] = [];
  for (let version = 30; version >= 14; version--)
    names.push(name + "-" + String(version));
  return names;
}
/** findLlvmTool, failing with the tool's name when it is not installed. */
export function llvmTool(name: string): string {
  const path = findLlvmTool(name);
  if (path === undefined)
    throw Error(
      name +
        " was not found (" +
        (process.platform === "darwin"
          ? "install the Xcode command line tools"
          : "install the llvm package") +
        ")",
    );
  return path;
}
/** Compiles C sources with the host's clang: `xcrun clang` on macOS, which
 * supplies the SDK sysroot (the toolchain binary alone finds neither the
 * headers nor libSystem), else the distribution's clang. Throws when no
 * clang is installed. */
export function compileC(args: readonly string[]): {
  readonly status: number | null;
  readonly stderr: string;
} {
  const result =
    process.platform === "darwin"
      ? spawnSync("xcrun", ["clang", ...args], { encoding: "utf8" })
      : spawnSync(llvmTool("clang"), args, { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stderr: result.stderr };
}

/** One measured run of a command. Counters are undefined where the host
 * has none (Linux VMs without a PMU, or perf missing). */
export interface ProcessMeasurement {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly wallSeconds: number;
  readonly maxResidentBytes: number;
  readonly cycles: number | undefined;
  readonly instructions: number | undefined;
  readonly stdout: string;
  /** The program's standard error (on macOS followed by time's report). */
  readonly stderr: string;
}
export interface MeasureOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly maxBuffer?: number;
}

let countersAvailable: boolean | undefined;
/** Whether cycle and instruction counts can be measured: always on macOS
 * (`time -l`); on Linux when `perf stat` reads the hardware events. */
export function hardwareCounters(): boolean {
  if (countersAvailable !== undefined) return countersAvailable;
  if (process.platform === "darwin") countersAvailable = true;
  else {
    const probe = spawnSync(
      "perf",
      ["stat", "-x", ",", "-e", "cycles,instructions", "--", "true"],
      { encoding: "utf8" },
    );
    countersAvailable =
      probe.status === 0 && parsePerfStat(probe.stderr).cycles !== undefined;
  }
  return countersAvailable;
}

/** Counters from `perf stat -x ,` output: value,unit,event,... lines; an
 * unsupported or uncounted event has a `<...>` value. */
export function parsePerfStat(text: string): {
  cycles: number | undefined;
  instructions: number | undefined;
} {
  let cycles: number | undefined, instructions: number | undefined;
  for (const line of text.split("\n")) {
    const fields = line.split(",");
    if (fields.length < 3) continue;
    const value = Number(fields[0]),
      event = (fields[2] ?? "").replace(/:u$/, "");
    if (!Number.isFinite(value) || (fields[0] ?? "") === "") continue;
    if (event === "cycles" || event.endsWith("/cycles/")) cycles = value;
    if (event === "instructions" || event.endsWith("/instructions/"))
      instructions = value;
  }
  return { cycles, instructions };
}
/** Wall seconds and maximum RSS (KiB) from GNU time's `%e %M` format. */
export function parseGnuTime(text: string): {
  wallSeconds: number;
  maxResidentBytes: number;
} {
  const fields = text.trim().split("\n").pop()?.trim().split(/\s+/) ?? [];
  return {
    wallSeconds: Number(fields[0]),
    maxResidentBytes: Number(fields[1]) * 1024,
  };
}
/** Real seconds, maximum RSS (bytes) and counters from BSD `time -l`. */
export function parseBsdTime(text: string): {
  wallSeconds: number;
  maxResidentBytes: number;
  cycles: number | undefined;
  instructions: number | undefined;
} {
  const pick = (pattern: RegExp): number | undefined => {
    const match = pattern.exec(text);
    return match === null ? undefined : Number(match[1]);
  };
  return {
    wallSeconds: pick(/([\d.]+) real/) ?? Number.NaN,
    maxResidentBytes: pick(/(\d+)\s+maximum resident/) ?? Number.NaN,
    cycles: pick(/(\d+)\s+cycles elapsed/),
    instructions: pick(/(\d+)\s+instructions retired/),
  };
}

/** Runs a command to completion, measuring wall time, peak RSS and (where
 * available) cycles and instructions. */
export function measureProcess(
  command: string,
  args: readonly string[],
  options: MeasureOptions = {},
): ProcessMeasurement {
  const spawnOptions = {
    encoding: "utf8" as const,
    env: options.env ?? process.env,
    maxBuffer: options.maxBuffer ?? 1 << 30,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  };
  if (process.platform === "darwin") {
    const run = spawnSync("/usr/bin/time", ["-l", command, ...args], {
      ...spawnOptions,
    });
    if (run.error !== undefined) throw run.error;
    return {
      status: run.status,
      signal: run.signal,
      ...parseBsdTime(run.stderr),
      stdout: run.stdout,
      stderr: run.stderr,
    };
  }
  const directory = mkdtempSync(join(tmpdir(), "tint-measure-"));
  try {
    const timeFile = join(directory, "time"),
      statFile = join(directory, "stat");
    const counted = hardwareCounters();
    const measured = counted
      ? [
          "perf",
          "stat",
          "-x",
          ",",
          "-o",
          statFile,
          "-e",
          "cycles,instructions",
          "--",
          command,
          ...args,
        ]
      : [command, ...args];
    const run = spawnSync(
      "/usr/bin/time",
      ["-o", timeFile, "-f", "%e %M", ...measured],
      spawnOptions,
    );
    if (run.error !== undefined) throw run.error;
    if (!existsSync(timeFile))
      throw Error("GNU time wrote no report (is the time package installed?)");
    const counters = counted
      ? parsePerfStat(readFileSync(statFile, "utf8"))
      : { cycles: undefined, instructions: undefined };
    // GNU time reports a signalled child as "Command terminated by signal"
    // before the format line, and exits with 128 + the signal number.
    return {
      status: run.status,
      signal: run.signal,
      ...parseGnuTime(readFileSync(timeFile, "utf8")),
      ...counters,
      stdout: run.stdout,
      stderr: run.stderr,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** A counter for display: the value, or "unavailable". */
export function formatCounter(
  value: number | undefined,
  scale = 1,
  digits = 0,
): string {
  return value === undefined ? "unavailable" : (value / scale).toFixed(digits);
}

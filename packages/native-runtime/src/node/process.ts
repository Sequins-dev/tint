/** Explicitly imported process state for the current native program.
 *
 * In a standalone Tint native executable, `argv` reflects the OS `argc`/`argv`
 * vector passed to `main(argc, argv)`: `argv[0]` is the executable path and
 * `argv[1..]` are the command-line arguments (matching POSIX `argv`, Tint's
 * self-hosted CLI, and `node -e`, whereas `node script.js arg1` inserts the
 * script path at `argv[1]` so user arguments start at `argv[2]`).
 *
 * `exitCode` starts as `undefined` (exiting `0` when unset); assigning an
 * integer such as `process.exitCode = 42` sets the native process exit status
 * unless overridden by an uncaught error or unsettled top-level promise. */
import {
  processArgumentAt,
  processArgumentCount,
  processArchitecture,
  processId,
  processPlatform,
} from "./process-host.ts";
import { currentDirectory } from "./path-cwd.ts";
import { monotonicMilliseconds } from "../intrinsics/clock.ts";
import { schedulingFunction } from "./scheduling.ts";

export interface NativeProcess {
  argv: string[];
  exitCode: number | undefined;
  readonly argv0: string;
  readonly arch: string;
  readonly platform: string;
  readonly pid: number;
  readonly cwd: () => string;
  readonly uptime: () => number;
  readonly nextTick: unknown;
}

function readProcessArgv(): string[] {
  const count = processArgumentCount();
  const values: string[] = [];
  for (let index = 0; index < count; index++) {
    const value = processArgumentAt(index);
    if (value !== undefined) values.push(value);
  }
  return values;
}

export const argv: string[] = readProcessArgv();
export const argv0: string = argv[0] ?? "";
export const arch: string = processArchitecture();
export const platform: string = processPlatform();
export const pid: number = processId();
export const nextTick: unknown = schedulingFunction("nextTick");
const started = monotonicMilliseconds();
export function cwd(): string {
  return currentDirectory();
}
export function uptime(): number {
  return (monotonicMilliseconds() - started) / 1000;
}
const processObject: NativeProcess = {
  argv,
  exitCode: undefined,
  argv0,
  arch,
  platform,
  pid,
  cwd,
  uptime,
  nextTick,
};
export { processObject as default };

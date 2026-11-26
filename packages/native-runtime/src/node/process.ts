/** Minimal `node:process` exposing `argv` and `exitCode` via explicit ESM
 * import only (`import process, { argv } from "node:process"`). Does not
 * install a global `process` object on `globalThis`.
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
import { processArgumentAt, processArgumentCount } from "./process-host.ts";

export interface NativeProcess {
  argv: string[];
  exitCode: number | undefined;
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
const processObject: NativeProcess = { argv, exitCode: undefined };
export { processObject as default };

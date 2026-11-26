/** Minimal `node:process` exposing `argv` via explicit ESM import only
 * (`import process, { argv } from "node:process"`). Does not install a global
 * `process` object on `globalThis`.
 *
 * In a standalone Tint native executable, `argv` reflects the OS `argc`/`argv`
 * vector passed to `main(argc, argv)`: `argv[0]` is the executable path and
 * `argv[1..]` are the command-line arguments (matching POSIX `argv`, Tint's
 * self-hosted CLI, and `node -e`, whereas `node script.js arg1` inserts the
 * script path at `argv[1]` so user arguments start at `argv[2]`). */
import { processArgumentAt, processArgumentCount } from "./process-host.ts";

export interface NativeProcess {
  argv: string[];
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
const processObject: NativeProcess = { argv };
export { processObject as default };

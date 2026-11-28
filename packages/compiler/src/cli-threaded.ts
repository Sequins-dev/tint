import { runCompilerCli } from "./cli.ts";
import {
  buildParallelMacOSProgram,
  runFragmentWorker,
} from "./parallel-emission.ts";

export function main(): number {
  return mainThreaded(0);
}

export function mainThreaded(workerArgument: number): number {
  if (workerArgument !== 0) return runFragmentWorker(workerArgument);
  return runCompilerCli(buildParallelMacOSProgram);
}

import type { ParallelEvacuator } from "./parallel.ts";

/** The single-worker target policy always selects the existing serial
 * collector. The pool factory is never linked into these runtime images. */
export function createParallelEvacuator(
  managedBase: number,
  managedLength: number,
  workers: number,
  starts: Uint32Array,
  remembered: Float64Array,
  dirty: Uint8Array,
): ParallelEvacuator | undefined {
  return undefined;
}

/** This target pins collection to the mutator regardless of host CPU count. */
export function cgroupProcessorLimit(): number {
  return 1;
}

import { outOfRange } from "./coded-errors.ts";

export function waterMark(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0)
    throw outOfRange("highWaterMark", "a non-negative integer", value);
  return value;
}

/** A state change wakes all current observers on the ordinary Promise queue.
 * Callers recheck their own predicate after waking. */
export class StreamChange {
  #waiters: (() => void)[] = [];
  wait(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#waiters.push(resolve);
    });
  }
  notify(): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const wake of waiters) if (wake !== undefined) wake();
  }
}

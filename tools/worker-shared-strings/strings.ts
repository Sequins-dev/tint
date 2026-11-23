// Shared helpers of the shared string body fixture
// (tools/build-worker-shared-strings-fixture.ts).
import { nativeSharedMemoryHost } from "host";
import {
  isolateSharedStringStats,
  sharedStringHold,
  sharedStringHoldAt,
} from "strings";
import { stringAddress } from "string-address";

const memory = nativeSharedMemoryHost();

/** Units of every test string: above the 32,768-unit sharing threshold. */
export const units = 40000;
/** Fresh strings in each stress burst. */
export const burst = 16;

export function check(condition: boolean, message: string): void {
  if (condition) return;
  console.log("shared strings: failed: " + message);
  throw new TypeError(message);
}
/** A flat test string whose unit i is 'a' + (i + seed) % 26. */
export function text(seed: number): string {
  let alphabet = "";
  for (let index = 0; index < 26; index++)
    alphabet += String.fromCharCode(97 + ((index + seed) % 26));
  return alphabet.repeat(Math.ceil(units / 26)).slice(0, units);
}
/** Whether `value` is text(seed): every 499th unit, and the last. */
export function intact(value: unknown, seed: number): boolean {
  if (typeof value !== "string" || value.length !== units) return false;
  for (let index = 0; index < units; index += 499)
    if (value.charCodeAt(index) !== 97 + ((index + seed) % 26)) return false;
  return value.charCodeAt(units - 1) === 97 + ((units - 1 + seed) % 26);
}
/** The calling isolate's hold on a shared body's string (0 none, 1 queued,
 * 2 young, 3 old), or -1 when `value` is not one. */
export function hold(value: string): number {
  const observed = sharedStringHold(memory, value);
  return observed < 0 ? -1 : observed % 10;
}
/** The address of a string object, to observe its hold after the string is
 * dropped (holdAt). */
export function addressOf(value: string): number {
  return stringAddress(value);
}
export function holdAt(address: number): number {
  const observed = sharedStringHoldAt(memory, address);
  return observed < 0 ? -1 : observed % 10;
}
/** The reference count of the body whose string was at `address`. */
export function referencesAt(address: number): number {
  const observed = sharedStringHoldAt(memory, address);
  return observed < 0 ? -1 : Math.floor(observed / 10);
}
/** The reference count of a shared body's string, or -1. */
export function references(value: string): number {
  const observed = sharedStringHold(memory, value);
  return observed < 0 ? -1 : Math.floor(observed / 10);
}
/** Live bodies in the process's arena (0 before this isolate used it). */
export function liveBodies(): number {
  const stats = isolateSharedStringStats(memory);
  return stats === undefined ? 0 : stats.liveBodies;
}
export function createdBodies(): number {
  const stats = isolateSharedStringStats(memory);
  return stats === undefined ? 0 : stats.created;
}
/** Free granules still resident, and page releases the host refused. */
export function residentGranules(): number {
  const stats = isolateSharedStringStats(memory);
  return stats === undefined ? 0 : stats.residentGranules;
}
export function refusedReleases(): number {
  const stats = isolateSharedStringStats(memory);
  return stats === undefined ? 0 : stats.refusedReleases;
}
export function fallbacks(): number {
  const stats = isolateSharedStringStats(memory);
  return stats === undefined ? 0 : stats.fallbacks;
}
const ring: number[][] = [];
/** Allocates about 32 MiB of short-lived arrays (each kept briefly in a
 * ring, so none is optimized away): several minor collections. */
export function churn(): number {
  let total = 0;
  for (let round = 0; round < 400000; round++) {
    const junk: number[] = [round, round + 1, round + 2, round + 3];
    ring[round % 64] = junk;
    total += ring[(round + 1) % 64]?.[0] ?? 0;
  }
  ring.length = 0;
  return total;
}

// Shared by the typed zlib stress entries. Both isolates run node:zlib round
// trips while churning their generational heaps and exchanging round
// numbers, and keep zlib's output bytes across many collections. The typed
// path cannot carry bytes between isolates yet (see
// docs/results/worker-runtime-soundness-v1.md), so
// tools/worker-transfer-stress.mjs covers transfers.
import { deflateSync, inflateSync } from "node:zlib";

export const rounds = 240;
export const retainedCount = 24;
const churnRecords = 3000;
const churnRetained = 512;
const stride = 61;
const sizes: readonly number[] = [16, 4096, 65536, 262144];

export function sizeAt(index: number): number {
  return sizes[index % sizes.length] ?? 16;
}

export function fill(bytes: Uint8Array, seed: number): void {
  for (let i = 0; i < bytes.length; i += stride) bytes[i] = (seed + i) & 255;
  bytes[bytes.length - 1] = (seed * 7) & 255;
}

export function filled(bytes: Uint8Array, seed: number): boolean {
  for (let i = 0; i < bytes.length - 1; i += stride)
    if (bytes[i] !== ((seed + i) & 255)) return false;
  return bytes[bytes.length - 1] === ((seed * 7) & 255);
}

export interface Churned {
  readonly round: number;
  readonly label: string;
  readonly values: number[];
}

/** Short-lived records plus a rolling set that survives minor collections. */
export function churn(retained: Churned[], round: number): number {
  let total = 0;
  for (let i = 0; i < churnRecords; i++) {
    const record: Churned = {
      round,
      label: "r" + String(round) + ":" + String(i),
      values: [i, i + 1, i + 2, round],
    };
    total += record.values.length + record.label.length;
    if ((i & 127) !== 0) continue;
    if (retained.length < churnRetained) retained.push(record);
    else retained[(round * 31 + i) % churnRetained] = record;
  }
  return total;
}

/** Deflates and inflates a filled pattern; returns the inflated bytes, or an
 * empty array if they differ. */
export function zlibRoundTrip(seed: number): Uint8Array {
  const input = new Uint8Array(sizeAt(seed));
  fill(input, seed);
  const output = inflateSync(deflateSync(input));
  return output.length === input.length && filled(output, seed)
    ? output
    : new Uint8Array(0);
}

/** One round in one isolate: churn the heap, run zlib and keep the output. */
export function stressRound(
  churned: Churned[],
  outputs: Kept[],
  seed: number,
): boolean {
  churn(churned, seed);
  const output = zlibRoundTrip(seed);
  if (output.length === 0) return false;
  keep(outputs, seed % retainedCount, { bytes: output, seed });
  return true;
}

/** Retained bytes and the seed they must still hold. */
export interface Kept {
  readonly bytes: Uint8Array;
  readonly seed: number;
}

export function keep(ring: Kept[], index: number, entry: Kept): void {
  if (index < ring.length) ring[index] = entry;
  else ring.push(entry);
}

export function intact(ring: Kept[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    const entry = ring[i];
    if (entry === undefined || !filled(entry.bytes, entry.seed)) return false;
  }
  return true;
}

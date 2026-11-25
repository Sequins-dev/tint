// The raw-memory image's kernels (docs/results/worker-runtime-baseline-v1.md):
// the shared CPU kernels plus a zlib round trip of many 64-byte inputs, which
// drives node:zlib's external storage and C calls between managed
// allocations. Results are compared through the inflated bytes, because Node
// bundles a different zlib whose deflate output may differ.
import { deflateSync, inflateSync } from "node:zlib";
import { kernelNames, kernelScale, runKernel } from "./kernels.ts";

export function zlibRoundTrips(scale: number): number {
  const input = new Uint8Array(64);
  let checksum = 0;
  for (let round = 0; round < scale; round++) {
    for (let i = 0; i < input.length; i++) input[i] = (round + i * 7) & 255;
    const output = inflateSync(deflateSync(input));
    for (let i = 0; i < output.length; i++)
      checksum = (Math.imul(checksum, 31) + (output[i] ?? 0)) | 0;
  }
  return checksum;
}

export function rawKernelNames(): string[] {
  const names: string[] = [];
  for (let i = 0; i < kernelNames.length; i++) {
    const name = kernelNames[i];
    if (name !== undefined) names.push(name);
  }
  names.push("zlib");
  return names;
}
export function rawKernelScale(name: string): number {
  return name === "zlib" ? 4000 : kernelScale(name);
}
export function runRawKernel(name: string, scale: number): number {
  return name === "zlib" ? zlibRoundTrips(scale) : runKernel(name, scale);
}

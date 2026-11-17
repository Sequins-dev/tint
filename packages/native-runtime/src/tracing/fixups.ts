import { nativeArrayDataOffset } from "@tint/abi/host";
import {
  createNativeRootScan,
  scanNativeObject,
  headerMarker,
  type ReadWord,
} from "./scan.ts";
import {
  relocateNativeArrayData,
  type ForwardReference,
} from "./relocation.ts";
export interface NativeFixupPlanner {
  readonly prepare: (
    starts: Float64Array,
    sizes: Uint32Array,
    marks: Uint8Array,
    count: number,
    rootHead: number,
    maxSteps?: number,
  ) => number | undefined;
}
/** Create outside the managed heap. Scratch must be exclusively owned, disjoint
 * from the inventory and every scanned memory window, and remain live through
 * commit. A successful prepare authorizes only the returned scratch prefix.
 * Failure may alter scratch but never writes to scanned memory. */
export function createNativeFixupPlanner(
  read: ReadWord,
  forward: ForwardReference,
  canWrite: (slot: number) => boolean,
  slots: Float64Array,
  values: Float64Array,
): NativeFixupPlanner | undefined {
  if (
    slots.buffer === values.buffer &&
    slots.byteOffset < values.byteOffset + values.byteLength &&
    values.byteOffset < slots.byteOffset + slots.byteLength
  )
    return undefined;
  let used = 0;
  function append(slot: number, value: number): boolean {
    if (
      !Number.isSafeInteger(slot) ||
      slot <= 0 ||
      slot % 8 !== 0 ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      !canWrite(slot) ||
      used >= slots.length ||
      used >= values.length
    )
      return false;
    slots[used] = slot;
    values[used] = value;
    used++;
    return true;
  }
  function visit(address: number, slot: number): boolean {
    const destination = forward(address);
    if (destination === undefined || destination <= 0 || destination % 8 !== 0)
      return false;
    return append(slot, destination);
  }
  // Fixups are planned during a collection, which must not allocate.
  const scanRoots = createNativeRootScan(read);
  return {
    prepare: (
      starts,
      sizes,
      marks,
      count,
      rootHead,
      maxSteps: number = 1000000,
    ) => {
      used = 0;
      if (
        !Number.isInteger(count) ||
        count < 0 ||
        count > starts.length ||
        count > sizes.length ||
        count > marks.length ||
        !Number.isInteger(maxSteps) ||
        maxSteps < 0 ||
        maxSteps > 0xffffffff ||
        count > maxSteps
      )
        return undefined;
      let end = 0;
      for (let i = 0; i < count; i++) {
        const start = starts[i],
          size = sizes[i],
          mark = marks[i];
        if (
          start === undefined ||
          size === undefined ||
          mark === undefined ||
          !Number.isSafeInteger(start) ||
          start <= 0 ||
          start % 16 !== 0 ||
          size < 16 ||
          size % 16 !== 0 ||
          start < end ||
          !Number.isSafeInteger(start + size) ||
          (mark !== 0 && mark !== 2)
        )
          return undefined;
        end = start + size;
      }
      if (scanRoots(rootHead, visit, maxSteps, maxSteps) !== "complete")
        return undefined;
      for (let i = 0; i < count; i++) {
        if (marks[i] === 0) continue;
        const start = starts[i],
          size = sizes[i];
        if (start === undefined || size === undefined) return undefined;
        if (scanNativeObject(read, start, size, visit, maxSteps) !== "complete")
          return undefined;
        const header = read(start);
        if (header === undefined) return undefined;
        const marker = headerMarker(header);
        if (marker >= 2 && marker <= 5) {
          const data = relocateNativeArrayData(read, start, forward, maxSteps);
          if (
            data === undefined ||
            !append(start + nativeArrayDataOffset, data)
          )
            return undefined;
        }
      }
      return used;
    },
  };
}

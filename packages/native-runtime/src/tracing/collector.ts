import { createGraphMarker, type MarkStatus } from "../graph/index.ts";
import { scanNativeObject, scanNativeRoots, type ReadWord } from "./scan.ts";
export interface NativeCollector {
  readonly mark: (
    allocationCount: number,
    rootHead: number,
    maxSteps?: number,
  ) => MarkStatus;
}
/** Inventory/workspaces and this control object must live outside the managed
 * heap. The allocationCount prefix is sorted by exact allocation start and
 * immutable during mark; unused starts capacity is borrowed for a page index.
 * External references require an explicit lifetime/identity grant. */
export function createNativeCollector(
  read: ReadWord,
  starts: Float64Array,
  sizes: Uint32Array,
  marks: Uint8Array,
  pending: Uint32Array,
  roots: Float64Array,
  isExternal: (address: number) => boolean,
): NativeCollector {
  let count = 0,
    firstStart = 0,
    lastStart = 0,
    pageCount = 0,
    rootCount = 0,
    rootOverflow = false;
  function locate(address: number): number | undefined {
    // Image literals and permanent control objects are outside the inventory.
    // Retain exact-start precedence for any grant overlapping its address span.
    if (count === 0 || address < firstStart || address > lastStart)
      return isExternal(address) ? -1 : undefined;
    let low = 0,
      high = count;
    if (pageCount !== 0) {
      const page = Math.floor((address - firstStart) / 4096),
        begin = starts[count + page],
        end = starts[count + page + 1];
      if (begin === undefined || end === undefined) return undefined;
      low = begin;
      high = end;
    }
    while (low < high) {
      const middle = Math.floor((low + high) / 2),
        start = starts[middle];
      if (start === undefined) return undefined;
      if (start < address) low = middle + 1;
      else high = middle;
    }
    if (low < count && starts[low] === address) return low;
    return isExternal(address) ? -1 : undefined;
  }
  function saveRoot(address: number, slot: number): boolean {
    if (rootCount >= roots.length) {
      rootOverflow = true;
      return false;
    }
    roots[rootCount++] = address;
    return true;
  }
  let visitEdge: (edge: number | undefined) => boolean = (edge) => false;
  function traceEdge(address: number, slot: number): boolean {
    return visitEdge(locate(address));
  }
  const graph = {
    nodeCount: 0,
    rootCount: 0,
    rootAt: (index: number): number | undefined => {
      const address = roots[index];
      return address === undefined ? undefined : locate(address);
    },
    scanEdges: (
      node: number,
      visit: (edge: number | undefined) => boolean,
    ): MarkStatus => {
      const address = starts[node],
        size = sizes[node];
      if (address === undefined || size === undefined) return "read";
      visitEdge = visit;
      const status = scanNativeObject(read, address, size, traceEdge);
      // Visitor failure is owned by the marker (limit, capacity or bad edge).
      return status === "complete" || status === "visitor"
        ? "complete"
        : "read";
    },
  };
  const marker = createGraphMarker(graph, marks, pending);
  return {
    mark: (allocationCount, rootHead, maxSteps: number = 1000000) => {
      marks.fill(0);
      if (
        !Number.isInteger(allocationCount) ||
        allocationCount < 0 ||
        allocationCount > starts.length ||
        allocationCount > sizes.length ||
        !Number.isInteger(maxSteps) ||
        maxSteps < 0 ||
        maxSteps > 0xffffffff
      )
        return "invalid-graph";
      if (allocationCount > marks.length) return "capacity";
      let end = 0;
      for (let index = 0; index < allocationCount; index++) {
        const start = starts[index],
          size = sizes[index];
        if (
          start === undefined ||
          size === undefined ||
          !Number.isSafeInteger(start) ||
          start <= 0 ||
          start % 16 !== 0 ||
          size < 16 ||
          size % 16 !== 0 ||
          start < end ||
          !Number.isSafeInteger(start + size)
        )
          return "invalid-graph";
        end = start + size;
      }
      count = allocationCount;
      firstStart = starts[0] ?? 0;
      lastStart = starts[count - 1] ?? 0;
      pageCount = 0;
      const pages = Math.floor((lastStart - firstStart) / 4096) + 1;
      if (count > 0 && pages + 1 <= starts.length - count) {
        // Borrow only unused inventory capacity, never the allocation prefix.
        // At most 256 aligned allocation starts fit in a 4 KiB address page.
        let allocation = 0;
        for (let page = 0; page <= pages; page++) {
          const boundary = firstStart + page * 4096;
          while (allocation < count) {
            const start = starts[allocation];
            if (start === undefined) return "read";
            if (start >= boundary) break;
            allocation++;
          }
          starts[count + page] = allocation;
        }
        pageCount = pages;
      }
      rootCount = 0;
      rootOverflow = false;
      const status = scanNativeRoots(
        read,
        rootHead,
        saveRoot,
        maxSteps,
        maxSteps,
      );
      if (status !== "complete")
        return rootOverflow
          ? "capacity"
          : status === "limit"
            ? "limit"
            : status === "invalid"
              ? "invalid-graph"
              : "read";
      graph.nodeCount = count;
      graph.rootCount = rootCount;
      return marker.mark(maxSteps);
    },
  };
}

import { bench, suite } from "node:bench";
import { createTypeSystem, type Type } from "@tint/typescript/types";
import { sha256 } from "@tint/foundation/binary/sha256";
import {
  createRegionAllocator,
  snapshotRegionAllocations,
} from "@tint/native-runtime/allocators/region";

/** Call-dominated recursion: each call is a guarded prologue (stack limit
 * check) plus a trivial body, so it bounds the stack guard's per-call cost. */
function fib(n: number): number {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

export function registerBenchmarks(): void {
  suite("runtime", () => {
    bench("dense-object-array-read", { warmup: 3, samples: 10 }, (b) => {
      const values: { value: number }[] = [];
      for (let i = 0; i < 4096; i++) values.push({ value: i });
      let checksum = 0;
      b.start();
      for (let repeat = 0; repeat < 16; repeat++) {
        for (let i = 0; i < values.length; i++) {
          const value = values[i];
          if (value === undefined) throw "benchmark missing object";
          checksum += value.value;
        }
      }
      b.end(65536);
      if (checksum !== 134184960) throw "benchmark object checksum";
    });
    bench("cold-discriminated-relations", { warmup: 3, samples: 10 }, (b) => {
      const left: number[] = [],
        right: number[] = [];
      const graph: Type[] = [
        { kind: "union", members: left },
        { kind: "union", members: right },
      ];
      for (let i = 0; i < 32; i++) {
        const tag = graph.length;
        graph.push({ kind: "literal", value: "variant" + i });
        left.push(graph.length);
        graph.push({
          kind: "object",
          properties: [
            { name: "kind", type: tag, readonly: true },
            { name: "next", type: 0, readonly: true },
          ],
        });
        right.push(graph.length);
        graph.push({
          kind: "object",
          properties: [
            { name: "kind", type: tag, readonly: true },
            { name: "next", type: 1, readonly: true },
          ],
        });
      }
      const leftBox = graph.length;
      graph.push({
        kind: "object",
        properties: [{ name: "value", type: 0, readonly: false }],
      });
      const rightBox = graph.length;
      graph.push({
        kind: "object",
        properties: [{ name: "value", type: 1, readonly: false }],
      });
      let accepted = 0;
      b.start();
      for (let repeat = 0; repeat < 8; repeat++) {
        const system = createTypeSystem(graph);
        if (!system.ok) throw "benchmark type graph";
        if (system.value.assignable(leftBox, rightBox)) accepted++;
      }
      b.end(8);
      if (accepted !== 8) throw "benchmark relation checksum";
    });
    bench("sha256-code-page", { warmup: 3, samples: 10 }, (b) => {
      const input = new Uint8Array(4096);
      for (let i = 0; i < input.length; i++) input[i] = i % 256;
      let checksum = 0;
      b.start();
      for (let i = 0; i < 16; i++) {
        const digest = sha256(input);
        checksum += (digest[0] ?? 0) + (digest[31] ?? 0);
      }
      b.end(16);
      if (checksum !== 5552) throw "benchmark hash checksum";
    });
    for (let variant = 0; variant < 2; variant++) {
      const indexed = variant === 1;
      bench(
        indexed ? "allocator-indexed" : "allocator-first-fit",
        { warmup: 10, samples: 30 },
        (b) => {
          const count = 1024,
            metadata = new Uint32Array(32768 * 3 + 96),
            dead = new Uint32Array(count);
          const allocator = createRegionAllocator(
            16 * 1024 * 1024,
            16,
            metadata,
          );
          if (allocator === undefined) throw "benchmark allocator construction";
          for (let i = 0; i < count; i++) {
            const offset = allocator.allocate(16);
            if (offset === undefined) throw "benchmark setup allocation";
            dead[i] = offset;
            allocator.allocate(16);
          }
          if (!allocator.releaseAll(dead, count)) throw "benchmark release";
          if (
            indexed &&
            !allocator.enableSearchIndex(
              new Uint32Array(2048),
              new Uint32Array(4096),
            )
          )
            throw "benchmark index";
          let expected = 0,
            cursor = count * 32;
          for (let i = 0; i < 512; i++) {
            expected += cursor;
            cursor += 64 + (511 - i) * 16;
          }
          let checksum = 0;
          b.start();
          for (let i = 0; i < 512; i++) {
            const offset = allocator.allocate(64 + (511 - i) * 16);
            if (offset === undefined) throw "benchmark allocation";
            checksum += offset;
          }
          b.end(512);
          if (checksum !== expected) throw "benchmark allocation checksum";
        },
      );
    }
    for (let variant = 0; variant < 2; variant++) {
      const bounded = variant === 1;
      bench(
        bounded ? "snapshot-active-prefix" : "snapshot-full-capacity",
        { warmup: 10, samples: 30 },
        (b) => {
          const metadata = new Uint32Array(100000 * 3 + 96),
            allocator = createRegionAllocator(65536, 16, metadata);
          if (allocator === undefined) throw "benchmark snapshot allocator";
          for (let i = 0; i < 512; i++) allocator.allocate(32);
          const offsets = new Uint32Array(1024),
            sizes = new Uint32Array(1024),
            scratch = new Uint32Array(1024),
            buckets = new Float64Array(256);
          b.start();
          const count = snapshotRegionAllocations(
            metadata,
            65536,
            offsets,
            sizes,
            scratch,
            buckets,
            bounded ? allocator.descriptorCount() : undefined,
          );
          b.end(1);
          if (count !== 512 || offsets[511] !== 511 * 32 || sizes[511] !== 32)
            throw "benchmark snapshot checksum";
        },
      );
    }
    bench("transient-records", { warmup: 10, samples: 30 }, (b) => {
      let sum = 0;
      b.start();
      for (let i = 0; i < 10000; i++) {
        const values = [
          { value: i },
          { value: i + 1 },
          { value: i + 2 },
          { value: i + 3 },
        ];
        for (const value of values) {
          if (value === undefined) throw "benchmark missing record";
          sum += value.value;
        }
      }
      b.end(40000);
      if (sum !== 200040000) throw "benchmark record checksum";
    });
    bench("recursive-calls", { warmup: 3, samples: 15 }, (b) => {
      let sum = 0;
      b.start();
      for (let repeat = 0; repeat < 20; repeat++) sum += fib(22);
      // fib(22) makes 57,313 calls.
      b.end(20 * 57313);
      if (sum !== 20 * 17711) throw "benchmark recursion checksum";
    });
  });
}

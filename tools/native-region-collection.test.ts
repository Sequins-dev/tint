// The region collector (initializeRuntime, the hosted default) under
// allocation churn and forced collections, executed natively under LLDB.
// Its mark runs while the managed allocator refuses requests, so the root
// scan must not allocate: a per-scan closure there trapped (brk #3) at the
// first collection. Records, strings and lists stay reachable from frames
// and callee-saved registers of several callers across many collections in a
// 4 MiB heap (the churn allocates far more than the heap holds, so the
// collections must reclaim), and a forced collection (request size 0) runs a
// full collection and returns +0.
import test from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";

const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const source = `import {collectGarbage} from "memory";
interface Item { readonly id: number; readonly label: string; readonly payload: number[]; }
let sink: number[][] = [];
function churn(rounds: number): void {
  for (let round = 0; round < rounds; round++) {
    const values: number[] = [];
    for (let i = 0; i < 512; i++) values.push(round * i);
    sink.push(values);
    if (sink.length > 8) sink = [];
  }
}
function item(id: number): Item {
  const values: number[] = [];
  for (let i = 0; i < 4; i++) values.push(id * 10 + i);
  return { id, label: "item-" + String(id), payload: values };
}
function intact(t: Item | undefined, id: number): boolean {
  if (t === undefined || t.id !== id || t.payload.length !== 4) return false;
  return t.payload[3] === id * 10 + 3 && t.label === "item-" + String(id);
}
/** Holds references in its own frame across collections in its callees. */
function nested(depth: number, id: number): number {
  const own = item(id);
  const text = "nested-" + String(id);
  let inner = 0;
  if (depth === 0) churn(64);
  else inner = nested(depth - 1, id + 1);
  collectGarbage();
  if (!intact(own, id) || text !== "nested-" + String(id)) return -1;
  return inner < 0 ? inner : inner + 1;
}
export function run(): number {
  const kept: Item[] = [];
  for (let i = 0; i < 64; i++) kept.push(item(i));
  churn(1024);
  for (let i = 0; i < 64; i++) if (!intact(kept[i], i)) return 1;
  collectGarbage();
  for (let i = 0; i < 64; i++) if (!intact(kept[i], i)) return 2;
  // Drop half; the survivors stay intact through further churn and
  // collections, and the space of the dropped half is reused.
  for (let i = 0; i < 64; i += 2) kept[i] = item(1000 + i);
  for (let round = 0; round < 4; round++) {
    churn(512);
    collectGarbage();
  }
  for (let i = 0; i < 64; i++)
    if (!intact(kept[i], i % 2 === 0 ? 1000 + i : i)) return 3;
  if (nested(6, 2000) !== 7) return 4;
  for (let round = 0; round < 3; round++) collectGarbage();
  const after: string[] = [];
  for (let i = 0; i < 1000; i++) after.push("after-" + String(i));
  if (after.join("|").length !== ${Array.from({ length: 1000 }, (_, i) => "after-" + i).join("|").length}) return 5;
  for (let i = 1; i < 64; i += 2) if (!intact(kept[i], i)) return 6;
  return 42;
}
`;
test(
  "the region collector survives churn and forced collections",
  {
    skip:
      nativeFixtureTarget().arch === "x86_64" &&
      "linux-x86_64 does not implement initializeRuntime",
  },
  () => {
    const managedBytes = 4194304;
    verifyHostedFixture(
      source,
      "region-collection",
      [["memory", memory]],
      [],
      [],
      [{ module: memory, namespace: "native-memory" }],
      {
        managedBytes,
        allocationCapacity: managedBytes / 16,
        rootCapacity: 16384,
        stackBytes: 2097152,
        hostBindings: [
          {
            module: memory,
            name: "collectGarbage",
            operation: "collect-garbage",
          },
        ],
        runtimeEntry: "initializeRuntime",
      },
    );
  },
);

// Weak cells under every collector (docs/memory-and-lifetimes.md, "Weak
// cells"): weak references and ephemerons whose targets die young, survive
// minor collections (promoted), die old or stay reachable, and ephemeron
// values stored into promoted cells (the generational barrier), executed
// natively under LLDB with each runtime entry.
import test from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const weak = "packages/native-runtime/src/intrinsics/weak.ts",
  memory = "packages/native-runtime/src/intrinsics/memory.ts";
/** `churn` fills the nursery several times (minor collections under the
 * generational runtime, whole collections elsewhere); `collectGarbage` is a
 * forced full (major) collection. Targets carry an id so a moved target is
 * recognisably the same object. */
const source = `import {createWeakSlot,weakSlotKey,weakSlotValue,setWeakSlotValue,clearWeakSlot} from "weak";
import {collectGarbage} from "memory";
interface Target { readonly id: number; readonly payload: number[]; }
let sink: number[][] = [];
function churn(rounds: number): void {
  for (let round = 0; round < rounds; round++) {
    const values: number[] = [];
    for (let i = 0; i < 512; i++) values.push(round * i);
    sink.push(values);
    if (sink.length > 8) sink = [];
  }
}
function target(id: number): Target {
  const payload: number[] = [];
  for (let i = 0; i < 4; i++) payload.push(id * 10 + i);
  return { id, payload };
}
function intact(t: Target | undefined, id: number): boolean {
  return t !== undefined && t.id === id && t.payload.length === 4 && t.payload[3] === id * 10 + 3;
}
/** A fresh heap string, reachable only where it is stored. */
function text(id: number): string {
  return "value-" + String(id);
}
export function run(): number {
  // Young targets that die young: cleared by the next (minor) collection.
  const young: unknown[] = [];
  const youngPairs: unknown[] = [];
  for (let i = 0; i < 32; i++) {
    young.push(createWeakSlot(target(i), undefined, false));
    youngPairs.push(createWeakSlot(target(100 + i), text(100 + i), true));
  }
  churn(1024);
  for (let i = 0; i < 32; i++) {
    if (weakSlotKey(young[i]) !== undefined) return 1;
    if (weakSlotKey(youngPairs[i]) !== undefined || weakSlotValue(youngPairs[i]) !== undefined) return 2;
  }
  // Reachable targets survive minors (promoted, moved) and majors; an
  // ephemeron's value, reachable only through it, survives with its key.
  const kept: Target[] = [];
  const keptCells: unknown[] = [];
  const keptPairs: unknown[] = [];
  for (let i = 0; i < 32; i++) {
    const t = target(200 + i);
    kept.push(t);
    keptCells.push(createWeakSlot(t, undefined, false));
    keptPairs.push(createWeakSlot(t, text(300 + i), true));
  }
  churn(1024);
  for (let i = 0; i < 32; i++) {
    if (weakSlotKey(keptCells[i]) !== kept[i] || !intact(kept[i], 200 + i)) return 3;
    if (weakSlotKey(keptPairs[i]) !== kept[i] || weakSlotValue(keptPairs[i]) !== text(300 + i)) return 4;
  }
  collectGarbage();
  for (let i = 0; i < 32; i++) {
    if (weakSlotKey(keptCells[i]) !== kept[i] || !intact(kept[i], 200 + i)) return 5;
    if (weakSlotValue(keptPairs[i]) !== text(300 + i)) return 6;
  }
  // Promoted targets that then die are cleared by a major collection; an
  // ephemeron's value goes with its key.
  const survivors: Target[] = [];
  for (let i = 1; i < 32; i += 2) {
    const t = kept[i];
    if (t === undefined) return 7;
    survivors.push(t);
  }
  for (let i = 0; i < 32; i++) kept[i] = target(-1);
  churn(256);
  collectGarbage();
  for (let i = 0; i < 32; i++) {
    const alive = i % 2 === 1,
      key = weakSlotKey(keptCells[i]);
    if (alive !== (key !== undefined)) return 8;
    if (alive && (key !== survivors[(i - 1) / 2] || !intact(survivors[(i - 1) / 2], 200 + i))) return 9;
    if (alive !== (weakSlotValue(keptPairs[i]) === text(300 + i))) return 10;
    if (!alive && weakSlotValue(keptPairs[i]) !== undefined) return 11;
  }
  // A young value stored into a promoted ephemeron (the generational write
  // barrier remembers the cell) survives minors while its key lives, and
  // dies with it.
  const keys: Target[] = [];
  const late: unknown[] = [];
  for (let i = 0; i < 16; i++) {
    const key = target(400 + i);
    keys.push(key);
    late.push(createWeakSlot(key, undefined, true));
  }
  churn(1024);
  for (let i = 0; i < 16; i++) setWeakSlotValue(late[i], text(500 + i));
  churn(1024);
  for (let i = 0; i < 16; i++)
    if (weakSlotValue(late[i]) !== text(500 + i)) return 12;
  collectGarbage();
  for (let i = 0; i < 16; i++)
    if (weakSlotValue(late[i]) !== text(500 + i)) return 13;
  for (let i = 0; i < 16; i++) keys[i] = target(-1);
  collectGarbage();
  for (let i = 0; i < 16; i++)
    if (weakSlotKey(late[i]) !== undefined || weakSlotValue(late[i]) !== undefined) return 14;
  // Ephemeron chains: a value that is another ephemeron's key keeps that
  // one alive (the fixpoint); a cleared cell stays cleared and releases it.
  const root = target(600);
  const first = createWeakSlot(root, text(601), true);
  const second = createWeakSlot(weakSlotValue(first), text(602), true);
  churn(1024);
  collectGarbage();
  if (weakSlotValue(first) !== text(601) || weakSlotValue(second) !== text(602)) return 15;
  if (weakSlotKey(second) !== weakSlotValue(first)) return 16;
  clearWeakSlot(first);
  churn(1024);
  collectGarbage();
  if (weakSlotKey(first) !== undefined || weakSlotKey(second) !== undefined) return 17;
  if (!intact(root, 600)) return 18;
  for (let i = 0; i < survivors.length; i++)
    if (!intact(survivors[i], 201 + 2 * i)) return 19;
  return 42;
}
`;
function verify(
  name: string,
  runtimeEntry: "initializeGenerationalRuntime" | "initializeCopyingRuntime",
  managedBytes: number = 8388608,
  churnScale: number = 1,
): void {
  verifyHostedFixture(
    churnScale === 1
      ? source
      : source.replace(
          "for (let round = 0; round < rounds; round++) {",
          "for (let round = 0; round < rounds * " +
            String(churnScale) +
            "; round++) {",
        ),
    name,
    [
      ["weak", weak],
      ["memory", memory],
    ],
    [],
    [],
    [
      { module: weak, namespace: "weak-storage" },
      { module: memory, namespace: "native-memory" },
    ],
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
      runtimeEntry,
      weakBindings: [
        { module: weak, name: "createWeakSlot", operation: "new" },
        { module: weak, name: "weakSlotKey", operation: "key" },
        { module: weak, name: "weakSlotValue", operation: "value" },
        { module: weak, name: "setWeakSlotValue", operation: "set-value" },
        { module: weak, name: "clearWeakSlot", operation: "clear" },
      ],
    },
  );
}
test("weak cells clear and survive exactly under the generational collector", () => {
  verify("weak-cells-generational", "initializeGenerationalRuntime");
});
test("weak cells take the serial collector paths in a large generational heap", () => {
  // A 64 MiB heap has an 8 MiB nursery and majors above the 4 MiB parallel
  // threshold: without the weak flag, the parallel evacuator and mark would
  // meet weak slots (fatal).
  verify(
    "weak-cells-generational-large",
    "initializeGenerationalRuntime",
    67108864,
    8,
  );
});
test("weak cells clear and survive exactly under the copying collector", () => {
  verify("weak-cells-copying", "initializeCopyingRuntime");
});

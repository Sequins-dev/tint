// Shared native fixture for the heap observability checks
// (docs/native-heap-profiling.md): known object counts and retainers for
// heap snapshots, known allocation sites for allocation profiles, and
// strings, lists, maps, sets and general values for the LLDB formatters.
import { verifyHostedFixture } from "./hosted-fixture.ts";

/** Lines of the fixture referenced by breakpoints (1-based). */
export const inspectLine = 25;
export const fixtureSource = `interface Point { x: number; y: number; label: string }
interface Holder {
  readonly items: Point[];
  readonly names: string[];
  readonly numbers: number[];
  readonly index: Map<string, Point>;
  readonly tags: Set<string>;
  readonly anything: unknown;
}
interface Node { readonly value: number; readonly next: Node | undefined }
function makeChain(length: number): Node | undefined {
  let node: Node | undefined = undefined;
  for (let i = 0; i < length; i++) node = { value: i, next: node };
  return node;
}
function churn(rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const list = makeChain(2000);
    total += list === undefined ? 0 : list.value;
  }
  return total;
}
function inspect(holder: Holder, retained: Node | undefined): number {
  const count = holder.items.length + holder.names.length + holder.numbers.length + holder.index.size + holder.tags.size;
  holder.items.push({ x: count, y: 0, label: "marker" });
  return count + (retained === undefined ? 100 : 0) + holder.items.length - 4;
}
export function run(): number {
  const items: Point[] = [];
  for (let i = 0; i < 3; i++) items.push({ x: i, y: i * 2, label: "p" + String(i) });
  const names: string[] = ["alpha", "beta"];
  const numbers: number[] = [1.5, 2.5, 3.5];
  const index = new Map<string, Point>();
  index.set("first", items[0] ?? { x: 0, y: 0, label: "" });
  index.set("second", items[1] ?? { x: 0, y: 0, label: "" });
  const tags = new Set<string>();
  tags.add("red");
  tags.add("green");
  const anything: unknown = "dynamic";
  const holder: Holder = { items, names, numbers, index, tags, anything };
  const retained = makeChain(5000);
  const churned = churn(300);
  const count = inspect(holder, retained);
  return count === 12 && churned === 300 * 1999 ? 42 : 1;
}
`;
/** Records reachable at the inspect safepoint, by structure name. */
export const retainedNodes = 5000;

export function buildHeapToolsFixture(
  name: string,
  options: { readonly heapIntrospection?: boolean } = {},
): string {
  return verifyHostedFixture(fixtureSource, name, [], [], [], [], {
    managedBytes: 16777216,
    allocationCapacity: 1048576,
    runtimeEntry: "initializeGenerationalRuntime",
    ...(options.heapIntrospection === undefined
      ? {}
      : { heapIntrospection: options.heapIntrospection }),
  });
}

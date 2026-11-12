// Fused iterator pipelines (HIR, ts-native/src/hir/pipelines.ts) compute the
// same results as the per-call lowering: counted filters, filter into map,
// short-circuit sinks over fused stages, holes skipped and present
// `undefined` elements visited, and effects of the first stage in order.
import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `interface Order { readonly region: string; readonly n: number }
export function run(): number {
  const orders: Order[] = [{ region: "north", n: 1 }, { region: "south", n: 2 }, { region: "north", n: 5 }];
  const north = orders.filter((o) => o.region === "north").length;
  const big = orders.filter((o) => o.n > 1).map((o) => o.n * 10);
  const any = orders.filter((o) => o.n > 4).some((o) => o.region === "north");
  const index = orders.map((o) => o.n).findIndex((n) => n === 2);
  const numbers: (number | undefined)[] = [1, undefined, 3];
  numbers[5] = 0;
  const seen = numbers.filter((n) => true).map((n) => (n === undefined ? -1 : n));
  const order: number[] = [];
  const logged = orders.filter((o) => { order.push(o.n); return o.n !== 2; }).map((o) => o.n + 100);
  return north === 2 && big.length === 2 && big[0] === 20 && big[1] === 50 && any &&
    index === 1 && seen.length === 4 &&
    seen[1] === -1 && seen[3] === 0 && order.join(",") === "1,2,5" &&
    logged.join(",") === "101,105" ? 42 : 1;
}`,
  "pipelines",
  [],
  [],
  [],
  [],
  { managedBytes: 67108864, allocationCapacity: 1048576 },
);

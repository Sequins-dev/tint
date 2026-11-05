/** Declaration surface used by the shared benchmark workloads. Node executes its
 * real experimental runner; Tint resolves these imports to its strict subset. */
declare module "node:bench" {
  import type { BenchContext, BenchOptions } from "@tint/bench";
  export function bench(
    name: string,
    options: BenchOptions,
    body: (context: BenchContext) => void,
  ): Promise<unknown>;
  export function suite(name: string, body: () => void): Promise<unknown>;
}

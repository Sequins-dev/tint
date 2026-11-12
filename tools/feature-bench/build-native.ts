// Builds one kernel as a native binary that exits 42 when its checksum
// matches Node's: TINT_BUILD_ONLY=1 node build-native.ts <name> <scale>.
// Prints the binary path (from the hosted fixture builder).
import { readFileSync } from "node:fs";
import { verifyHostedFixture } from "../hosted-fixture.ts";
import * as kernels from "./kernels.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("feature benchmarks are measured outside the builder");
const name = process.argv[2] ?? "none",
  scale = Number(process.argv[3] ?? "0");
const run = (kernels as unknown as Record<string, (n: number) => number>)[name];
if (run === undefined) throw Error("unknown kernel " + name);
const expected = run(scale),
  source = readFileSync(new URL("./kernels.ts", import.meta.url), "utf8");
verifyHostedFixture(
  `${source}
export function run():number { return ${name}(${scale}) === ${expected} ? 42 : 1; }`,
  "feature-" + name,
  [],
  [],
  [],
  [],
  // The compiler's runtime and its allocation-to-heap ratio, scaled down.
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 268435456,
    allocationCapacity: 8388608,
    rootCapacity: 65536,
    stackBytes: 8388608,
  },
);

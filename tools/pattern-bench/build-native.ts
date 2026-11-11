// Builds one pattern as a native binary that exits 42 when its checksum
// matches Node's: TINT_BUILD_ONLY=1 node build-native.ts <name> <iterations>.
// Prints the binary path (from the hosted fixture builder).
import { readFileSync } from "node:fs";
import { verifyHostedFixture } from "../hosted-fixture.ts";
import * as patterns from "./patterns.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("pattern benchmarks are measured outside the builder");
const name = process.argv[2] ?? "none",
  iterations = Number(process.argv[3] ?? "0");
const run = (patterns as unknown as Record<string, (n: number) => number>)[
  name
];
if (run === undefined) throw Error("unknown pattern " + name);
const expected = run(iterations),
  source = readFileSync(new URL("./patterns.ts", import.meta.url), "utf8");
verifyHostedFixture(
  `${source}
export function run():number { return ${name}(${iterations}) === ${expected} ? 42 : 1; }`,
  "pattern-" + name,
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

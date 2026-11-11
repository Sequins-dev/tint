// Runs one pattern under Node: node node-run.ts <name> <iterations>.
import * as patterns from "./patterns.ts";

const name = process.argv[2] ?? "none",
  iterations = Number(process.argv[3] ?? "0");
const run = (patterns as unknown as Record<string, (n: number) => number>)[
  name
];
if (run === undefined) throw Error("unknown pattern " + name);
console.log(run(iterations));

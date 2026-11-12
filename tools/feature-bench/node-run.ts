// Runs one kernel under Node: node node-run.ts <name> <scale>.
import * as kernels from "./kernels.ts";

const name = process.argv[2] ?? "none",
  scale = Number(process.argv[3] ?? "0");
const run = (kernels as unknown as Record<string, (n: number) => number>)[name];
if (run === undefined) throw Error("unknown kernel " + name);
console.log(run(scale));

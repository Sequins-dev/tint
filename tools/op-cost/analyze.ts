// IR operation cost analysis for a tint binary built with operation ranges
// (TINT_OPERATION_RANGES=1 writes <binary>.operations.json):
//   node tools/op-cost/analyze.ts <binary> [--profile <pprof.pb.gz>]
//        [--top N] [--sites N] [--function <substring>] [--listing]
// Every emitted instruction range is attributed to the IR operation that
// produced it, signed by its operands' representations (int/i32/f64/...,
// register @r or memory @m). Costs aggregate per operation and per signature:
// static instructions per site and, with a pprofessor profile, sampled self
// time. Each signature is compared with a lower bound for a register-resident
// AArch64 lowering (lower-bounds.ts); the estimated reducible share of samples
// (samples x (1 - bound / actual)) ranks where codegen is furthest from ideal.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { lowerBound } from "./lower-bounds.ts";

interface Range {
  readonly function: number;
  readonly block: number;
  readonly index: number;
  readonly operation: string;
  readonly operands: string;
  readonly offset: number;
  readonly byteLength: number;
  readonly functionName: string;
  readonly functionOffset: number;
}
const argv = process.argv.slice(2);
function option(name: string): string | undefined {
  const at = argv.indexOf(name);
  return at < 0 ? undefined : argv[at + 1];
}
const binary = argv.find(
  (arg, i) => !arg.startsWith("--") && !argv[i - 1]?.startsWith("--"),
);
if (binary === undefined)
  throw Error("usage: analyze.ts <binary> [--profile file.pb.gz] [--top N]");
const top = Number(option("--top") ?? "30"),
  siteCount = Number(option("--sites") ?? "15"),
  functionFilter = option("--function"),
  profile = option("--profile"),
  listing = argv.includes("--listing");
const ranges: Range[] = JSON.parse(
  readFileSync(binary + ".operations.json", "utf8"),
);

// Align image offsets with linked addresses through any program symbol
// whose bracketed IR name matches a range's function.
const symbols = spawnSync("nm", ["-n", binary], {
  encoding: "utf8",
  maxBuffer: 1 << 30,
}).stdout.split("\n");
const symbolAddress = new Map<string, number>(),
  symbolNames = new Map<string, string>();
for (const line of symbols) {
  const match = /^([0-9a-f]+) \S (program:.*?)(?: \[(.+)\])?$/.exec(line);
  if (match === null) continue;
  const address = parseInt(match[1] ?? "0", 16),
    full = match[2] ?? "",
    name = match[3] ?? full.replace(/^program:/, "");
  symbolAddress.set(name, address);
  symbolNames.set(name, full.replace(/^program:(packages\/)?/, ""));
}
let delta: number | undefined;
for (const range of ranges) {
  const address = symbolAddress.get(range.functionName);
  if (address !== undefined) {
    delta = address - range.functionOffset;
    break;
  }
}
if (delta === undefined) throw Error("no program symbol matches the ranges");
const shift = delta;
const sorted = ranges
  .map((range) => ({ ...range, address: range.offset + shift }))
  .sort((a, b) => a.address - b.address);
function rangeAt(address: number): number {
  let lo = 0,
    hi = sorted.length - 1,
    found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1,
      range = sorted[mid];
    if (range === undefined) break;
    if (range.address <= address) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const range = sorted[found];
  return range !== undefined && address < range.address + range.byteLength
    ? found
    : -1;
}

// Self samples per range from `go tool pprof -raw`: leaf location only.
const samples = new Float64Array(sorted.length);
let totalSamples = 0,
  attributed = 0;
if (profile !== undefined) {
  const raw = spawnSync("go", ["tool", "pprof", "-raw", profile], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  }).stdout;
  const [samplePart = "", rest = ""] = raw.split("Locations");
  const [locationPart = "", mappingPart = ""] = rest.split("Mappings");
  // The binary's image mapping: linked addresses start at 0x100000000.
  let slide = 0;
  for (const match of mappingPart.matchAll(
    /^\d+: (0x[0-9a-f]+)\/(0x[0-9a-f]+)\/0x[0-9a-f]+ (\S+)/gm,
  ))
    if ((match[3] ?? "").endsWith(binary.split("/").pop() ?? "")) {
      slide = parseInt(match[1] ?? "0", 16) - 0x100000000;
      break;
    }
  const locations = new Map<number, number>();
  for (const match of locationPart.matchAll(/^\s*(\d+): (0x[0-9a-f]+)/gm))
    locations.set(Number(match[1]), parseInt(match[2] ?? "0", 16));
  for (const match of samplePart.matchAll(/^\s+(\d+)\s+\d+: ([\d ]+)$/gm)) {
    const count = Number(match[1]),
      leaf = Number((match[2] ?? "").trim().split(/\s+/)[0]);
    totalSamples += count;
    const address = locations.get(leaf);
    if (address === undefined) continue;
    const index = rangeAt(address - slide);
    if (index >= 0) {
      samples[index] = (samples[index] ?? 0) + count;
      attributed += count;
    }
  }
}

interface Group {
  sites: number;
  instructions: number;
  samples: number;
  bound: number;
  bounded: number;
}
function aggregate(key: (range: Range) => string): Map<string, Group> {
  const groups = new Map<string, Group>();
  sorted.forEach((range, index) => {
    if (
      functionFilter !== undefined &&
      !(symbolNames.get(range.functionName) ?? range.functionName).includes(
        functionFilter,
      )
    )
      return;
    const name = key(range),
      group = groups.get(name) ?? {
        sites: 0,
        instructions: 0,
        samples: 0,
        bound: 0,
        bounded: 0,
      };
    const count = range.byteLength / 4,
      bound = lowerBound(range.operation, range.operands);
    group.sites++;
    group.instructions += count;
    group.samples += samples[index] ?? 0;
    if (bound !== undefined) {
      group.bound += Math.min(bound, count);
      group.bounded += count;
    }
    groups.set(name, group);
  });
  return groups;
}
/** Samples (or, statically, instructions) beyond the lower bound. */
function reducible(group: Group): number {
  if (group.bounded === 0) return 0;
  const excess = 1 - group.bound / group.bounded;
  return (profile === undefined ? group.instructions : group.samples) * excess;
}
const weightName = profile === undefined ? "static" : "samples";
const totalWeight =
  profile === undefined
    ? sorted.reduce((sum, range) => sum + range.byteLength / 4, 0)
    : totalSamples;
function percent(value: number): string {
  return ((value / Math.max(1, totalWeight)) * 100).toFixed(2).padStart(6);
}
function table(title: string, groups: Map<string, Group>): void {
  console.log(
    `\n== ${title} (top ${top} by reducible ${weightName}; bound = lower-bound instructions/site)`,
  );
  console.log(
    "reducible%  weight%  sites  ins/site  bound/site  signature".padEnd(0),
  );
  const rows = [...groups.entries()].sort(
    (a, b) => reducible(b[1]) - reducible(a[1]),
  );
  for (const [name, group] of rows.slice(0, top)) {
    const weight = profile === undefined ? group.instructions : group.samples;
    console.log(
      `${percent(reducible(group))}    ${percent(weight)}  ${String(group.sites).padStart(5)}  ${(group.instructions / group.sites).toFixed(1).padStart(8)}  ${group.bounded === 0 ? "       -" : ((group.bound / group.bounded) * (group.instructions / group.sites)).toFixed(1).padStart(10)}  ${name}`,
    );
  }
}

console.log(
  `${sorted.length} operation ranges, ${sorted.reduce((sum, r) => sum + r.byteLength / 4, 0)} instructions` +
    (profile === undefined
      ? ""
      : `; ${totalSamples} samples, ${((attributed / Math.max(1, totalSamples)) * 100).toFixed(1)}% inside program operations`),
);
table(
  "by operation",
  aggregate((range) => range.operation),
);
table(
  "by signature",
  aggregate((range) => range.operation + " " + range.operands),
);

// Hottest individual sites, with their function and optional disassembly.
const order = sorted
  .map((range, index) => ({ range, index }))
  .filter(
    ({ range }) =>
      functionFilter === undefined ||
      (symbolNames.get(range.functionName) ?? range.functionName).includes(
        functionFilter,
      ),
  )
  .sort((a, b) =>
    profile === undefined
      ? b.range.byteLength - a.range.byteLength
      : (samples[b.index] ?? 0) - (samples[a.index] ?? 0),
  );
console.log(`\n== hottest sites (top ${siteCount})`);
for (const { range, index } of order.slice(0, siteCount)) {
  const weight =
    profile === undefined ? range.byteLength / 4 : (samples[index] ?? 0);
  console.log(
    `${percent(weight)}  ${String(range.byteLength / 4).padStart(4)} ins  ${range.operation} ${range.operands}  in ${symbolNames.get(range.functionName) ?? range.functionName} b${range.block}#${range.index}`,
  );
  if (listing) {
    const text = spawnSync(
      "xcrun",
      [
        "llvm-objdump",
        "-d",
        "--no-show-raw-insn",
        "--no-leading-addr",
        "--start-address=0x" + range.address.toString(16),
        "--stop-address=0x" + (range.address + range.byteLength).toString(16),
        binary,
      ],
      { encoding: "utf8" },
    ).stdout;
    for (const line of text.split("\n"))
      if (/^\s+\S/.test(line) && !line.includes("file format"))
        console.log("            " + line.trim().replace(/\s*<.*$/, ""));
  }
}

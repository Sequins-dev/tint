// Side-by-side machine code for one pattern-bench function under tint and V8:
//   node tools/pattern-bench/compare.ts <pattern> [function] [--listing]
// tint: built with debug symbols, disassembled with llvm-objdump, and each
// instruction attributed to a source line through the DWARF line table.
// V8: `node --print-opt-code` for the same pattern (the last optimized code
// object for the function), attributed through its source-position table;
// Node's type stripping keeps character offsets, so both map to lines of
// patterns.ts. Instructions are classified identically on both sides.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const listing = process.argv.includes("--listing");
const pattern = args[0],
  target = args[1] ?? pattern;
if (pattern === undefined)
  throw Error("usage: compare.ts <pattern> [function] [--listing]");
const source = readFileSync(here + "patterns.ts", "utf8");
const lineStarts = [0];
for (let i = 0; i < source.length; i++)
  if (source.charCodeAt(i) === 10) lineStarts.push(i + 1);
function lineOf(offset: number): number {
  let lo = 0,
    hi = lineStarts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Row {
  readonly line: number;
  readonly text: string;
  readonly category: string;
}
/** One shared classification for both engines' AArch64 text. */
function classify(text: string): string {
  const [mnemonic = "", ...rest] = text.trim().split(/\s+/);
  const operands = rest.join(" ");
  const op = mnemonic.toLowerCase();
  if (/^(ldr|ldp|ldur|ldrb|ldrh|ldrsw|ldurb)$/.test(op))
    return /\[(sp|fp|x29)\b/.test(operands) ? "stack-load" : "heap-load";
  if (/^(str|stp|stur|strb|strh|sturb)$/.test(op))
    return /\[(sp|fp|x29)\b/.test(operands) ? "stack-store" : "heap-store";
  if (/^(fcvtzs|fcvtzu|scvtf|ucvtf|fcvt)$/.test(op)) return "convert";
  if (op === "fmov" || op === "mov") {
    const registers = operands.match(
      /\b[dxws]\d+\b|\b(xzr|wzr|sp|fp|lr|cp)\b/g,
    );
    if (
      registers !== null &&
      registers.length === 2 &&
      !operands.includes("#")
    ) {
      const [a = "", b = ""] = registers;
      return a[0] === b[0] || (a[0] !== "d" && b[0] !== "d")
        ? "move"
        : "bank-move";
    }
    return "constant";
  }
  if (/^(movz|movk|movn|adr|adrp)$/.test(op)) return "constant";
  if (/^(bl|blr)$/.test(op)) return "call";
  if (/^(b|br|ret|cbz|cbnz|tbz|tbnz)$/.test(op) || op.startsWith("b."))
    return "branch";
  if (/^(cmp|cmn|tst|fcmp|ccmp|cset|csel|csinc)$/.test(op)) return "compare";
  if (op === "brk" || op === "udf") return "trap";
  if (op === "nop") return "nop";
  if (/^f/.test(op)) return "float-alu";
  return "int-alu";
}
const categories = [
  "int-alu",
  "float-alu",
  "convert",
  "compare",
  "branch",
  "call",
  "constant",
  "move",
  "bank-move",
  "stack-load",
  "stack-store",
  "heap-load",
  "heap-store",
  "trap",
  "nop",
];

function tintRows(): Row[] {
  const built = spawnSync(
    process.execPath,
    [here + "build-native.ts", pattern ?? "", "1"],
    {
      encoding: "utf8",
      env: { ...process.env, TINT_BUILD_ONLY: "1", TINT_DEBUG_SYMBOLS: "1" },
    },
  );
  const binary = built.stdout.split("\n").find((line) => line.startsWith("/"));
  if (built.status !== 0 || binary === undefined)
    throw Error("native build failed:\n" + built.stderr.slice(-2000));
  const symbols = spawnSync("nm", ["-n", binary], { encoding: "utf8" })
    .stdout.split("\n")
    .map((line) => line.split(" "))
    .filter((parts) => parts.length >= 3);
  const index = symbols.findIndex((parts) =>
    parts
      .slice(2)
      .join(" ")
      .startsWith("program:fixture:" + target + " "),
  );
  if (index < 0) throw Error("no native function " + target);
  const start = parseInt(symbols[index]?.[0] ?? "0", 16),
    end = parseInt(symbols[index + 1]?.[0] ?? "0", 16);
  // DWARF rows: address, line, column, file; fixture lines are patterns.ts lines.
  const lines = new Map<number, number>();
  const dwarf = spawnSync("xcrun", ["llvm-dwarfdump", "--debug-line", binary], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  }).stdout;
  let fixtureFile = -1;
  const files = dwarf.matchAll(
    /file_names\[\s*(\d+)\]:\s*\n\s*name: "([^"]*)"/g,
  );
  for (const file of files)
    if (file[2] === "fixture") fixtureFile = Number(file[1]);
  const rows: [number, number][] = [];
  for (const match of dwarf.matchAll(
    /^0x([0-9a-f]+)\s+(\d+)\s+\d+\s+(\d+)/gm,
  )) {
    const address = parseInt(match[1] ?? "0", 16);
    if (address >= start && address < end && Number(match[3]) === fixtureFile)
      rows.push([address, Number(match[2])]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  const text = spawnSync(
    "xcrun",
    [
      "llvm-objdump",
      "-d",
      "--no-show-raw-insn",
      "--no-leading-addr",
      "--start-address=0x" + start.toString(16),
      "--stop-address=0x" + end.toString(16),
      binary,
    ],
    { encoding: "utf8", maxBuffer: 1 << 30 },
  ).stdout;
  const result: Row[] = [];
  let address = start,
    cursor = 0,
    line = 0;
  for (const raw of text.split("\n")) {
    const instruction = raw.trim().replace(/\s*;.*$/, "");
    if (instruction === "" || instruction.endsWith(":") || raw.startsWith("/"))
      continue;
    if (/file format|Disassembly of/.test(raw)) continue;
    while (cursor < rows.length && (rows[cursor]?.[0] ?? Infinity) <= address) {
      line = rows[cursor]?.[1] ?? line;
      cursor++;
    }
    lines.set(address, line);
    result.push({
      line,
      text: instruction.replace(/\s*<[^>]*>/g, ""),
      category: classify(instruction),
    });
    address += 4;
  }
  return result;
}

function v8Rows(): Row[] {
  const plan = readFileSync(here + "measure.ts", "utf8");
  const iterations =
    new RegExp(target + ":\\s*\\{\\s*iterations:\\s*(\\d+)").exec(plan)?.[1] ??
    "100000";
  const run = spawnSync(
    process.execPath,
    [
      "--print-opt-code",
      "--code-comments",
      "--print-opt-code-filter=" + target,
      here + "node-run.ts",
      pattern ?? "",
      iterations,
    ],
    { encoding: "utf8", maxBuffer: 1 << 30 },
  ).stdout;
  // The last optimized code object is the steady state.
  const blocks = run.split("--- Optimized code ---");
  const block = blocks[blocks.length - 1];
  if (blocks.length < 2 || block === undefined)
    throw Error("V8 did not optimize " + target);
  const positions: [number, number][] = [];
  const table = block.split("Source positions:")[1] ?? "";
  for (const match of table.matchAll(/^\s+([0-9a-f]+)\s+(\d+)\s*$/gm))
    positions.push([parseInt(match[1] ?? "0", 16), Number(match[2])]);
  positions.sort((a, b) => a[0] - b[0]);
  const result: Row[] = [];
  let cursor = 0,
    line = 0;
  for (const match of block.matchAll(
    /^0x[0-9a-f]+\s+([0-9a-f]+)\s+[0-9a-f]{8}\s+(.+)$/gm,
  )) {
    const offset = parseInt(match[1] ?? "0", 16);
    while (
      cursor < positions.length &&
      (positions[cursor]?.[0] ?? Infinity) <= offset
    ) {
      line = lineOf(positions[cursor]?.[1] ?? 0);
      cursor++;
    }
    const instruction = (match[2] ?? "").replace(/\s*;;.*$/, "").trim();
    result.push({ line, text: instruction, category: classify(instruction) });
  }
  return result;
}

function summarize(rows: readonly Row[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  return counts;
}
function brief(counts: Map<string, number>): string {
  return categories
    .filter((name) => (counts.get(name) ?? 0) > 0)
    .map((name) => name + " " + counts.get(name))
    .join(", ");
}

const tint = tintRows(),
  v8 = v8Rows();
const used = [...new Set([...tint, ...v8].map((row) => row.line))]
  .filter((line) => line > 0)
  .sort((a, b) => a - b);
const sourceLines = source.split("\n");
console.log(`== ${target}: tint ${tint.length} instructions, V8 ${v8.length}`);
console.log("tint: " + brief(summarize(tint)));
console.log("V8:   " + brief(summarize(v8)));
console.log("\nper source line (tint / V8):");
for (const line of used) {
  const t = tint.filter((row) => row.line === line),
    v = v8.filter((row) => row.line === line);
  console.log(
    `${String(line).padStart(4)} ${String(t.length).padStart(4)} / ${String(v.length).padEnd(4)} ${(sourceLines[line - 1] ?? "").trim().slice(0, 70)}`,
  );
  if (t.length > 0) console.log("        tint: " + brief(summarize(t)));
  if (v.length > 0) console.log("        V8:   " + brief(summarize(v)));
  if (listing) {
    const height = Math.max(t.length, v.length);
    for (let i = 0; i < height; i++)
      console.log(
        "        " +
          (t[i]?.text ?? "").padEnd(44).slice(0, 44) +
          " | " +
          (v[i]?.text ?? ""),
      );
  }
}
const unattributed = tint.filter((row) => row.line === 0).length,
  v8Unattributed = v8.filter((row) => row.line === 0).length;
console.log(
  `\nprologue/unattributed: tint ${unattributed}, V8 ${v8Unattributed}`,
);

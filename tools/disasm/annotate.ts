// Annotated disassembly of a tint binary: per-function `llvm-objdump` output
// interleaved with the IR operation that emitted each instruction range and
// the TypeScript source line, optionally with profile samples per instruction.
//   node tools/disasm/annotate.ts <binary> [--function <substring>]...
//        [--profile <pprof.pb.gz>] [--thread busiest|<id>] [--hot N] [--all] [--source-root <dir>]
// Inputs next to the binary (each optional, at least one function source):
//   <binary>.operations.json  IR operation ranges (--operation-ranges /
//                             TINT_OPERATION_RANGES=1)
//   <binary>.optimized.ir     full IR text of each operation (TINT_DUMP_IR=)
//   <binary>.code-size.json   function extents and source names (--code-size /
//                             TINT_CODE_SIZE=1)
//   debug symbols and DWARF   function names and source lines (--debug-symbols /
//                             TINT_DEBUG_SYMBOLS=1)
// --source-root also prints the source text (objdump --source, run there).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { leafSamples, type LeafSamples } from "../op-cost/profile.ts";

export interface MachOSection {
  readonly segment: string;
  readonly section: string;
  readonly address: number;
  readonly size: number;
}
/** Sections of a 64-bit Mach-O image (LC_SEGMENT_64 load commands). */
export function machOSections(bytes: Uint8Array): MachOSection[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0xfeedfacf)
    throw Error("not a 64-bit Mach-O image");
  const commands = view.getUint32(16, true),
    sections: MachOSection[] = [];
  const text = (offset: number) => {
    let end = offset;
    while (end < offset + 16 && bytes[end] !== 0) end++;
    return new TextDecoder().decode(bytes.subarray(offset, end));
  };
  let offset = 32;
  for (let command = 0; command < commands; command++) {
    const kind = view.getUint32(offset, true),
      size = view.getUint32(offset + 4, true);
    if (kind === 0x19) {
      const count = view.getUint32(offset + 64, true);
      for (let index = 0; index < count; index++) {
        const at = offset + 72 + index * 80;
        sections.push({
          section: text(at),
          segment: text(at + 16),
          address: Number(view.getBigUint64(at + 32, true)),
          size: Number(view.getBigUint64(at + 40, true)),
        });
      }
    }
    offset += size;
  }
  return sections;
}

export interface OperationRange {
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
export interface AnnotatedFunction {
  /** Display name (debug symbol or source name, with the IR name). */
  readonly name: string;
  /** IR/native function name, as in operation ranges. */
  readonly irName: string | undefined;
  readonly address: number;
  readonly byteLength: number;
}

/** IR text by function name and block: the block's instruction lines, then
 * its terminator (TINT_DUMP_IR `.ir` files). */
export function parseIRDump(text: string): Map<string, Map<number, string[]>> {
  const functions = new Map<string, Map<number, string[]>>();
  let blocks: Map<number, string[]> | undefined, current: string[] | undefined;
  for (const line of text.split("\n")) {
    const header = /^fn \d+ (\S+)/.exec(line);
    if (header !== null) {
      blocks = new Map();
      functions.set(header[1] ?? "", blocks);
      current = undefined;
      continue;
    }
    const block = /^ {2}b(\d+):/.exec(line);
    if (block !== null && blocks !== undefined) {
      current = [];
      blocks.set(Number(block[1]), current);
      continue;
    }
    if (line.startsWith("    ") && current !== undefined)
      current.push(line.trim());
  }
  return functions;
}

/** Functions of the image: code size report extents, else debug symbols,
 * else operation range extents. */
export function imageFunctions(
  binary: string,
  textAddress: number,
  textEnd: number,
  ranges: readonly OperationRange[],
): AnnotatedFunction[] {
  const sizes = binary + ".code-size.json";
  if (existsSync(sizes)) {
    const report = JSON.parse(readFileSync(sizes, "utf8")) as {
      functions: {
        module: string;
        name: string;
        source?: string;
        offset?: number;
        bytes: number;
      }[];
    };
    const listed: AnnotatedFunction[] = [];
    for (const fn of report.functions)
      if (fn.offset !== undefined)
        listed.push({
          name:
            fn.module +
            ":" +
            (fn.source === undefined ? fn.name : `${fn.source} [${fn.name}]`),
          irName: fn.module === "program" ? fn.name : undefined,
          address: textAddress + fn.offset,
          byteLength: fn.bytes,
        });
    if (listed.length > 0) return listed.sort((a, b) => a.address - b.address);
  }
  const symbols: { address: number; name: string }[] = [];
  const nm = spawnSync("nm", ["-n", binary], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  for (const line of nm.stdout.split("\n")) {
    const match = /^([0-9a-f]+) [tT] (.+)$/.exec(line);
    if (match !== null)
      symbols.push({ address: parseInt(match[1] ?? "0", 16), name: match[2]! });
  }
  if (symbols.length > 0)
    return symbols.map((symbol, index) => {
      const generated = /^program:.* \[(.+)\]$/.exec(symbol.name);
      return {
        name: symbol.name,
        irName: generated?.[1],
        address: symbol.address,
        byteLength: (symbols[index + 1]?.address ?? textEnd) - symbol.address,
      };
    });
  const extents = new Map<string, { start: number; end: number }>();
  for (const range of ranges) {
    const extent = extents.get(range.functionName) ?? {
      start: range.functionOffset,
      end: range.functionOffset,
    };
    extent.end = Math.max(extent.end, range.offset + range.byteLength);
    extents.set(range.functionName, extent);
  }
  return [...extents]
    .map(([name, extent]) => ({
      name: "program:" + name,
      irName: name,
      address: textAddress + extent.start,
      byteLength: extent.end - extent.start,
    }))
    .sort((a, b) => a.address - b.address);
}

export interface AnnotateOptions {
  readonly functions: readonly string[];
  readonly profile?: string;
  /** Restrict profile samples to a thread (see LeafOptions). */
  readonly thread?: number | "busiest";
  /** Samples already parsed (instead of `profile`). */
  readonly samples?: LeafSamples;
  readonly hot?: number;
  readonly all?: boolean;
  readonly sourceRoot?: string;
}
export function annotate(binary: string, options: AnnotateOptions): string {
  const sections = machOSections(new Uint8Array(readFileSync(binary)));
  const text = sections.find(
    (section) => section.segment === "__TEXT" && section.section === "__text",
  );
  if (text === undefined) throw Error("no __TEXT,__text section");
  const dwarf = sections.some((section) => section.segment === "__DWARF");
  const rangesPath = binary + ".operations.json",
    irPath = binary + ".optimized.ir";
  const ranges: OperationRange[] = existsSync(rangesPath)
    ? JSON.parse(readFileSync(rangesPath, "utf8"))
    : [];
  const ir = existsSync(irPath)
    ? parseIRDump(readFileSync(irPath, "utf8"))
    : undefined;
  // Operation range by the address of its first instruction.
  const rangeStarts = new Map<number, OperationRange>();
  for (const range of ranges)
    rangeStarts.set(text.address + range.offset, range);
  const functions = imageFunctions(
    binary,
    text.address,
    text.address + text.size,
    ranges,
  );
  const samples =
    options.samples ??
    (options.profile === undefined
      ? undefined
      : leafSamples(
          options.profile,
          binary,
          options.thread === undefined ? {} : { thread: options.thread },
        ));
  const functionSamples = (fn: AnnotatedFunction) => {
    let count = 0;
    if (samples !== undefined)
      for (
        let address = fn.address;
        address < fn.address + fn.byteLength;
        address += 4
      )
        count += samples.byAddress.get(address) ?? 0;
    return count;
  };
  let selected = functions.filter(
    (fn) =>
      options.functions.length === 0 ||
      options.functions.some(
        (filter) =>
          fn.name.includes(filter) || (fn.irName?.includes(filter) ?? false),
      ),
  );
  if (options.functions.length === 0 && !options.all) {
    if (samples === undefined)
      throw Error(
        "select functions with --function, --hot (with --profile) or --all",
      );
    selected = [...selected]
      .sort((a, b) => functionSamples(b) - functionSamples(a))
      .slice(0, options.hot ?? 10);
  } else if (options.hot !== undefined && samples !== undefined)
    selected = [...selected]
      .sort((a, b) => functionSamples(b) - functionSamples(a))
      .slice(0, options.hot);
  const out: string[] = [];
  const total = Math.max(1, samples?.total ?? 1);
  const share = (count: number) => ((count / total) * 100).toFixed(2) + "%";
  for (const fn of selected) {
    const header =
      `== ${fn.name}  0x${fn.address.toString(16)}  ${fn.byteLength} bytes` +
      (samples === undefined
        ? ""
        : `  ${functionSamples(fn)} samples (${share(functionSamples(fn))})`);
    out.push(header);
    const args = [
      "llvm-objdump",
      "-d",
      "--no-show-raw-insn",
      `--start-address=0x${fn.address.toString(16)}`,
      `--stop-address=0x${(fn.address + fn.byteLength).toString(16)}`,
      ...(dwarf ? ["-l"] : []),
      ...(dwarf && options.sourceRoot !== undefined ? ["--source"] : []),
      binary,
    ];
    const run = spawnSync("xcrun", args, {
      encoding: "utf8",
      maxBuffer: 1 << 30,
      ...(options.sourceRoot === undefined ? {} : { cwd: options.sourceRoot }),
    });
    if (run.status !== 0) throw Error("llvm-objdump failed: " + run.stderr);
    for (const line of run.stdout.split("\n")) {
      const instruction = /^\s*([0-9a-f]+):\s*(.*)$/.exec(line);
      if (instruction === null) {
        // Source lines (`; file:line`) and source text; skip banners.
        if (line.startsWith(";") && !/^; .*\(\):$/.test(line))
          out.push("              " + line);
        continue;
      }
      const address = parseInt(instruction[1] ?? "0", 16);
      const range = rangeStarts.get(address);
      if (range !== undefined) {
        // Terminators are reported at index -1 (the block's last line).
        const lines = ir?.get(range.functionName)?.get(range.block),
          irText =
            lines === undefined
              ? undefined
              : lines[range.index < 0 ? lines.length - 1 : range.index];
        out.push(
          `              ; IR b${range.block}#${range.index} ` +
            (irText ?? `${range.operation} ${range.operands}`) +
            (irText === undefined || range.operands === ""
              ? ""
              : `   [${range.operands}]`),
        );
      }
      const count = samples?.byAddress.get(address) ?? 0;
      out.push(
        (samples === undefined
          ? ""
          : (count === 0 ? "" : String(count)).padStart(6) + " ") +
          `  ${address.toString(16)}:  ${(instruction[2] ?? "").replace(/\s+;.*$/, "")}`,
      );
    }
    out.push("");
  }
  return out.join("\n");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const argv = process.argv.slice(2);
  const valued = [
    "--function",
    "--profile",
    "--thread",
    "--hot",
    "--source-root",
  ];
  const option = (name: string): string | undefined => {
    const at = argv.indexOf(name);
    return at < 0 ? undefined : argv[at + 1];
  };
  const binary = argv.find(
    (arg, i) => !arg.startsWith("--") && !valued.includes(argv[i - 1] ?? ""),
  );
  if (binary === undefined) {
    process.stderr.write(
      "usage: annotate.ts <binary> [--function s]... [--profile p.pb.gz] [--thread busiest|id] [--hot N] [--all] [--source-root dir]\n",
    );
    process.exit(64);
  }
  const functions = argv.flatMap((arg, i) =>
    argv[i - 1] === "--function" ? [arg] : [],
  );
  const profile = option("--profile"),
    thread = option("--thread"),
    hot = option("--hot"),
    sourceRoot = option("--source-root");
  process.stdout.write(
    annotate(binary, {
      functions,
      all: argv.includes("--all"),
      ...(profile === undefined ? {} : { profile }),
      ...(thread === undefined
        ? {}
        : { thread: thread === "busiest" ? "busiest" : Number(thread) }),
      ...(hot === undefined ? {} : { hot: Number(hot) }),
      ...(sourceRoot === undefined ? {} : { sourceRoot }),
    }),
  );
}

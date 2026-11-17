// Linux `perf` CPU samples in the shared sample model: `perf script` text
// (call graphs recorded with --call-graph fp or dwarf) parsed into samples
// whose frames in one executable carry linked addresses, ready for DWARF
// re-symbolisation and the pprof / .cpuprofile writers. The Linux
// counterpart of the macOS `sample` call-tree parser
// (tools/native-sample-attribution.ts).
//
// Record and convert (VMs without a PMU sample the cpu-clock software
// event; Tint keeps frame records, so fp call graphs are complete):
//   perf record -e cpu-clock -F 999 --call-graph fp -o perf.data -- <image>
//   node tools/heap-snapshot/cli.ts perf perf.data --image <image>
//        --pprof cpu.pb.gz --cpuprofile cpu.cpuprofile
import type { Location, Sample, SampleProfile, SourceLine } from "./samples.ts";

/** The fields `perfScriptArguments` requests, one sample per block. */
export const perfScriptFields =
  "pid,tid,time,period,event,ip,sym,symoff,dso,dsoff";
/** `perf script` arguments producing the text parsePerfScript reads: one
 * physical frame per line (perf's own inline expansion is left to the
 * DWARF symboliser, which also names Tint's inlined frames). */
export function perfScriptArguments(data: string): string[] {
  return ["script", "-i", data, "-F", perfScriptFields, "--no-inline"];
}

export interface PerfFrame {
  /** The address perf reports: the sampled pc for the leaf, the return
   * address minus one for callers. */
  readonly address: number;
  /** perf's symbol (from .symtab or .dynsym), or undefined if unknown. */
  readonly symbol: string | undefined;
  readonly dso: string | undefined;
  /** The address as an offset into the object file, when perf knows it. */
  readonly dsoOffset: number | undefined;
}
export interface PerfSample {
  readonly pid: number;
  readonly tid: number;
  /** Seconds since boot. */
  readonly time: number;
  /** The event's period: nanoseconds for cpu-clock / task-clock. */
  readonly period: number;
  readonly event: string;
  /** Leaf first. */
  readonly frames: readonly PerfFrame[];
}

const headerPattern =
  /^\s*(?:\S.*?\s+)?(\d+)\/(\d+)\s+([\d.]+):\s+(\d+)\s+(\S+?):?\s*$/;
const headerWithoutPid =
  /^\s*(?:\S.*?\s+)?(\d+)\s+([\d.]+):\s+(\d+)\s+(\S+?):?\s*$/;
const framePattern = /^\s+([0-9a-f]+)\s+(.*)\s+\((.*)\)\s*$/;

/** Parses `perf script` output (perfScriptArguments, or the default fields
 * with call graphs): a header line per sample, then its frames, leaf first,
 * each `address symbol+offset (dso+offset)`. Frames at address 0 (the end
 * of a frame-pointer chain) are dropped, as is the duplicate caller that
 * arm64 frame-pointer call graphs add from the link register. */
export function parsePerfScript(text: string): PerfSample[] {
  const samples: PerfSample[] = [];
  let header:
    | { pid: number; tid: number; time: number; period: number; event: string }
    | undefined;
  let frames: PerfFrame[] = [];
  const finish = (): void => {
    if (header !== undefined) samples.push({ ...header, frames });
    header = undefined;
    frames = [];
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      finish();
      continue;
    }
    const frame = framePattern.exec(line);
    if (frame !== null && header !== undefined && /^\s/.test(line)) {
      const address = parseInt(frame[1] ?? "0", 16);
      if (address === 0) continue;
      const location = frame[3] ?? "";
      const dsoMatch = /^(.*)\+0x([0-9a-f]+)$/.exec(location);
      const dso = dsoMatch === null ? location : dsoMatch[1];
      const symbolText = frame[2] ?? "";
      const symbol =
        symbolText === "[unknown]"
          ? undefined
          : symbolText.replace(/\+0x[0-9a-f]+$/, "");
      const parsed: PerfFrame = {
        address,
        symbol,
        dso: dso === "[unknown]" ? undefined : dso,
        dsoOffset:
          dsoMatch === null ? undefined : parseInt(dsoMatch[2] ?? "0", 16),
      };
      const previous = frames[frames.length - 1];
      // arm64 fp call graphs: the link register's caller (exact return
      // address) right after the same call site from the frame chain
      // (return address - 1).
      if (
        previous !== undefined &&
        frames.length >= 2 &&
        parsed.address === previous.address + 1 &&
        parsed.dso === previous.dso
      )
        continue;
      frames.push(parsed);
      continue;
    }
    finish();
    const withPid = headerPattern.exec(line);
    if (withPid !== null) {
      header = {
        pid: Number(withPid[1]),
        tid: Number(withPid[2]),
        time: Number(withPid[3]),
        period: Number(withPid[4]),
        event: withPid[5] ?? "",
      };
      continue;
    }
    const plain = headerWithoutPid.exec(line);
    if (plain !== null)
      header = {
        pid: Number(plain[1]),
        tid: Number(plain[1]),
        time: Number(plain[2]),
        period: Number(plain[3]),
        event: plain[4] ?? "",
      };
  }
  finish();
  return samples;
}

/** Whether a frame lies in the executable (perf names it by path). */
function inImage(frame: PerfFrame, image: string): boolean {
  return (
    frame.dso !== undefined &&
    frame.dsoOffset !== undefined &&
    (frame.dso === image ||
      frame.dso.endsWith("/" + basename(image)) ||
      basename(frame.dso) === basename(image))
  );
}
function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export interface PerfProfileOptions {
  /** The executable; its frames get linked addresses (the ELF file offset
   * of an address equals its linked address in Tint images). */
  readonly image: string;
  /** Lines (innermost inlined callee first) at linked image addresses. */
  readonly symbolise?:
    | ((addresses: readonly number[]) => ReadonlyMap<number, SourceLine[]>)
    | undefined;
  /** Only samples of this thread (`main`: the process's first thread). */
  readonly thread?: number | "main" | undefined;
}

/** A CPU profile from perf samples: sample counts and CPU nanoseconds (the
 * cpu-clock period), thread_id labels, and one mapping for the image whose
 * frames carry linked addresses. Other objects' frames keep perf's symbol. */
export function perfProfile(
  samples: readonly PerfSample[],
  options: PerfProfileOptions,
): SampleProfile {
  const selected = samples.filter((sample) =>
    options.thread === undefined
      ? true
      : options.thread === "main"
        ? sample.tid === sample.pid
        : sample.tid === options.thread,
  );
  const addresses: number[] = [];
  let imageEnd = 0;
  for (const sample of selected)
    for (const frame of sample.frames)
      if (inImage(frame, options.image) && frame.dsoOffset !== undefined) {
        addresses.push(frame.dsoOffset);
        imageEnd = Math.max(imageEnd, frame.dsoOffset + 4);
      }
  const lines = options.symbolise?.(addresses) ?? new Map();
  const result: Sample[] = [];
  let first = Infinity,
    last = 0;
  const periods: number[] = [];
  for (const sample of selected) {
    first = Math.min(first, sample.time);
    last = Math.max(last, sample.time);
    periods.push(sample.period);
    const stack: Location[] = sample.frames.map((frame) => {
      if (inImage(frame, options.image) && frame.dsoOffset !== undefined) {
        const resolved = lines.get(frame.dsoOffset);
        return {
          address: frame.dsoOffset,
          lines:
            resolved !== undefined && resolved.length > 0
              ? resolved
              : [
                  {
                    function:
                      frame.symbol ?? "0x" + frame.dsoOffset.toString(16),
                  },
                ],
        };
      }
      return {
        address: frame.address,
        lines: [
          {
            function:
              frame.symbol ??
              (frame.dso === undefined
                ? "[unknown]"
                : "[" + basename(frame.dso) + "]"),
          },
        ],
      };
    });
    result.push({
      stack,
      values: [1, sample.period],
      numLabels: {
        thread_id: sample.tid,
        timestamp: Math.round(sample.time * 1e9),
      },
    });
  }
  periods.sort((a, b) => a - b);
  const period = periods[Math.floor(periods.length / 2)] ?? 0;
  return {
    sampleTypes: [
      { type: "samples", unit: "count" },
      { type: "cpu", unit: "nanoseconds" },
    ],
    samples: result,
    periodType: { type: "cpu", unit: "nanoseconds" },
    period,
    defaultSampleType: "cpu",
    mapping: {
      start: 0,
      limit: imageEnd,
      offset: 0,
      file: options.image,
      buildId: "",
    },
    comments: ["converted from perf script (" + selected.length + " samples)"],
    ...(selected.length > 0
      ? {
          timeNanos: Math.round(first * 1e9),
          durationNanos: Math.round((last - first) * 1e9),
        }
      : {}),
  };
}

/** Exclusive (leaf) samples per function of one thread, like the macOS
 * `sample` attribution: the leaf frame's symbol, most samples first. */
export function attributePerfSamples(
  samples: readonly PerfSample[],
  thread: number | "main" = "main",
): {
  samples: number;
  leafGroups: readonly { function: string; samples: number; percent: number }[];
} {
  const groups = new Map<string, number>();
  let total = 0;
  for (const sample of samples) {
    if (thread === "main" ? sample.tid !== sample.pid : sample.tid !== thread)
      continue;
    total++;
    const leaf = sample.frames[0];
    const name =
      leaf?.symbol ??
      (leaf?.dso === undefined ? "[unknown]" : "[" + basename(leaf.dso) + "]");
    groups.set(name, (groups.get(name) ?? 0) + 1);
  }
  if (total === 0) throw new Error("perf script has no samples of the thread");
  return {
    samples: total,
    leafGroups: [...groups]
      .map(([name, count]) => ({
        function: name,
        samples: count,
        percent: (100 * count) / total,
      }))
      .sort(
        (a, b) => b.samples - a.samples || a.function.localeCompare(b.function),
      ),
  };
}

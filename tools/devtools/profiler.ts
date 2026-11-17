// The Profiler domain: CPU profiles of the native process from an external
// sampler, converted through the shared profiling core into the
// `.cpuprofile` DevTools' Performance and JavaScript Profiler panels load.
//
//   pprofessor (default when installed): `pprofessor attach <pid>
//     --main-thread` samples the main thread through the Mach task port
//     while the debugger holds the process; on stop its pprof profile is
//     decoded and every address is re-symbolised from DWARF through the
//     backend (inlined frames included).
//   backend (fallback, or --sampler backend): periodic stack samples through
//     the debug adapter (pause, read the stack, continue). Portable to any
//     backend with `stack`, but far coarser (tens of Hz) and intrusive.
//
// A profile of a launched program starts once its entry point has run
// (BridgeContext.programEntered): samples of the debugger-held startup
// would describe the debugger, not the program.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { toCpuProfile } from "../profiling/devtools-profiles.ts";
import { decodeProfile } from "../profiling/pprof.ts";
import {
  normaliseLines,
  type Sample,
  type SampleProfile,
} from "../profiling/samples.ts";
import { CdpError, notSupported } from "./bridge.ts";
import type { BridgeContext, BridgePlugin, MethodHandler } from "./plugin.ts";

export type SamplerKind = "pprofessor" | "backend";

/** pprofessor's path, when installed. */
export function findPprofessor(): string | undefined {
  const explicit = process.env.PPROFESSOR;
  if (explicit !== undefined && explicit !== "") return explicit;
  const found = spawnSync("sh", ["-c", "command -v pprofessor"], {
    encoding: "utf8",
  });
  const path = found.stdout?.trim();
  return found.status === 0 && path !== undefined && path !== ""
    ? path
    : undefined;
}

interface Running {
  readonly kind: SamplerKind;
  readonly started: number;
  readonly file: string;
  readonly child?: ChildProcess | undefined;
  readonly exited?: Promise<number | null> | undefined;
  readonly samples: Sample[];
  stop: boolean;
  loop?: Promise<void> | undefined;
}

export class CpuProfiler implements BridgePlugin {
  readonly name = "profiler";
  private context: BridgeContext | undefined;
  private intervalMicros = 1000;
  private running: Running | undefined;
  private readonly sampler: SamplerKind;
  private readonly pprofessor: string | undefined;
  private profiles = 0;

  constructor(sampler?: SamplerKind) {
    this.pprofessor = sampler === "backend" ? undefined : findPprofessor();
    this.sampler =
      sampler ?? (this.pprofessor === undefined ? "backend" : "pprofessor");
    if (this.sampler === "pprofessor" && this.pprofessor === undefined)
      throw Error("pprofessor not found (install it or set PPROFESSOR)");
  }

  attach(context: BridgeContext): void {
    this.context = context;
  }

  private get bridge(): BridgeContext {
    if (this.context === undefined) throw Error("profiler not attached");
    return this.context;
  }

  methods(): Record<string, MethodHandler> {
    const ok = async (): Promise<object> => ({});
    const unsupported =
      (method: string): MethodHandler =>
      async () => {
        throw notSupported(method);
      };
    return {
      "Profiler.enable": ok,
      "Profiler.disable": ok,
      "Profiler.setSamplingInterval": async (params) => {
        if (this.running !== undefined)
          throw new CdpError(
            -32000,
            "Cannot change sampling interval when profiling.",
          );
        this.intervalMicros = Math.max(1000, Number(params.interval ?? 1000));
        return {};
      },
      "Profiler.start": () => this.start(),
      "Profiler.stop": () => this.stop(),
      "Profiler.startPreciseCoverage": unsupported(
        "Profiler.startPreciseCoverage",
      ),
      "Profiler.stopPreciseCoverage": unsupported(
        "Profiler.stopPreciseCoverage",
      ),
      "Profiler.takePreciseCoverage": unsupported(
        "Profiler.takePreciseCoverage",
      ),
      "Profiler.getBestEffortCoverage": unsupported(
        "Profiler.getBestEffortCoverage",
      ),
    };
  }

  private async start(): Promise<object> {
    if (this.running !== undefined) return {};
    const bridge = this.bridge;
    // Before the entry point runs, a launched process is still in dyld
    // startup, held by the debugger at its image-load stops for as long as
    // the debugger takes (seconds on a busy host). An external sampler
    // reads the suspended thread as if it ran, so the whole profile would
    // be the debugger's image notifier, not the program.
    if (bridge.state() !== "starting") await bridge.programEntered(120000);
    if (this.running !== undefined) return {};
    const pid = bridge.pid();
    if (
      pid === undefined ||
      bridge.state() === "exited" ||
      bridge.state() === "starting"
    )
      throw new CdpError(-32000, "the process is not running");
    const file = join(
      bridge.workDirectory,
      "cpu-" + String(++this.profiles) + ".pb.gz",
    );
    const started = Date.now() * 1000;
    if (this.sampler === "pprofessor" && this.pprofessor !== undefined) {
      const hertz = Math.max(
        1,
        Math.min(1000, Math.round(1e6 / this.intervalMicros)),
      );
      const child = spawn(
        this.pprofessor,
        [
          "attach",
          String(pid),
          "--no-publish",
          "--freq",
          String(hertz),
          // DevTools shows one thread's profile: the program's main thread
          // (idle runtime threads would otherwise dominate wall samples).
          "--main-thread",
          "-o",
          file,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let errors = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        errors += chunk.toString("utf8");
      });
      const exited = new Promise<number | null>((resolve) => {
        child.on("exit", (code) => resolve(code));
        child.on("error", () => resolve(-1));
      });
      // pprofessor reports failure to attach immediately.
      const early = await Promise.race([
        exited,
        new Promise<"running">((resolve) =>
          setTimeout(() => resolve("running"), 300),
        ),
      ]);
      if (early !== "running")
        throw new CdpError(
          -32000,
          "pprofessor failed to attach: " + errors.trim(),
        );
      this.running = {
        kind: "pprofessor",
        started,
        file,
        child,
        exited,
        samples: [],
        stop: false,
      };
    } else {
      const running: Running = {
        kind: "backend",
        started,
        file,
        samples: [],
        stop: false,
      };
      running.loop = this.sampleLoop(running);
      this.running = running;
    }
    return {};
  }

  /** Backend sampling: stop, read the stack, continue, at the interval
   * (at least 10 ms: each sample is a full debugger round trip). */
  private async sampleLoop(running: Running): Promise<void> {
    const bridge = this.bridge,
      backend = bridge.backend,
      delay = Math.max(10, this.intervalMicros / 1000);
    if (backend.stack === undefined)
      throw new CdpError(
        -32000,
        "the " + backend.name + " backend cannot read stacks",
      );
    const stack = backend.stack.bind(backend);
    while (!running.stop && bridge.state() !== "exited") {
      if (bridge.state() === "running") {
        try {
          const locations = await bridge.internal((operation) =>
            stack(operation.threadId),
          );
          running.samples.push({
            stack: locations.map((location) => ({
              address: location.address,
              lines: normaliseLines(location.lines),
            })),
            values: [1, delay * 1e6],
            numLabels: { timestamp: Date.now() * 1e6 },
          });
        } catch (error) {
          if (bridge.state() !== "exited")
            bridge.log("sample: " + String(error));
        }
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  private async stop(): Promise<object> {
    const running = this.running;
    if (running === undefined)
      throw new CdpError(-32000, "No recording profiles found");
    this.running = undefined;
    running.stop = true;
    const bridge = this.bridge;
    let profile: SampleProfile;
    if (running.kind === "pprofessor") {
      running.child?.kill("SIGINT");
      const code = await Promise.race([
        running.exited,
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 60000),
        ),
      ]);
      if (code === "timeout") {
        running.child?.kill("SIGKILL");
        throw new CdpError(-32000, "pprofessor did not finish its profile");
      }
      try {
        profile = decodeProfile(readFileSync(running.file));
      } catch (error) {
        throw new CdpError(
          -32000,
          "cannot read the pprofessor profile: " + String(error),
        );
      } finally {
        rmSync(running.file, { force: true });
      }
      profile = await this.resymbolise(profile);
    } else {
      await running.loop;
      profile = {
        sampleTypes: [
          { type: "samples", unit: "count" },
          { type: "wall", unit: "nanoseconds" },
        ],
        samples: running.samples,
        timeNanos: running.started * 1000,
      };
    }
    const renamed: SampleProfile = {
      ...profile,
      samples: profile.samples.map((sample) => ({
        ...sample,
        stack: sample.stack.map((location) => ({
          ...location,
          lines: location.lines.map((line) => ({
            ...line,
            function: bridge.frameName(line.function),
          })),
        })),
      })),
    };
    return {
      profile: toCpuProfile(renamed, {
        scriptIdOf: (file) => bridge.scriptIdOf(file),
        urlOf: (file) => bridge.urlOf(file),
      }),
    };
  }

  /** DWARF lines and inlined frames for every sampled address, through
   * the backend (pprofessor knows symbol names only). */
  private async resymbolise(profile: SampleProfile): Promise<SampleProfile> {
    const backend = this.bridge.backend;
    if (backend.symbolize === undefined || this.bridge.state() === "exited")
      return profile;
    const addresses = new Set<number>();
    for (const sample of profile.samples)
      for (const location of sample.stack)
        if (location.address !== undefined && location.address > 0)
          addresses.add(location.address);
    let symbols: Map<number, ReturnType<typeof normaliseLines>>;
    try {
      const raw = await backend.symbolize([...addresses]);
      symbols = new Map(
        [...raw].map(([address, lines]) => [address, normaliseLines(lines)]),
      );
    } catch (error) {
      this.bridge.log("symbolisation failed: " + String(error));
      return profile;
    }
    return {
      ...profile,
      samples: profile.samples.map((sample) => ({
        ...sample,
        stack: sample.stack.map((location) => {
          const lines =
            location.address === undefined
              ? undefined
              : symbols.get(location.address);
          // Keep pprofessor's name where DWARF knows nothing better.
          return lines === undefined ||
            lines.length === 0 ||
            (lines.length === 1 &&
              lines[0]?.file === undefined &&
              /^0x/.test(lines[0]?.function ?? ""))
            ? location
            : { address: location.address, lines };
        }),
      })),
    };
  }
}

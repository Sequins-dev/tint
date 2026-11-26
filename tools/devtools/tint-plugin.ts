// The Tint plugin of the DevTools bridge (docs/native-devtools.md).
//
// - Values: tools/lldb/tint.py's formatters run inside lldb-dap; their
//   summaries and synthetic children become JavaScript-like RemoteObjects
//   (strings, arrays, Map, Set, records, general values).
// - Frames: compiler symbol names (`program:fixture:run [@1:...$257]`)
//   become source names; inlined frames stay separate call frames.
// - HeapProfiler: heap snapshots (tint-heap dump at the allocation sample
//   hook, a precise safepoint, converted by the shared profiling core and
//   streamed as addHeapSnapshotChunk), sampling heap profiles through the
//   dormant `__tint_allocation_sample` hook, and forced major collections
//   (allocator request size 0) at the slow-path thunk's entry.
//
// Bulk memory goes through tint.py inside the debugger (one in-process
// pass over the heap), never through DAP readMemory.
import { closeSync, openSync, readSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { HeapDump } from "../heap-snapshot/dump.ts";
import { buildGraph } from "../heap-snapshot/graph.ts";
import { analyze } from "../profiling/analysis.ts";
import { toSamplingHeapProfile } from "../profiling/devtools-profiles.ts";
import { readAllocationSamples } from "../profiling/heap-profiles.ts";
import { writeHeapSnapshot } from "../profiling/heapsnapshot.ts";
import type { SampleProfile } from "../profiling/samples.ts";
import { CdpError, notSupported } from "./bridge.ts";
import type {
  BridgeContext,
  BridgePlugin,
  DapVariable,
  InternalOperation,
  MethodHandler,
  RemoteObject,
} from "./plugin.ts";
import { numberObject, quotedText, unavailable } from "./values.ts";

export const tintLldbModule = fileURLToPath(
  new URL("../lldb/tint.py", import.meta.url),
);
const sampleHook = "__tint_allocation_sample";
const slowPathThunk = "__tint_allocation_sample_thunk";
/** How long an operation waits for the program to reach a safepoint. */
const safepointTimeout = 30000;

function quote(text: string): string {
  return "'" + text.replaceAll("'", "'\\''") + "'";
}

/** `program:fixture:run [@1:value:3$255]` -> `run`. */
export function tintFrameName(name: string): string {
  let result = name.replace(/\s*\[[^\]]*\]$/, "").replace(/\$\d+$/, "");
  if (result.startsWith("program:")) result = result.slice("program:".length);
  const at = result.lastIndexOf(":");
  if (at > 0 && !result.startsWith("tint:")) result = result.slice(at + 1);
  return result;
}

/** The object kind a formatter summary or pointer type names. */
function objectKind(variable: DapVariable): string | undefined {
  const value = variable.value;
  const summary = /^0x[0-9a-f]+ (.+)$/.exec(value);
  if (summary !== null) return summary[1];
  const general = /^(.+) 0x[0-9a-f]+$/.exec(value);
  if (variable.type === "general" && general !== null) return general[1];
  const pointer = /^(.+) \*$/.exec(variable.type ?? "");
  if (pointer !== null && pointer[1] !== "object") return pointer[1];
  return undefined;
}

export function tintRemoteObject(
  variable: DapVariable,
  objectId: string | undefined,
): RemoteObject | null | undefined {
  const name = variable.name;
  // Header words, presence and cell-state bytes, descriptor variables.
  if (
    name.startsWith("__") ||
    /\.(present|state)$/.test(name) ||
    name.startsWith("__tint_record.")
  )
    return null;
  const type = variable.type ?? "",
    value = variable.value;
  const id = objectId === undefined ? {} : { objectId };
  if (unavailable(value))
    return { type: "undefined", description: "<optimized out>" };
  if (type === "double" || type === "long") return numberObject(value);
  if (type === "bool")
    return value === "true" || value === "false"
      ? { type: "boolean", value: value === "true" }
      : undefined;
  if (type === "general") {
    if (value === "undefined") return { type: "undefined" };
    if (value === "null")
      return { type: "object", subtype: "null", value: null };
    if (value === "true" || value === "false")
      return { type: "boolean", value: value === "true" };
    const text = quotedText(value);
    if (value.startsWith('"') && text !== undefined)
      return { type: "string", value: text };
    if (/^symbol 0x/.test(value))
      return { type: "symbol", description: "Symbol()" };
    if (/^bigint 0x/.test(value)) return { type: "bigint", description: value };
    const number = numberObject(value);
    if (number !== undefined) return number;
  }
  if (
    value === "null" ||
    /^0x0+$/.test(value) ||
    (/\*$/.test(type) && /^0x0+( |$)/.test(value))
  )
    return { type: "undefined" };
  const kind = objectKind(variable);
  const text = quotedText(value);
  if (
    /^string( \*)?$/.test(type) ||
    (kind?.startsWith('"') === true && text !== undefined)
  )
    return text === undefined ? undefined : { type: "string", value: text };
  if (kind === undefined) return undefined;
  if (
    kind === "{length, root}" ||
    kind === "{length, values, present}" ||
    kind === "vector"
  )
    return {
      type: "object",
      subtype: "array",
      className: "Array",
      description:
        variable.indexedVariables === undefined
          ? "Array"
          : "Array(" + String(variable.indexedVariables) + ")",
      ...id,
    };
  if (/\bhead, tail, size\b/.test(kind) || /^\{head, tail, size/.test(kind)) {
    const map = /\bkeys\b/.test(kind);
    return {
      type: "object",
      subtype: map ? "map" : "set",
      className: map ? "Map" : "Set",
      description: map ? "Map" : "Set",
      ...id,
    };
  }
  if (
    /\bkeys, values\b/.test(kind) &&
    /\bslots\b/.test(kind) &&
    /\bsize\b/.test(kind) &&
    (/\bhashes\b/.test(kind) || /\bdeleted\b/.test(kind))
  )
    return {
      type: "object",
      subtype: "map",
      className: "Map",
      description: "Map",
      ...id,
    };
  if (/^(Uint8|Uint16|Uint32|Float64)Array/.test(kind))
    return {
      type: "object",
      subtype: "typedarray",
      className: kind.replace(/\..*$/, ""),
      description: kind,
      ...id,
    };
  if (kind === "function")
    return {
      type: "function",
      className: "Function",
      description: "function",
      ...id,
    };
  return {
    type: "object",
    className: kind.startsWith("{") ? "Object" : kind,
    description: kind,
    ...id,
  };
}

export class TintPlugin implements BridgePlugin {
  readonly name = "tint";
  private context: BridgeContext | undefined;
  private sampling:
    { interval: number; file: string; breakpoint: number } | undefined;
  private operations = 0;

  initCommands(): string[] {
    return ["command script import " + tintLldbModule];
  }

  attach(context: BridgeContext): void {
    this.context = context;
    // Sampling stops at the hook: record the sample, then (when the bridge
    // was not pausing anyway) continue.
    context.addStopHandler(async (stopped) => {
      const id = this.sampling?.breakpoint;
      if (id === undefined || !(stopped.hitBreakpointIds ?? []).includes(id))
        return false;
      await context.command("tint-heap sample-record");
      return true;
    });
  }

  frameName(name: string): string {
    return tintFrameName(name);
  }

  /** The allocation hook and slow-path thunk where heap operations stop:
   * the allocating frame below them is at its safepoint. */
  hideFrame(name: string): boolean {
    return (
      name.startsWith("tint:diagnostics:") ||
      name.startsWith("__tint_allocation_sample")
    );
  }

  formatVariable(
    variable: DapVariable,
    objectId: string | undefined,
  ): RemoteObject | null | undefined {
    return tintRemoteObject(variable, objectId);
  }

  private get bridge(): BridgeContext {
    if (this.context === undefined) throw Error("Tint plugin not attached");
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
      "HeapProfiler.enable": ok,
      "HeapProfiler.disable": ok,
      "HeapProfiler.takeHeapSnapshot": (params) =>
        this.takeHeapSnapshot(params),
      "HeapProfiler.collectGarbage": () => this.collectGarbage(),
      "HeapProfiler.startSampling": (params) => this.startSampling(params),
      "HeapProfiler.getSamplingProfile": () => this.samplingProfile(false),
      "HeapProfiler.stopSampling": () => this.samplingProfile(true),
      "HeapProfiler.startTrackingHeapObjects": unsupported(
        "HeapProfiler.startTrackingHeapObjects",
      ),
      "HeapProfiler.stopTrackingHeapObjects": unsupported(
        "HeapProfiler.stopTrackingHeapObjects",
      ),
      "HeapProfiler.getObjectByHeapObjectId": unsupported(
        "HeapProfiler.getObjectByHeapObjectId",
      ),
      "HeapProfiler.getHeapObjectId": unsupported(
        "HeapProfiler.getHeapObjectId",
      ),
      "HeapProfiler.addInspectedHeapObject": ok,
      "Runtime.getHeapUsage": () => this.heapUsage(),
    };
  }

  private scratch(name: string): string {
    return join(
      this.bridge.workDirectory,
      name + "-" + String(++this.operations),
    );
  }

  /** Re-arms sampling (at its mean interval) after an operation used the
   * hook, or disarms. */
  private async restoreArm(operation: InternalOperation): Promise<void> {
    await operation
      .command("tint-heap arm " + String(this.sampling?.interval ?? 0))
      .catch(() => "");
  }

  /** Runs to the next allocation that takes the slow path, stopping at
   * `symbol` (the sample hook or the thunk's entry): a precise safepoint. */
  private async toSafepoint(
    operation: InternalOperation,
    symbol: string,
  ): Promise<number> {
    await operation.command("tint-heap arm 1");
    const [id] = await operation.setFunctionBreakpoints([symbol]);
    if (id === undefined || id < 0)
      throw new CdpError(-32000, symbol + " not found (not a debug build?)");
    await operation.continueToBreakpoint([id], safepointTimeout);
    return id;
  }

  private async takeHeapSnapshot(
    params: Record<string, unknown>,
  ): Promise<object> {
    const bridge = this.bridge,
      progress = params.reportProgress === true,
      directory = this.scratch("snapshot");
    try {
      await bridge.internal(async (operation) => {
        try {
          await this.toSafepoint(operation, sampleHook);
          await operation.command(
            "tint-heap dump " + quote(directory),
            3600000,
          );
        } finally {
          await this.restoreArm(operation);
        }
      });
      if (progress)
        await bridge.emit("HeapProfiler.reportHeapSnapshotProgress", {
          done: 1,
          total: 3,
        });
      const dumped = buildGraph(new HeapDump(directory));
      // Root frames by source name, as the Sources panel shows them.
      const graph = {
          ...dumped,
          frames: dumped.frames.map((frame) => ({
            ...frame,
            name: frame.name
              .split(" ← ")
              .map((part) =>
                part.replace(
                  /^(.*?)( \([^()]*\))?$/,
                  (_, name: string, at?: string) =>
                    tintFrameName(name) + (at ?? ""),
                ),
              )
              .join(" ← "),
          })),
        },
        analysis = analyze(graph);
      if (progress)
        await bridge.emit("HeapProfiler.reportHeapSnapshotProgress", {
          done: 2,
          total: 3,
        });
      const file = join(directory, "snapshot.heapsnapshot");
      writeHeapSnapshot(analysis, file);
      if (progress)
        await bridge.emit("HeapProfiler.reportHeapSnapshotProgress", {
          done: 3,
          total: 3,
          finished: true,
        });
      await this.streamChunks(file);
      return {};
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  /** Sends a file as addHeapSnapshotChunk events of about a megabyte,
   * split on character boundaries, respecting socket backpressure. */
  private async streamChunks(file: string): Promise<void> {
    const fd = openSync(file, "r"),
      decoder = new StringDecoder("utf8"),
      buffer = Buffer.alloc(1 << 20);
    try {
      const size = statSync(file).size;
      for (let position = 0; position < size;) {
        const read = readSync(fd, buffer, 0, buffer.length, position);
        if (read <= 0) break;
        position += read;
        const chunk = decoder.write(buffer.subarray(0, read));
        if (chunk !== "")
          await this.bridge.emit("HeapProfiler.addHeapSnapshotChunk", {
            chunk,
          });
      }
      const rest = decoder.end();
      if (rest !== "")
        await this.bridge.emit("HeapProfiler.addHeapSnapshotChunk", {
          chunk: rest,
        });
    } finally {
      closeSync(fd);
    }
  }

  /** A forced major collection (allocator request size 0) at a safepoint:
   * the entry of the allocation slow-path thunk, reached by arming the
   * next allocation into the slow path. tint.py's collect-begin calls the
   * thunk with request 0 before the pending allocation (see its comment);
   * collect-end restores the allocation's registers at the return. */
  private async collectGarbage(): Promise<object> {
    await this.bridge.internal(async (operation) => {
      let begun = false;
      try {
        const id = await this.toSafepoint(operation, slowPathThunk);
        await operation.command("tint-heap collect-begin");
        begun = true;
        await operation.continueToBreakpoint([id], 600000);
        const result = await operation.command("tint-heap collect-end");
        begun = false;
        if (!/status=1 /.test(result))
          throw new CdpError(-32000, "the forced collection failed: " + result);
        this.bridge.log(result.trim());
      } finally {
        if (!begun) await this.restoreArm(operation);
      }
    });
    return {};
  }

  private async startSampling(
    params: Record<string, unknown>,
  ): Promise<object> {
    if (this.sampling !== undefined)
      throw new CdpError(-32000, "Sampling is already started");
    const interval = Math.max(
      16,
      Math.round(Number(params.samplingInterval ?? 32768)),
    );
    const file = this.scratch("samples") + ".jsonl";
    await this.bridge.internal(async (operation) => {
      await operation.command(
        "tint-heap sample-start --interval " + String(interval),
      );
      const [breakpoint] = await this.bridge.setPersistentFunctionBreakpoints(
        "tint-sampling",
        [sampleHook],
      );
      if (breakpoint === undefined || breakpoint < 0)
        throw new CdpError(-32000, sampleHook + " not found");
      this.sampling = { interval, file, breakpoint };
    });
    return {};
  }

  private async samplingProfile(stop: boolean): Promise<object> {
    const sampling = this.sampling;
    if (sampling === undefined)
      throw new CdpError(-32000, "Sampling profiler is not started");
    const out = " --out " + quote(sampling.file);
    if (!stop) await this.bridge.command("tint-heap sample-flush" + out);
    else {
      if (this.bridge.state() === "exited") {
        await this.bridge.command("tint-heap sample-stop" + out);
        this.sampling = undefined;
      } else
        await this.bridge.internal(async (operation) => {
          if (this.sampling !== sampling)
            throw new CdpError(-32000, "Sampling profiler is not started");
          await operation.command("tint-heap sample-stop" + out);
          this.sampling = undefined;
          await this.bridge.setPersistentFunctionBreakpoints(
            "tint-sampling",
            [],
          );
        }, this.bridge.backend.inspectableStop);
    }
    try {
      const { profile } = readAllocationSamples(sampling.file);
      return { profile: this.present(profile) };
    } finally {
      if (stop) rmSync(sampling.file, { force: true });
    }
  }

  /** A sampling heap profile with source names and the bridge's script
   * ids, so DevTools links frames to the Sources panel. */
  private present(profile: SampleProfile): object {
    const renamed: SampleProfile = {
      ...profile,
      samples: profile.samples.map((sample) => ({
        ...sample,
        stack: sample.stack.map((location) => ({
          ...location,
          lines: location.lines.map((line) => ({
            ...line,
            function: tintFrameName(line.function),
          })),
        })),
      })),
    };
    return toSamplingHeapProfile(renamed, {
      scriptIdOf: (file) => this.bridge.scriptIdOf(file),
      urlOf: (file) => this.bridge.urlOf(file),
    });
  }

  private async heapUsage(): Promise<object> {
    if (this.bridge.state() !== "paused")
      throw notSupported("Runtime.getHeapUsage while the program runs");
    const info = JSON.parse(
      (await this.bridge.command("tint-heap info --json")).trim(),
    ) as {
      managedBytes?: number;
      state?: { oldTop: number; youngTop: number };
    };
    return {
      usedSize: (info.state?.oldTop ?? 0) + (info.state?.youngTop ?? 0),
      totalSize: info.managedBytes ?? 0,
      embedderHeapUsedSize: 0,
      backingStorageSize: 0,
    };
  }

  async dispose(): Promise<void> {
    this.sampling = undefined;
  }
}

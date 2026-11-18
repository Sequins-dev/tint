import { buildMacOSProgram, type BuildRequest } from "./build.ts";
import {
  selectNativeBackend,
  type ProgramOptimizationObserver,
} from "./native/index.ts";
import type { ModuleIR } from "@tint/ir/scalar";
import { nativeHostTarget, targetFileHost } from "@tint/platform/host";
import { readFile, publishFile } from "@tint/platform/files/service";
import { writeAll } from "@tint/platform/io/sync";
import {
  loadSourceGraphLoader,
  type SourceInput,
} from "@tint/typescript/modules";
import {
  argumentCount,
  argumentByteLength,
  copyArgument,
} from "@tint/native-runtime/intrinsics/process";
import { monotonicMilliseconds } from "@tint/native-runtime/intrinsics/clock";
import {
  formatPassJSON,
  formatPassTable,
  type PassEvent,
  type PassReport,
} from "@tint/ir/optimization";
import { projectFiles, projectMappings } from "./catalog.ts";
import { projectRoots, compilerBuildRequest } from "./project.ts";
import { expandForeignInputs } from "./native/foreign/index.ts";
import { compilerUsage, parseCompilerArguments } from "./cli-arguments.ts";
export {
  projectRoots,
  projectModuleLoader,
  projectBuildRequest,
  compilerBuildRequest,
  runtimeSources,
} from "./project.ts";
export { projectFiles, projectMappings } from "./catalog.ts";
function argument(index: number): string | undefined {
  const length = argumentByteLength(index);
  if (length < 0) return undefined;
  const bytes = new Uint8Array(length);
  if (copyArgument(index, bytes) !== length) return undefined;
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export function main(): number {
  // The compiler's own execution host: the target it was compiled for. It
  // selects the file host (errno names and values) and the default target.
  const hostTarget = nativeHostTarget();
  const host = targetFileHost(hostTarget);
  function report(message: string): void {
    const bytes = new TextEncoder().encode(message + "\n");
    writeAll((buffer) => host.write(2, buffer), bytes);
  }
  try {
    const args: string[] = [],
      count = argumentCount();
    for (let index = 1; index < count; index++) {
      const value = argument(index);
      if (value === undefined) {
        report("invalid compiler arguments");
        return 64;
      }
      args.push(value);
    }
    const parsed = parseCompilerArguments(args, hostTarget);
    if (parsed === undefined) {
      report(compilerUsage);
      return 64;
    }
    const backend = selectNativeBackend(parsed.target);
    if (!backend.ok) {
      report(backend.error.stage + ": " + backend.error.message);
      return 1;
    }
    const root = parsed.root,
      output = parsed.output,
      buildTarget = backend.target;
    report("sources");
    const inputs: SourceInput[] = [];
    for (const file of projectFiles()) {
      if (file === undefined) throw "project file invariant";
      const path = root + (root.endsWith("/") ? "" : "/") + file.id;
      const loaded = readFile<number>(host, path, 67108864);
      if (!loaded.ok) {
        report("cannot read " + file.id + ": " + loaded.error.operation);
        return 1;
      }
      inputs.push({
        id: file.id,
        packageId: file.packageId,
        bytes: loaded.value,
      });
    }
    report("parse");
    // C binding declarations become generated modules (docs/native-ffi.md).
    const foreign = expandForeignInputs(inputs, buildTarget.c);
    if (!foreign.ok) {
      report("foreign bindings: " + foreign.error);
      return 1;
    }
    const mappings = projectMappings();
    for (const mapping of foreign.value.mappings) {
      if (mapping === undefined) throw "foreign mapping invariant";
      mappings.push(mapping);
    }
    const graph = loadSourceGraphLoader(
      foreign.value.inputs,
      mappings,
      projectRoots(),
    );
    if (!graph.ok) {
      report("source graph: " + graph.error.message);
      return 1;
    }
    // Pass wall time excludes the observer's own bookkeeping. Builds whose
    // request did not bind the clock report passes without times.
    const passReports: PassReport[] = [];
    let passClock = 0,
      timed = true;
    function clock(): number {
      if (!timed) return 0;
      try {
        return monotonicMilliseconds();
      } catch (error) {
        timed = false;
        return 0;
      }
    }
    const observer: ProgramOptimizationObserver = {
      // The input module is not needed: begin only starts the clock.
      begin: (input: ModuleIR): void => {
        passClock = clock();
      },
      pass: (event: PassEvent): void => {
        const now = clock();
        if (timed)
          passReports.push({
            statistics: event.statistics,
            budgetExhausted: event.budgetExhausted,
            milliseconds: now - passClock,
          });
        else
          passReports.push({
            statistics: event.statistics,
            budgetExhausted: event.budgetExhausted,
          });
        passClock = clock();
      },
    };
    const request: BuildRequest = {
      ...compilerBuildRequest([], report, foreign.value.libraries, graph.value),
      target: buildTarget,
      debugSymbols: parsed.debugSymbols,
      debugDirectory: root,
    };
    const built = buildMacOSProgram(
      parsed.passStatistics
        ? { ...request, optimizationObserver: observer }
        : request,
    );
    if (!built.ok) {
      report(built.error.stage + ": " + built.error.message);
      return 1;
    }
    const published = publishFile<number>(host, output, built.value, true);
    if (!published.ok) {
      report("cannot publish compiler: " + published.error.operation);
      return 1;
    }
    if (parsed.passStatistics) {
      report(formatPassTable(passReports));
      const statistics = publishFile<number>(
        host,
        output + ".pass-stats.json",
        new TextEncoder().encode(formatPassJSON(passReports)),
        false,
      );
      if (!statistics.ok) {
        report("cannot publish pass statistics: " + statistics.error.operation);
        return 1;
      }
    }
    report("wrote " + output + " (" + built.value.length + " bytes)");
    return 0;
  } catch (error) {
    if (typeof error === "string") report(error);
    else report("compiler threw an unexpected exception");
    return 1;
  }
}

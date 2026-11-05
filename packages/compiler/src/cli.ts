import { buildMacOSProgram } from "./build.ts";
import { createNativeFileHost } from "@tint/platform/darwin/fs";
import { readFile, publishFile } from "@tint/platform/files/service";
import { writeAll } from "@tint/platform/io/sync";
import { loadSourceGraph, type SourceInput } from "@tint/typescript/modules";
import {
  argumentCount,
  argumentByteLength,
  copyArgument,
} from "@tint/native-runtime/intrinsics/process";
import { projectFiles, projectMappings } from "./catalog.ts";
import { projectRoots, projectBuildRequest } from "./project.ts";
export {
  projectRoots,
  projectBuildRequest,
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
  const host = createNativeFileHost();
  function report(message: string): void {
    const bytes = new TextEncoder().encode(message + "\n");
    writeAll((buffer) => host.write(2, buffer), bytes);
  }
  try {
    const count = argumentCount();
    const debugSymbols = count === 4 && argument(3) === "--debug-symbols";
    if (count !== 3 && !debugSymbols) {
      report(`usage: tint-compiler <project-root> <output> [--debug-symbols]
Build a native executable from a TypeScript project.`);
      return 64;
    }
    const root = argument(1),
      output = argument(2);
    if (root === undefined || output === undefined) {
      report("invalid compiler arguments");
      return 64;
    }
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
    const graph = loadSourceGraph(inputs, projectMappings(), projectRoots());
    if (!graph.ok) {
      report("source graph: " + graph.error.message);
      return 1;
    }
    const built = buildMacOSProgram({
      ...projectBuildRequest(graph.value, report),
      debugSymbols,
      debugDirectory: root,
    });
    if (!built.ok) {
      report(built.error.stage + ": " + built.error.message);
      return 1;
    }
    const published = publishFile<number>(host, output, built.value, true);
    if (!published.ok) {
      report("cannot publish compiler: " + published.error.operation);
      return 1;
    }
    report("wrote " + output + " (" + built.value.length + " bytes)");
    return 0;
  } catch (error) {
    if (typeof error === "string") report(error);
    else report("compiler threw an unexpected exception");
    return 1;
  }
}

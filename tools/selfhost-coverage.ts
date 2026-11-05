import { emitDarwinModule } from "./aarch64-executable.ts";
// Node-hosted audit of actual compiler sources; emission is distinct from execution/self-hosting.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";
import { createCatalog } from "@tint/source/catalog";
import type { ModuleSource } from "@tint/source/resolver";
import { auditLinkedSources } from "./linked-source-audit.ts";

import { workspaceSources } from "./workspace-sources.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : entry.isFile() && entry.name.endsWith(".ts")
        ? [path]
        : [];
  });
}
const files = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => sources(join(root, "packages", entry.name, "src")))
  .sort();
const args = process.argv.slice(2);
if (args.length > 0) {
  if (
    args.length < 2 ||
    args[0] !== "--entry" ||
    args
      .slice(2)
      .some(
        (arg) =>
          arg !== "--specialize" &&
          arg !== "--emit" &&
          arg !== "--runtime" &&
          arg !== "--instance",
      )
  )
    throw new Error(
      "usage: selfhost-coverage.ts [--entry packages/name/src/file.ts [--specialize] [--emit] [--runtime] [--instance]]",
    );
  const entries = files.map((path) => {
    const bytes = new TextEncoder().encode(readFileSync(path, "utf8"));
    const source = createSourceText(bytes, bytes.length);
    if (!source.ok) throw new Error(JSON.stringify(source.error));
    const id = relative(root, path);
    return {
      id,
      value: { packageId: id.split("/")[1]!, source: source.value },
    };
  });
  const catalog = createCatalog<ModuleSource>(entries);
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.error));
  const { mappings } = workspaceSources();
  console.log(
    JSON.stringify(
      auditLinkedSources(catalog.value, mappings, args[1]!, {
        specialize: args.includes("--specialize"),
        emit: args.includes("--emit"),
        runtime: args.includes("--runtime") || args.includes("--instance"),
        instance: args.includes("--instance"),
      }),
      null,
      2,
    ),
  );
} else {
  const results = files.map((path) => {
    const file = relative(root, path);
    const bytes = new TextEncoder().encode(readFileSync(path, "utf8"));
    const source = createSourceText(bytes, bytes.length);
    if (!source.ok)
      throw new Error(JSON.stringify({ file, error: source.error }));
    const parsed = parseModule(source.value);
    if (!parsed.ok)
      return { file, parsed: false, checked: false, diagnostic: parsed.error };
    const checked = checkClosureModule(parsed.value);
    if (!checked.ok) {
      const position = source.value.positionAt(checked.error.start);
      return {
        file,
        parsed: true,
        checked: false,
        diagnostic: {
          ...checked.error,
          position: position.ok ? position.value : undefined,
        },
      };
    }
    const entries = checked.value.bindings.functions
      .filter((f) => f.parent === undefined)
      .map((f) => f.id);
    const lowered = lowerModuleEntries(
      checked.value,
      entries,
      {
        pointerSize: 8,
        wordSize: 8,
        allocationAlignment: 16,
        frameAlignment: 16,
        maxAlignment: 16,
      },
      4096,
    );
    if (!lowered.ok)
      return {
        file,
        parsed: true,
        checked: true,
        emitted: false,
        diagnostic: lowered.error,
      };
    const native = emitDarwinModule(lowered.value.module);
    return {
      file,
      parsed: true,
      checked: true,
      emitted: native.ok,
      diagnostic: native.ok ? undefined : native.error,
    };
  });
  console.log(
    JSON.stringify(
      {
        scope:
          "Per-file syntax, contextual checking and module-entry arm64 emission; imports are not linked, and emitted code is not executed by this audit. Closure-factory emission has separate gates.",
        total: results.length,
        parsed: results.filter((result) => result.parsed).length,
        checked: results.filter((result) => result.checked).length,
        emitted: results.filter((result) => result.emitted).length,
        results,
      },
      null,
      2,
    ),
  );
}

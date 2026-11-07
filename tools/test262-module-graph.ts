import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { parseModule } from "@tint/typescript/syntax";
import { createSourceTextView } from "@tint/source/text";
import { within } from "./test262-checkout.ts";
export interface ModuleGraphNode {
  readonly name: string;
  readonly kind: "javascript" | "json";
  readonly source: string;
  readonly sha256: string;
  /** Bootstrap parsing discovers edges; it never establishes a syntax verdict. */
  readonly parsed: boolean;
  readonly bytes?: Uint8Array;
}
export interface ModuleGraph {
  readonly root: string;
  readonly nodes: readonly ModuleGraphNode[];
  readonly siblings: readonly string[];
  readonly absent: readonly string[];
}
/** Discover a closed Test262 fixture graph without evaluating or judging code.
 * Raw-text paths intentionally include comments: some dynamic-import tests build
 * the actual specifier at runtime and document its target only in a comment. */
export function discoverModuleGraph(
  filename: string,
  rootSource: string,
  goal: "script" | "module",
): ModuleGraph {
  const directory = dirname(resolve(filename));
  const siblings = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const available = new Set(siblings),
    pending: string[] = [],
    queued = new Set<string>(),
    absent = new Set<string>();
  const nodes: ModuleGraphNode[] = [];
  function request(specifier: string): void {
    if (!specifier.startsWith("./")) return;
    const name = specifier.slice(2);
    if (name.length === 0 || name.includes("/") || name.includes("\\")) return;
    if (!available.has(name)) {
      absent.add(name);
      return;
    }
    if (queued.has(name)) return;
    queued.add(name);
    pending.push(name);
  }
  function discover(source: string, staticRequests: boolean): boolean {
    let parsed = false;
    if (staticRequests) {
      const result = parseModule(createSourceTextView(source));
      parsed = result.ok;
      if (result.ok)
        for (const declaration of result.value.imports)
          if (!declaration.typeOnly) request(declaration.specifier);
    }
    for (const match of source.matchAll(/(['"])(\.\/[^'"\s\\]+)\1/g)) {
      const specifier = match[2];
      if (specifier !== undefined) request(specifier);
    }
    return parsed;
  }
  discover(rootSource, goal === "module");
  for (let index = 0; index < pending.length; index++) {
    const name = pending[index];
    if (name === undefined) throw Error("module graph pending invariant");
    const bytes = new Uint8Array(readFileSync(within(directory, name)));
    const source = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const kind = name.endsWith(".json") ? "json" : "javascript";
    const parsed = kind === "javascript" ? discover(source, true) : false;
    nodes.push({ name, kind, source, sha256, parsed, bytes });
  }
  nodes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    root: basename(filename),
    nodes,
    siblings,
    absent: [...absent].sort(),
  };
}

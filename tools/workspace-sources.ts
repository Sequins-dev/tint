import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  createSourceGraphCache,
  loadSourceGraph,
  loadSourceGraphLoader,
  type SourceGraphCache,
  type SourceInput,
} from "@tint/typescript/modules";
import type { ImportMapping } from "@tint/source/resolver";
import { compiledPackageExports } from "./package-exports.ts";
import { join } from "node:path";
/** Public availability is distinct from the per-package import grants below. */
export interface WorkspacePublicEntry {
  readonly specifier: string;
  readonly target: string;
}
export interface WorkspaceSourceSnapshot {
  readonly inputs: SourceInput[];
  readonly mappings: ImportMapping[];
  /** Version-1 historical snapshots lack unused public-entry metadata. */
  readonly publicEntries?: WorkspacePublicEntry[];
}
/** Capture logical package IDs independently of the physical workspace root. */
export function workspaceSources(
  rootDirectory: string = ".",
): WorkspaceSourceSnapshot {
  const inputs: SourceInput[] = [],
    mappings: ImportMapping[] = [];
  const packages = readdirSync(join(rootDirectory, "packages"), {
    withFileTypes: true,
  }).map((entry) => {
    if (!entry.isDirectory())
      throw Error("unexpected workspace entry: " + entry.name);
    return {
      id: entry.name,
      manifest: JSON.parse(
        readFileSync(
          join(rootDirectory, "packages", entry.name, "package.json"),
          "utf8",
        ),
      ),
    };
  });
  function visit(path: string, packageId: string): void {
    for (const entry of readdirSync(join(rootDirectory, path), {
      withFileTypes: true,
    })) {
      const file = path + "/" + entry.name;
      if (entry.isSymbolicLink())
        throw Error("symlink in portable source: " + file);
      if (entry.isDirectory()) visit(file, packageId);
      else if (entry.isFile() && entry.name.endsWith(".ts"))
        inputs.push({
          id: file,
          packageId,
          bytes: new Uint8Array(readFileSync(join(rootDirectory, file))),
        });
      else throw Error("untracked source kind: " + file);
    }
  }
  const byName = new Map<
    string,
    {
      readonly exports: ReturnType<typeof compiledPackageExports>;
    }
  >();
  for (const owner of packages) {
    visit("packages/" + owner.id + "/src", owner.id);
    if (byName.has(owner.manifest.name))
      throw Error("duplicate package name: " + owner.manifest.name);
    byName.set(owner.manifest.name, {
      exports: compiledPackageExports(
        owner.manifest.name,
        "packages/" + owner.id,
        owner.manifest.exports,
        inputs
          .filter((input) => input.packageId === owner.id)
          .map((input) => input.id),
      ),
    });
  }
  for (const owner of packages) {
    for (const specifier of Object.keys(owner.manifest.dependencies ?? {})) {
      const dependency = byName.get(specifier);
      if (
        dependency === undefined ||
        owner.manifest.dependencies[specifier] !== "workspace:*"
      )
        throw Error("unknown or non-workspace dependency: " + specifier);
      for (const entry of dependency.exports)
        mappings.push({
          packageId: owner.id,
          specifier: entry.specifier,
          target: entry.source,
        });
    }
  }
  inputs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const publicEntries = [...byName.values()].flatMap((owner) =>
    owner.exports.map((entry) => ({
      specifier: entry.specifier,
      target: entry.source,
    })),
  );
  publicEntries.sort((a, b) =>
    a.specifier < b.specifier ? -1 : a.specifier > b.specifier ? 1 : 0,
  );
  return { inputs, mappings, publicEntries };
}
// Builders load many overlapping graphs from one snapshot; decode and parse
// each of its inputs once.
const graphCaches = new WeakMap<WorkspaceSourceSnapshot, SourceGraphCache>();
/** A caller can share one captured source graph across independent builders. */
export function workspaceModules(
  roots: readonly string[],
  source: WorkspaceSourceSnapshot = workspaceSources(),
) {
  let cache = graphCaches.get(source);
  if (cache === undefined) {
    cache = createSourceGraphCache();
    graphCaches.set(source, cache);
  }
  const graph = loadSourceGraph(
    source.inputs,
    source.mappings,
    [...roots],
    cache,
  );
  if (!graph.ok) throw Error(JSON.stringify(graph));
  return graph.value;
}

/** Resolve the graph without adding syntax to the snapshot cache. */
export function workspaceModuleLoader(
  roots: readonly string[],
  source: WorkspaceSourceSnapshot = workspaceSources(),
) {
  const graph = loadSourceGraphLoader(source.inputs, source.mappings, roots);
  if (!graph.ok) throw Error(JSON.stringify(graph));
  return graph.value;
}

/** Fingerprint the exact captured graph, including import grants and source bytes.
 * Keep this serialization stable so native reports remain directly comparable. */
export function workspaceSourceIdentity(snapshot: WorkspaceSourceSnapshot): {
  readonly sha256: string;
  readonly files: number;
} {
  const hash = createHash("sha256").update(JSON.stringify(snapshot.mappings));
  if (snapshot.publicEntries !== undefined)
    hash.update(JSON.stringify(["publicEntries", snapshot.publicEntries]));
  for (const input of snapshot.inputs)
    hash
      .update(JSON.stringify([input.id, input.packageId, input.bytes.length]))
      .update(input.bytes);
  return { sha256: hash.digest("hex"), files: snapshot.inputs.length };
}

/** Store the graph used by a run, rather than relying on mutable workspace files. */
export function saveWorkspaceSourceSnapshot(
  path: string,
  snapshot: WorkspaceSourceSnapshot,
): void {
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: snapshot.publicEntries === undefined ? 1 : 2,
      ...(snapshot.publicEntries === undefined
        ? {}
        : { publicEntries: snapshot.publicEntries }),
      identity: workspaceSourceIdentity(snapshot),
      mappings: snapshot.mappings,
      inputs: snapshot.inputs.map((input) => ({
        id: input.id,
        packageId: input.packageId,
        bytes: Buffer.from(input.bytes).toString("base64"),
      })),
    }) + "\n",
    { flag: "wx" },
  );
}
/** Validate the recorded identity before supplying restored bytes to builders. */
export function readWorkspaceSourceSnapshot(
  path: string,
): WorkspaceSourceSnapshot {
  const saved: {
    schemaVersion: number;
    identity: { sha256: string; files: number };
    mappings: ImportMapping[];
    publicEntries?: WorkspacePublicEntry[];
    inputs: { id: string; packageId: string; bytes: string }[];
  } = JSON.parse(readFileSync(path, "utf8"));
  if (
    (saved.schemaVersion !== 1 && saved.schemaVersion !== 2) ||
    (saved.schemaVersion === 1 && saved.publicEntries !== undefined) ||
    (saved.schemaVersion === 2 && !Array.isArray(saved.publicEntries)) ||
    !Array.isArray(saved.inputs) ||
    !Array.isArray(saved.mappings)
  )
    throw Error("Invalid source snapshot schema");
  const inputs = saved.inputs.map((input) => {
    if (
      typeof input.id !== "string" ||
      typeof input.packageId !== "string" ||
      typeof input.bytes !== "string"
    )
      throw Error("Invalid source snapshot schema");
    return {
      id: input.id,
      packageId: input.packageId,
      bytes: new Uint8Array(Buffer.from(input.bytes, "base64")),
    };
  });
  const mappings = saved.mappings.map((mapping) => {
    if (
      typeof mapping.packageId !== "string" ||
      typeof mapping.specifier !== "string" ||
      typeof mapping.target !== "string"
    )
      throw Error("Invalid source snapshot schema");
    return {
      packageId: mapping.packageId,
      specifier: mapping.specifier,
      target: mapping.target,
    };
  });
  let publicEntries: WorkspacePublicEntry[] | undefined;
  if (saved.publicEntries !== undefined) {
    const sources = new Set(inputs.map((input) => input.id));
    const names = new Set<string>();
    publicEntries = saved.publicEntries.map((entry) => {
      if (
        entry === null ||
        typeof entry !== "object" ||
        Object.keys(entry).length !== 2 ||
        typeof entry.specifier !== "string" ||
        typeof entry.target !== "string" ||
        entry.specifier.startsWith(".") ||
        entry.specifier.startsWith("/") ||
        !entry.specifier
          .split("/")
          .every(
            (part) =>
              part !== "." && part !== ".." && /^[A-Za-z0-9_@.-]+$/.test(part),
          ) ||
        names.has(entry.specifier) ||
        !sources.has(entry.target)
      )
        throw Error("Invalid public entry source metadata");
      names.add(entry.specifier);
      return { specifier: entry.specifier, target: entry.target };
    });
  }
  const snapshot: WorkspaceSourceSnapshot = {
    inputs,
    mappings,
    ...(publicEntries === undefined ? {} : { publicEntries }),
  };
  const identity = workspaceSourceIdentity(snapshot);
  if (
    identity.sha256 !== saved.identity?.sha256 ||
    identity.files !== saved.identity?.files
  )
    throw Error("Source snapshot identity mismatch");
  return snapshot;
}

// The file set `frozen-workload.ts build --runtime-tree` copies from the tree
// into a frozen snapshot. The native runtime is linked into the frozen program
// and must agree with the current code generator on the host ABI: the
// `@tint/abi` data contracts (header layouts, startup records, stack maps,
// weak slots, shared blocks, C descriptors). So the set is the snapshot's
// runtime files plus every `@tint/abi` source they reach through imports.
// Other packages the runtime imports (foundation, js-runtime) are libraries
// the frozen compiler also uses; they stay frozen unless named with --tree.
import ts from "typescript";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { compiledPackageExports } from "./package-exports.ts";

export const runtimeDirectory = "packages/native-runtime/src";
/** The package that owns the host-ABI contract shared by codegen and runtime. */
export const contractPackage = { name: "@tint/abi", directory: "packages/abi" };

function sources(root: string, directory: string): string[] {
  if (!existsSync(join(root, directory))) return [];
  return (
    readdirSync(join(root, directory), {
      recursive: true,
      encoding: "utf8",
    }) as string[]
  )
    .filter((file) => file.endsWith(".ts"))
    .map((file) => directory + "/" + file.split("\\").join("/"));
}

export interface RuntimeTreeFiles {
  /** Workspace-relative sources to copy from the tree into the snapshot. */
  readonly files: readonly string[];
  /** Imported tree files the snapshot lacks, as "importer -> file". The
   * snapshot's catalog selects the program's inputs and cannot grow, so they
   * stay out; a build that reaches one fails to resolve it and needs a fresh
   * freeze. Runtime modules the frozen program never loads may list some. */
  readonly missing: readonly string[];
}

/** The snapshot's runtime files plus the `@tint/abi` sources they import,
 * transitively through relative and contract-package imports. */
export function runtimeTreeFiles(
  tree: string,
  snapshot: string,
): RuntimeTreeFiles {
  const manifest = JSON.parse(
    readFileSync(join(tree, contractPackage.directory, "package.json"), "utf8"),
  ) as { exports: unknown };
  const contracts = new Map(
    compiledPackageExports(
      contractPackage.name,
      contractPackage.directory,
      manifest.exports,
      sources(tree, contractPackage.directory + "/src"),
    ).map((entry) => [entry.specifier, entry.source]),
  );
  /** The followed import's source path, or undefined for other packages. */
  function resolveImport(file: string, specifier: string): string | undefined {
    if (specifier.startsWith("."))
      return posix.normalize(posix.join(posix.dirname(file), specifier));
    const { name } = contractPackage;
    if (specifier !== name && !specifier.startsWith(name + "/"))
      return undefined;
    const source = contracts.get(specifier);
    if (source === undefined)
      throw Error(`--runtime-tree: ${file} imports unknown ${specifier}`);
    return source;
  }
  const reached = new Set<string>(),
    missing = new Set<string>(),
    pending: { file: string; from?: string }[] = [];
  for (const file of sources(snapshot, runtimeDirectory))
    if (existsSync(join(tree, file))) pending.push({ file });
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const { file, from } = item;
    if (reached.has(file)) continue;
    if (!existsSync(join(tree, file)))
      throw Error(`--runtime-tree: ${from} imports missing ${file}`);
    if (!existsSync(join(snapshot, file))) {
      missing.add(from + " -> " + file);
      continue;
    }
    reached.add(file);
    const text = readFileSync(join(tree, file), "utf8");
    for (const { fileName } of ts.preProcessFile(text, true, true)
      .importedFiles) {
      const target = resolveImport(file, fileName);
      if (target !== undefined) pending.push({ file: target, from: file });
    }
  }
  return { files: [...reached].sort(), missing: [...missing].sort() };
}

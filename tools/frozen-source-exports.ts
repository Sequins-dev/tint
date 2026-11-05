import ts from "typescript";
import { existsSync, readFileSync, realpathSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { compiledPackageExports } from "./package-exports.ts";
export interface FrozenSourcePackage {
  readonly id: string;
  readonly name: string;
  readonly exports: Readonly<Record<string, string>>;
}
/** Read generated literal metadata without importing or executing frozen code. */
function catalogRows(
  text: string,
  name: string,
  fields: readonly string[],
): Record<string, string>[] {
  const file = ts.createSourceFile(
    "catalog.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const functions = file.statements.filter(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  const fn = functions[0];
  const statement = fn?.body?.statements[0];
  if (
    functions.length !== 1 ||
    fn === undefined ||
    fn.parameters.length !== 0 ||
    fn.body?.statements.length !== 1 ||
    statement === undefined ||
    !ts.isReturnStatement(statement) ||
    statement.expression === undefined ||
    !ts.isArrayLiteralExpression(statement.expression)
  )
    throw Error("invalid frozen catalog literal function: " + name);
  return statement.expression.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element))
      throw Error("invalid frozen catalog row");
    const row: Record<string, string> = {};
    for (const property of element.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        !(
          ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ) ||
        !ts.isStringLiteral(property.initializer) ||
        !fields.includes(property.name.text) ||
        Object.hasOwn(row, property.name.text)
      )
        throw Error("invalid frozen catalog field");
      row[property.name.text] = property.initializer.text;
    }
    if (Object.keys(row).length !== fields.length)
      throw Error("missing frozen catalog field");
    return row;
  });
}
/** Reconstruct Node source exports exclusively from one frozen compiler snapshot.
 * Manifests, when present, remain authoritative. Historical source-only snapshots
 * use exact incoming catalog grants and an existing src/index.ts root only. */
export function frozenSourcePackageExports(
  snapshot: string,
): readonly FrozenSourcePackage[] {
  const root = realpathSync(snapshot);
  const catalogs = [
    "packages/compiler-cli/src/catalog.ts",
    "packages/compiler/src/catalog.ts",
  ]
    .map((path) => join(root, path))
    .filter((path) => existsSync(path));
  if (catalogs.length !== 1)
    throw Error(
      (catalogs.length === 0 ? "missing" : "ambiguous") +
        " frozen compiler catalog",
    );
  const catalogPath = catalogs[0]!;
  if (
    lstatSync(catalogPath).isSymbolicLink() ||
    realpathSync(catalogPath) !== catalogPath
  )
    throw Error("symlink in frozen catalog");
  if (!lstatSync(catalogPath).isFile())
    throw Error("frozen catalog must be regular file");
  const catalog = readFileSync(catalogPath, "utf8");
  const files = catalogRows(catalog, "projectFiles", ["id", "packageId"]);
  const mappings = catalogRows(catalog, "projectMappings", [
    "packageId",
    "specifier",
    "target",
  ]);
  const byFile = new Map<string, string>(),
    packages = new Map<string, string[]>();
  for (const file of files) {
    const id = file.id!,
      owner = file.packageId!;
    if (
      !/^[a-z0-9][a-z0-9-]*$/.test(owner) ||
      !id.startsWith("packages/" + owner + "/src/") ||
      !id.endsWith(".ts") ||
      !id
        .split("/")
        .every(
          (part) =>
            part !== "" &&
            part !== "." &&
            part !== ".." &&
            /^[A-Za-z0-9_.-]+$/.test(part),
        ) ||
      byFile.has(id)
    )
      throw Error("invalid frozen source ownership: " + id);
    const physical = resolve(root, id);
    if (realpathSync(physical) !== physical)
      throw Error("symlink in frozen source: " + id);
    byFile.set(id, owner);
    const owned = packages.get(owner) ?? [];
    owned.push(id);
    packages.set(owner, owned);
  }
  const catalogId = catalogPath.slice(root.length + 1).replaceAll("\\", "/");
  const catalogOwner = catalogId.startsWith("packages/compiler-cli/")
    ? "compiler-cli"
    : "compiler";
  if (byFile.get(catalogId) !== catalogOwner)
    throw Error("invalid frozen catalog ownership");
  const names = new Map<string, string>(),
    imported = new Map<string, Map<string, string>>();
  for (const mapping of mappings) {
    const target = mapping.target!,
      specifier = mapping.specifier!,
      importer = mapping.packageId!;
    const owner = byFile.get(target);
    if (owner === undefined || !packages.has(importer))
      throw Error("invalid frozen import mapping target or owner");
    const parts = specifier.split("/"),
      name = parts.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
    const previousName = names.get(owner);
    if (previousName !== undefined && previousName !== name)
      throw Error("inconsistent frozen package export owner");
    names.set(owner, name);
    const entries = imported.get(owner) ?? new Map<string, string>();
    if (entries.has(specifier) && entries.get(specifier) !== target)
      throw Error("inconsistent frozen public export target");
    entries.set(specifier, target);
    imported.set(owner, entries);
  }
  const result: FrozenSourcePackage[] = [],
    seenNames = new Set<string>();
  for (const [id, paths] of packages) {
    const directory = "packages/" + id,
      manifestPath = join(root, directory, "package.json");
    if (existsSync(manifestPath) && realpathSync(manifestPath) !== manifestPath)
      throw Error("symlink in frozen manifest");
    const manifest = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, "utf8"))
      : undefined;
    if (
      manifest !== undefined &&
      (manifest === null || typeof manifest.name !== "string")
    )
      throw Error("invalid frozen manifest export owner");
    const name: string =
      manifest === undefined ? (names.get(id) ?? "@tint/" + id) : manifest.name;
    if (seenNames.has(name) || (names.has(id) && names.get(id) !== name))
      throw Error("inconsistent frozen package name");
    seenNames.add(name);
    const incoming = imported.get(id) ?? new Map<string, string>();
    const reconstructed: Record<string, { types: string; import: string }> = {};
    for (const [specifier, target] of incoming) {
      const key = specifier === name ? "." : "." + specifier.slice(name.length);
      const stem = target.slice((directory + "/src/").length, -3);
      reconstructed[key] = {
        types: "./dist/" + stem + ".d.ts",
        import: "./dist/" + stem + ".js",
      };
    }
    if (
      manifest === undefined &&
      !Object.hasOwn(reconstructed, ".") &&
      paths.includes(directory + "/src/index.ts")
    )
      reconstructed["."] = {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      };
    // Source-only merged compiler snapshots have no incoming package grants:
    // their public roles are the finite compiler format, not arbitrary files.
    if (
      manifest === undefined &&
      id === "compiler" &&
      catalogOwner === "compiler"
    ) {
      for (const [role, stem] of [
        ["native", "native/index"],
        ["build", "build"],
        ["project", "project"],
        ["catalog", "catalog"],
        ["cli", "cli"],
      ] as const) {
        if (byFile.get(directory + "/src/" + stem + ".ts") !== id)
          throw Error("missing owned frozen compiler role: " + role);
        const key = "./" + role;
        if (
          Object.hasOwn(reconstructed, key) &&
          reconstructed[key]?.import !== "./dist/" + stem + ".js"
        )
          throw Error("inconsistent frozen compiler role target: " + role);
        reconstructed[key] = {
          types: "./dist/" + stem + ".d.ts",
          import: "./dist/" + stem + ".js",
        };
      }
    }
    // A package with no incoming grant and no historical root stays inaccessible.
    const publicEntries =
      manifest === undefined && Object.keys(reconstructed).length === 0
        ? []
        : compiledPackageExports(
            name,
            directory,
            manifest === undefined ? reconstructed : manifest.exports,
            paths,
          );
    const exports: Record<string, string> = {};
    for (const entry of publicEntries) {
      const key =
        entry.specifier === name
          ? "."
          : "." + entry.specifier.slice(name.length);
      exports[key] = "./" + entry.source.slice((directory + "/").length);
    }
    for (const [specifier, target] of incoming) {
      const key = specifier === name ? "." : "." + specifier.slice(name.length);
      if (exports[key] !== "./" + target.slice((directory + "/").length))
        throw Error("frozen manifest/catalog export drift");
    }
    result.push({ id, name, exports });
  }
  return result;
}

import ts from "typescript";
import {
  compiledPackageExports,
  type PublicPackageExport,
} from "./package-exports.ts";
import { posix } from "node:path";
export interface SourceFile {
  readonly path: string;
  readonly text: string;
}
export interface PackageContract {
  readonly name: string;
  readonly directory: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly references: readonly string[];
  readonly sources: readonly SourceFile[];
  /** Explicit manifest exports; omission preserves existing root-only fixtures. */
  readonly exports?: unknown;
}
/** The module a C binding declaration file declares (docs/native-ffi.md):
 * a `src/c/*.d.ts` whose only top-level statement is
 * `declare module "tint:c/<library>"`, `declare module "tint:ffi"` or
 * `declare module "tint:ffi/collected"`. These
 * files are the trusted contract for their ambient declarations; the
 * compiler expands `tint:c/` modules into generated implementations. */
export function foreignBindingModule(
  directory: string,
  source: SourceFile,
): string | undefined {
  if (
    !source.path.startsWith(`${directory}/src/c/`) ||
    !source.path.endsWith(".d.ts")
  )
    return undefined;
  const file = ts.createSourceFile(
    source.path,
    source.text,
    ts.ScriptTarget.Latest,
    true,
  );
  const [statement] = file.statements;
  if (
    file.statements.length !== 1 ||
    statement === undefined ||
    !ts.isModuleDeclaration(statement) ||
    !ts.isStringLiteral(statement.name)
  )
    return undefined;
  const name = statement.name.text;
  return name === "tint:ffi" ||
    name === "tint:ffi/collected" ||
    (name.startsWith("tint:c/") && /^[a-z0-9-]+$/.test(name.slice(7)))
    ? name
    : undefined;
}
export function checkBoundaries(
  packages: readonly PackageContract[],
  allowed: Readonly<Record<string, readonly string[]>>,
): string[] {
  const errors: string[] = [];
  const byName = new Map(packages.map((p) => [p.name, p]));
  if (byName.size !== packages.length) errors.push("duplicate package name");
  const exportsByName = new Map<string, readonly PublicPackageExport[]>();
  for (const pkg of packages) {
    try {
      const exported = Object.hasOwn(pkg, "exports")
        ? pkg.exports
        : { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } };
      exportsByName.set(
        pkg.name,
        compiledPackageExports(
          pkg.name,
          pkg.directory,
          exported,
          pkg.sources.map((source) => source.path),
        ),
      );
    } catch (error) {
      errors.push(String(error));
    }
  }
  for (const name of Object.keys(allowed))
    if (!byName.has(name)) errors.push(`missing contracted package ${name}`);
  for (const pkg of packages) {
    const expected = allowed[pkg.name];
    if (expected === undefined) errors.push(`uncontracted package ${pkg.name}`);
    const deps = Object.keys(pkg.dependencies);
    if (
      JSON.stringify([...deps].sort()) !==
      JSON.stringify([...(expected ?? [])].sort())
    )
      errors.push(`${pkg.name}: dependencies differ from approved contract`);
    for (const dep of deps) {
      if (!byName.has(dep) || pkg.dependencies[dep] !== "workspace:*")
        errors.push(
          `${pkg.name}: dependency must be a workspace contract: ${dep}`,
        );
    }
    const expectedRefs = deps.map((d) => byName.get(d)?.directory).sort();
    const refs = pkg.references
      .map((r) => posix.normalize(posix.join(pkg.directory, r)))
      .sort();
    if (JSON.stringify(refs) !== JSON.stringify(expectedRefs))
      errors.push(`${pkg.name}: project references differ from dependencies`);
    const publicImports = new Set<string>();
    for (const dep of deps) {
      const dependency = byName.get(dep);
      if (dependency === undefined) continue;
      for (const entry of exportsByName.get(dep) ?? [])
        publicImports.add(entry.specifier);
    }
    const paths = new Set(pkg.sources.map((s) => s.path));
    const sourceRoot = `${pkg.directory}/src/`;
    // A package's own C binding modules are importable inside it.
    const bindings = new Set<string>();
    for (const source of pkg.sources) {
      const binding = foreignBindingModule(pkg.directory, source);
      if (binding !== undefined && binding.startsWith("tint:c/"))
        bindings.add(binding);
    }
    for (const source of pkg.sources) {
      const report = (message: string) => {
        errors.push(`${source.path}: ${message}`);
      };
      const binding = foreignBindingModule(pkg.directory, source);
      const checkImport = (specifier: string) => {
        if (specifier.startsWith(".")) {
          const resolved = posix.normalize(
            posix.join(posix.dirname(source.path), specifier),
          );
          if (
            !resolved.startsWith(sourceRoot) ||
            !specifier.endsWith(".ts") ||
            !paths.has(resolved)
          )
            report(
              `relative import must resolve inside package src: ${specifier}`,
            );
        } else if (binding !== undefined) {
          if (specifier !== "tint:ffi")
            report(`binding declarations import only tint:ffi: ${specifier}`);
        } else if (!publicImports.has(specifier) && !bindings.has(specifier))
          report(
            `import must use a declared public package entrypoint: ${specifier}`,
          );
      };
      const pre = ts.preProcessFile(source.text);
      if (
        pre.referencedFiles.length ||
        pre.typeReferenceDirectives.length ||
        pre.libReferenceDirectives.length
      )
        report("triple-slash references are not portable package contracts");
      if (/@ts-(?:ignore|expect-error|nocheck)/.test(source.text))
        report("typechecking suppression is not permitted in portable source");
      const file = ts.createSourceFile(
        source.path,
        source.text,
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
            checkImport(node.moduleSpecifier.text);
        }
        if (
          ts.isImportTypeNode(node) &&
          ts.isLiteralTypeNode(node.argument) &&
          ts.isStringLiteral(node.argument.literal)
        )
          checkImport(node.argument.literal.text);
        if (ts.isImportEqualsDeclaration(node))
          report("import-equals is outside the portable source contract");
        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              node.expression.text === "require"))
        )
          report(
            "dynamic imports/require are outside the portable source contract",
          );
        if (
          ts.isAsExpression(node) ||
          ts.isTypeAssertionExpression(node) ||
          ts.isNonNullExpression(node) ||
          node.kind === ts.SyntaxKind.AnyKeyword
        )
          report(
            "unchecked type escape is outside the portable source contract",
          );
        if (
          node.kind === ts.SyntaxKind.DeclareKeyword &&
          (binding === undefined || node.parent !== file.statements[0])
        )
          report("ambient declarations require a separate trusted contract");
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }
  const active = new Set<string>(),
    done = new Set<string>();
  const walk = (name: string): void => {
    if (active.has(name)) {
      errors.push(`dependency cycle at ${name}`);
      return;
    }
    if (done.has(name)) return;
    active.add(name);
    for (const dep of Object.keys(byName.get(name)?.dependencies ?? {}))
      walk(dep);
    active.delete(name);
    done.add(name);
  };
  for (const pkg of packages) walk(pkg.name);
  return errors;
}

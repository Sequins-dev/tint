/** One explicit compiled entrypoint and the owned source used by the native graph. */
export interface PublicPackageExport {
  readonly specifier: string;
  readonly source: string;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function segments(path: string): boolean {
  return path
    .split("/")
    .every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        /^[A-Za-z0-9_.-]+$/.test(part),
    );
}
/** Portable packages expose exact ESM/type pairs, never conditional alternatives
 * or source files. Missing outputs are fine before building; sources must exist. */
export function compiledPackageExports(
  name: string,
  directory: string,
  exports: unknown,
  sourcePaths: readonly string[],
): readonly PublicPackageExport[] {
  if (typeof name !== "string")
    throw Error(`${directory}: invalid public export package name`);
  const owner = name.startsWith("@") ? name.slice(1) : name;
  if (
    !segments(owner) ||
    owner.split("/").length !== (name.startsWith("@") ? 2 : 1)
  )
    throw Error(`${directory}: invalid public export package name`);
  if (!record(exports) || Object.keys(exports).length === 0)
    throw Error(`${directory}: explicit compiled public exports are required`);
  const paths = new Set(sourcePaths),
    result: PublicPackageExport[] = [];
  for (const [key, target] of Object.entries(exports)) {
    if (key !== "." && (!key.startsWith("./") || !segments(key.slice(2))))
      throw Error(`${directory}: invalid explicit public export: ${key}`);
    if (
      !record(target) ||
      Object.keys(target).length !== 2 ||
      !Object.keys(target).every(
        (key) => key === "import" || key === "types",
      ) ||
      typeof target.import !== "string" ||
      typeof target.types !== "string"
    )
      throw Error(
        `${directory}: export ${key} requires only matching import/types entrypoints`,
      );
    const imported = target.import;
    if (!imported.startsWith("./dist/") || !imported.endsWith(".js"))
      throw Error(
        `${directory}: export ${key} must use a compiled ./dist/*.js entrypoint`,
      );
    const stem = imported.slice("./dist/".length, -".js".length);
    if (!segments(stem) || target.types !== `./dist/${stem}.d.ts`)
      throw Error(
        `${directory}: export ${key} has invalid or mismatched compiled entrypoints`,
      );
    const source = `${directory}/src/${stem}.ts`;
    if (!paths.has(source))
      throw Error(`${directory}: export ${key} source is missing: ${source}`);
    result.push({
      specifier: key === "." ? name : name + key.slice(1),
      source,
    });
  }
  return result;
}

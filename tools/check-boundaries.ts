import { readdir, readFile } from "node:fs/promises";
import {
  checkBoundaries,
  type PackageContract,
  type SourceFile,
} from "./boundaries.ts";

async function sources(directory: string): Promise<SourceFile[]> {
  const result: SourceFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink())
      throw new Error(`symlink in portable source: ${path}`);
    if (entry.isDirectory()) result.push(...(await sources(path)));
    else if (entry.name.endsWith(".ts"))
      result.push({ path, text: await readFile(path, "utf8") });
    else throw new Error(`untracked source kind: ${path}`);
  }
  return result;
}
const packages: PackageContract[] = [];
for (const entry of await readdir("packages", { withFileTypes: true })) {
  if (!entry.isDirectory())
    throw new Error(`unexpected workspace entry: ${entry.name}`);
  const directory = `packages/${entry.name}`;
  const manifest = JSON.parse(
    await readFile(`${directory}/package.json`, "utf8"),
  );
  const config = JSON.parse(
    await readFile(`${directory}/tsconfig.json`, "utf8"),
  );
  if (
    manifest.devDependencies ||
    manifest.peerDependencies ||
    manifest.optionalDependencies ||
    manifest.imports
  )
    throw new Error(
      `${directory}: dependency categories need an explicit contract`,
    );
  const sourceFiles = await sources(`${directory}/src`);
  packages.push({
    name: manifest.name,
    directory,
    dependencies: manifest.dependencies ?? {},
    references: (config.references ?? []).map((r: { path: string }) => r.path),
    sources: sourceFiles,
    exports: manifest.exports,
  });
}
const policy = JSON.parse(await readFile("workspace-contracts.json", "utf8"));
const errors = checkBoundaries(packages, policy);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Verified public imports, dependency contracts and acyclic graph for ${packages.length} portable packages.`,
  );

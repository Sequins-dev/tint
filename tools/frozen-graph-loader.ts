import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  frozenSourcePackageExports,
  type FrozenSourcePackage,
} from "./frozen-source-exports.ts";
/** Select a loader role from captured public exports, never live files or versions. */
export function capturedGraphLoader(packages: readonly FrozenSourcePackage[]) {
  for (const candidate of [
    { name: "@tint/typescript", key: "./modules" },
    { name: "@tint/module-loader", key: "." },
  ]) {
    const provider = packages.find((item) => item.name === candidate.name);
    if (
      provider !== undefined &&
      Object.hasOwn(provider.exports, candidate.key)
    )
      return {
        packageId: provider.id,
        specifier:
          candidate.key === "."
            ? candidate.name
            : candidate.name + candidate.key.slice(1),
        key: candidate.key,
      };
  }
  throw Error("captured toolchain has no public source graph loader export");
}
export function frozenGraphLoaderURL(directory: string): string {
  const selected = capturedGraphLoader(frozenSourcePackageExports(directory));
  const manifest = JSON.parse(
    readFileSync(
      join(directory, "packages", selected.packageId, "package.json"),
      "utf8",
    ),
  );
  // frozenSourcePackageExports already validates matching compiled import/types
  // pairs and their source ownership before any target is supplied to import().
  return pathToFileURL(
    join(
      directory,
      "packages",
      selected.packageId,
      manifest.exports[selected.key].import,
    ),
  ).href;
}

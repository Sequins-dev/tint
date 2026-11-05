import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  frozenSourcePackageExports,
  type FrozenSourcePackage,
} from "./frozen-source-exports.ts";

export type CompilerRole = "native" | "build" | "project" | "catalog" | "cli";

/** Select public compiler contracts from captured metadata, never the live workspace. */
export function capturedCompilerRole(
  packages: readonly FrozenSourcePackage[],
  role: CompilerRole,
) {
  const historical =
    role === "native"
      ? "native-compiler"
      : role === "build"
        ? "compiler-driver"
        : "compiler-cli";
  const candidates = packages.flatMap((provider) => {
    const key =
      provider.name === "@tint/compiler"
        ? "./" + role
        : provider.name === "@tint/" + historical
          ? "."
          : undefined;
    if (key === undefined || !Object.hasOwn(provider.exports, key)) return [];
    const source = provider.exports[key];
    if (
      !/^[a-z0-9][a-z0-9-]*$/.test(provider.id) ||
      source === undefined ||
      !/^\.\/src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.ts$/.test(source)
    )
      throw Error("invalid captured compiler role ownership: " + role);
    return [
      {
        packageId: provider.id,
        key,
        specifier: key === "." ? provider.name : provider.name + key.slice(1),
        source: "packages/" + provider.id + "/" + source.slice(2),
      },
    ];
  });
  if (candidates.length !== 1)
    throw Error(
      (candidates.length === 0 ? "missing" : "ambiguous") +
        " captured compiler role: " +
        role,
    );
  return candidates[0]!;
}

export function frozenCompilerRoleURL(
  directory: string,
  role: CompilerRole,
): string {
  const selected = capturedCompilerRole(
    frozenSourcePackageExports(directory),
    role,
  );
  const manifest = JSON.parse(
    readFileSync(
      join(directory, "packages", selected.packageId, "package.json"),
      "utf8",
    ),
  );
  return pathToFileURL(
    join(
      directory,
      "packages",
      selected.packageId,
      manifest.exports[selected.key].import,
    ),
  ).href;
}

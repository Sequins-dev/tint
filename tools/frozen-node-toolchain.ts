import { createHash } from "node:crypto";
import { compiledPackageExports } from "./package-exports.ts";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  symlinkSync,
  readlinkSync,
  existsSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  saveWorkspaceSourceSnapshot,
  workspaceSourceIdentity,
  type WorkspaceSourceSnapshot,
} from "./workspace-sources.ts";
export interface FrozenNodeToolchain {
  readonly directory: string;
  readonly entry: string;
  readonly manifest: string;
  readonly sources: string;
  readonly sha256: string;
}
/** Freeze the actual compiled Node packages as well as their source provenance.
 * Call after building the workspace. Native graph snapshots alone do not freeze
 * the Node scanner/lowerer used to prepare later selections. */
export function freezeNodeToolchain(
  snapshot: WorkspaceSourceSnapshot,
  directory: string,
  options: { readonly workspaceRoot?: string; readonly entry?: string } = {},
): FrozenNodeToolchain {
  const root = resolve(options.workspaceRoot ?? "."),
    target = resolve(directory),
    entry = options.entry ?? "tools/test262-native-run.ts";
  if (!entry.startsWith("tools/") || entry.split("/").includes(".."))
    throw Error("invalid frozen tool entry");
  if (
    target === join(root, "tools") ||
    target.startsWith(join(root, "tools") + sep)
  )
    throw Error("cannot freeze tools into their own source directory");
  const packages = [
    ...new Set(snapshot.inputs.map((input) => input.packageId)),
  ].sort();
  for (const id of packages)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
      throw Error("invalid frozen package identity");
  function checkSources(): void {
    for (const input of snapshot.inputs) {
      if (
        !input.id.startsWith("packages/" + input.packageId + "/src/") ||
        input.id.split("/").includes("..")
      )
        throw Error("invalid frozen source path");
      if (!readFileSync(join(root, input.id)).equals(input.bytes))
        throw Error("workspace differs from frozen sources: " + input.id);
    }
    if (snapshot.publicEntries !== undefined) {
      const actual = packages.flatMap((id) => {
        const manifest = JSON.parse(
          readFileSync(join(root, "packages", id, "package.json"), "utf8"),
        );
        return compiledPackageExports(
          manifest.name,
          "packages/" + id,
          manifest.exports,
          snapshot.inputs
            .filter((input) => input.packageId === id)
            .map((input) => input.id),
        ).map((entry) => ({
          specifier: entry.specifier,
          target: entry.source,
        }));
      });
      const order = (a: { specifier: string }, b: { specifier: string }) =>
        a.specifier < b.specifier ? -1 : a.specifier > b.specifier ? 1 : 0;
      actual.sort(order);
      if (
        JSON.stringify(actual) !==
        JSON.stringify(snapshot.publicEntries.slice().sort(order))
      )
        throw Error(
          "Public export metadata differs from captured source snapshot",
        );
    }
  }
  checkSources();
  mkdirSync(dirname(target), { recursive: true });
  mkdirSync(target);
  cpSync(join(root, "tools"), join(target, "tools"), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  cpSync(join(root, "package.json"), join(target, "package.json"), {
    errorOnExist: true,
    force: false,
  });
  if (existsSync(join(root, "pnpm-lock.yaml")))
    cpSync(join(root, "pnpm-lock.yaml"), join(target, "pnpm-lock.yaml"), {
      errorOnExist: true,
      force: false,
    });
  mkdirSync(join(target, "node_modules/@tint"), { recursive: true });
  for (const id of packages) {
    const folder = join(target, "packages", id);
    mkdirSync(folder, { recursive: true });
    cpSync(
      join(root, "packages", id, "package.json"),
      join(folder, "package.json"),
      { errorOnExist: true, force: false },
    );
    cpSync(join(root, "packages", id, "dist"), join(folder, "dist"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const link = join(target, "node_modules/@tint", id);
    symlinkSync(
      process.platform === "win32" ? folder : relative(dirname(link), folder),
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  for (const input of snapshot.inputs) {
    const path = join(target, input.id);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, input.bytes, { flag: "wx" });
  }
  if (!existsSync(join(target, entry)))
    throw Error("missing frozen tool entry: " + entry);
  const sources = join(target, "source-snapshot.json");
  saveWorkspaceSourceSnapshot(sources, snapshot);
  checkSources();
  const files: { path: string; sha256: string; bytes: number }[] = [],
    links: { path: string; target: string }[] = [];
  function collect(folder: string): void {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, item.name),
        id = relative(target, path).split(sep).join("/");
      if (item.isSymbolicLink())
        links.push({ path: id, target: readlinkSync(path) });
      else if (item.isDirectory()) collect(path);
      else if (item.isFile()) {
        const bytes = readFileSync(path);
        files.push({
          path: id,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
        });
      }
    }
  }
  collect(target);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  links.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const payload = {
    schemaVersion: 1,
    nodeVersion: process.version,
    sourceSnapshot: workspaceSourceIdentity(snapshot),
    files,
    links,
  };
  const sha256 = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex"),
    manifest = join(target, "toolchain.json");
  writeFileSync(
    manifest,
    JSON.stringify({ ...payload, sha256 }, null, 2) + "\n",
    { flag: "wx" },
  );
  return {
    directory: target,
    entry: join(target, entry),
    manifest,
    sources,
    sha256,
  };
}

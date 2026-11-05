import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, basename, sep } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
export function within(root: string, path: string): string {
  const full = resolve(root, path),
    local = relative(root, full);
  if (local === ".." || local.startsWith(`..${sep}`))
    throw new Error("path must remain within the Test262 directory");
  return full;
}
function files(path: string): string[] {
  if (!statSync(path).isDirectory())
    return path.endsWith(".js") && !basename(path).includes("_FIXTURE")
      ? [path]
      : [];
  return readdirSync(path)
    .sort()
    .flatMap((entry) => files(resolve(path, entry)));
}
export function test262Checkout(checkout: string, selection: string) {
  const root = resolve(checkout),
    tests = resolve(root, "test"),
    selected = within(tests, selection);
  const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const dirty =
    execFileSync(
      "git",
      ["-C", root, "status", "--porcelain", "--untracked-files=no"],
      { encoding: "utf8" },
    ).trim() !== "";
  return {
    root,
    revision,
    dirty,
    selection,
    files: files(selected).map((filename) => ({
      filename,
      path: relative(tests, filename).split(sep).join("/"),
    })),
  };
}
export function test262Source(filename: string) {
  const bytes = readFileSync(filename);
  return {
    source: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    ),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

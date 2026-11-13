// Code-quality benchmark on a fixed workload: the compiler source frozen at
// one commit, compiled by the current toolchain, compiling that same frozen
// source. The work performed never changes, so differences between builds
// measure only the generated code; Node runs the identical frozen program.
// (The evolving self-compile also measures the compiler's own growing work.)
//
//   node tools/frozen-workload.ts freeze <name>
//       Snapshot the current sources and Node toolchain (run `pnpm build`
//       first) into .tint-bootstrap/workload-<name>.
//   node tools/frozen-workload.ts build <name> <label> [--runtime-tree]
//       Build the frozen program with the current toolchain:
//       .tint-bootstrap/workload-<name>/native-<label>. --runtime-tree links
//       the tree's native runtime (collector) into the frozen program instead
//       of the snapshot's, so runtime changes are measured; the program's
//       input, and so its output, stays the frozen snapshot. Only files the
//       snapshot already has are replaced (refreeze for new runtime files).
//       --tree <dir> (repeatable) does the same for another source directory,
//       e.g. packages/foundation/src/collections for built-in collections.
//   node tools/frozen-workload.ts run <name> <label>... [--rounds N]
//       Interleaved timed runs (TZ=UTC): wall, cycles, instructions, RSS.
//   node tools/frozen-workload.ts node <name> [--rounds N]
//       The same frozen program under Node (frozen toolchain).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { workspaceSources } from "./workspace-sources.ts";
import { freezeNodeToolchain } from "./frozen-node-toolchain.ts";

const root = resolve(".tint-bootstrap");
const [command, name, ...rest] = process.argv.slice(2);
if (command === undefined || name === undefined)
  throw Error("usage: frozen-workload.ts freeze|build|run|node <name> ...");
const workload = join(root, "workload-" + name),
  source = join(workload, "source"),
  toolchain = join(workload, "toolchain");
const environment = { ...process.env, TZ: "UTC" };
function rounds(): number {
  const at = rest.indexOf("--rounds");
  return at < 0 ? 2 : Number(rest[at + 1] ?? "2");
}
/** Positional arguments: not flags, nor the values of --rounds and --tree. */
function labels(): string[] {
  return rest.filter(
    (item, i) =>
      !item.startsWith("--") &&
      rest[i - 1] !== "--rounds" &&
      rest[i - 1] !== "--tree",
  );
}
function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: environment,
  });
  if (result.status !== 0)
    throw Error(command + " " + args.join(" ") + " exited " + result.status);
}
/** /usr/bin/time -l counters for one run, from a clean output path. */
function timed(label: string, args: (output: string) => string[]): void {
  const output = join(workload, "out-" + label);
  rmSync(output, { recursive: true, force: true });
  const result = spawnSync("/usr/bin/time", ["-l", ...args(output)], {
    encoding: "utf8",
    env: environment,
  });
  if (result.status !== 0)
    throw Error(label + " failed:\n" + result.stderr.slice(-2000));
  const text = result.stderr;
  const pick = (pattern: RegExp): string =>
    (pattern.exec(text)?.[1] ?? "?").trim();
  console.log(
    `${label.padEnd(12)} ${pick(/([\d.]+) real/)} s  ${pick(/(\d+)\s+cycles elapsed/)} cycles  ${pick(/(\d+)\s+instructions retired/)} instructions  ${pick(/(\d+)\s+maximum resident/)} RSS`,
  );
}

if (command === "freeze") {
  if (existsSync(workload)) throw Error(workload + " already exists");
  mkdirSync(workload, { recursive: true });
  freezeNodeToolchain(workspaceSources(), toolchain);
  // The bootstrap writes the source snapshot the native program compiles.
  run(process.execPath, [
    "tools/bootstrap-compiler.ts",
    join(workload, "native-initial"),
    "--snapshot",
    source,
  ]);
} else if (command === "build") {
  const label = labels()[0];
  if (label === undefined) throw Error("build needs a label");
  let root = source;
  const trees: string[] = [];
  if (rest.includes("--runtime-tree"))
    trees.push("packages/native-runtime/src");
  for (let index = 0; index < rest.length; index++)
    if (rest[index] === "--tree") {
      const directory = rest[index + 1];
      if (directory === undefined) throw Error("--tree needs a directory");
      trees.push(directory);
    }
  if (trees.length > 0) {
    root = join(workload, "source-" + label);
    rmSync(root, { recursive: true, force: true });
    cpSync(source, root, { recursive: true });
  }
  for (const directory of trees) {
    // Replace only files the snapshot has: its catalog is compiled into the
    // program and also selects the program's input files, so it must not
    // change. A change that adds files needs a fresh freeze.
    const snapshot = join(root, directory),
      tree = resolve(directory);
    for (const file of readdirSync(snapshot, {
      recursive: true,
      encoding: "utf8",
    }) as string[]) {
      if (!file.endsWith(".ts") || !existsSync(join(tree, file))) continue;
      cpSync(join(tree, file), join(snapshot, file));
    }
  }
  run(process.execPath, [
    "tools/bootstrap-compiler.ts",
    join(workload, "native-" + label),
    "--source-root",
    root,
    "--debug-symbols",
  ]);
} else if (command === "run") {
  for (let round = 0; round < rounds(); round++)
    for (const label of labels())
      timed(label, (output) => [
        join(workload, "native-" + label),
        source,
        output,
      ]);
} else if (command === "node") {
  for (let round = 0; round < rounds(); round++)
    timed("node", (output) => [
      process.execPath,
      join(toolchain, "tools/bootstrap-compiler.ts"),
      output,
      "--source-root",
      source,
    ]);
} else throw Error("unknown command " + command);

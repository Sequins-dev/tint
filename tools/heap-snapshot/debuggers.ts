// Batch drivers for the debugger adapters of the heap tools: LLDB with
// tools/lldb/tint.py and GDB with tools/gdb/tint.py, both thin adapters of
// the debugger-neutral tools/debugger/tint_heap.py. Each driver runs a list
// of debugger commands in batch mode and fails on the first failed command;
// the `tint-heap` commands are the same in both, the surrounding process
// control is spelled per debugger.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const lldbModule = fileURLToPath(
  new URL("../lldb/tint.py", import.meta.url),
);
export const gdbModule = fileURLToPath(
  new URL("../gdb/tint.py", import.meta.url),
);

export type DebuggerName = "lldb" | "gdb";

/** Shell-style single quoting (LLDB and GDB program arguments). */
export function quote(text: string): string {
  return "'" + text.replaceAll("'", "'\\''") + "'";
}

/** Runs LLDB in batch mode with the tint module; fails on a failed command. */
export function runLldb(
  image: string | undefined,
  commands: readonly string[],
  extra: readonly string[] = [],
): string {
  const args = [
    "--no-lldbinit",
    "--batch",
    "-o",
    "command script import " + lldbModule,
  ];
  for (const command of commands) args.push("-o", command);
  args.push(...extra);
  if (image !== undefined) args.push(image);
  const result = spawnSync("lldb", args, {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (result.error !== undefined) throw result.error;
  const output = result.stdout + result.stderr;
  if (result.status !== 0 || /\berror: /.test(output))
    throw Error("lldb failed:\n" + output.slice(-4000));
  return output;
}

/** Runs GDB in batch mode with the tint module. The commands go through a
 * command file, which GDB abandons at the first error (exit status 1). */
export function runGdb(
  image: string | undefined,
  commands: readonly string[],
  extra: readonly string[] = [],
): string {
  const directory = mkdtempSync(join(tmpdir(), "tint-gdb-"));
  try {
    const script = join(directory, "commands.gdb");
    writeFileSync(
      script,
      [
        "set pagination off",
        "set confirm off",
        "set width 0",
        "source " + gdbModule,
        ...commands,
      ].join("\n") + "\n",
    );
    const args = ["-q", "-batch", "-nx", "-x", script];
    if (image !== undefined) args.push(image);
    args.push(...extra);
    const result = spawnSync("gdb", args, {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
    if (result.error !== undefined) throw result.error;
    const output = result.stdout + result.stderr;
    if (
      result.status !== 0 ||
      /Error in sourced command file|Python Exception|Error while executing Python code/.test(
        output,
      )
    )
      throw Error("gdb failed:\n" + output.slice(-4000));
    return output;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Process control around the `tint-heap` commands, per debugger. */
export interface HeapDebugger {
  readonly name: DebuggerName;
  /** Runs the commands against an image (and `extra` arguments). */
  run(
    image: string | undefined,
    commands: readonly string[],
    extra?: readonly string[],
  ): string;
  /** Launches, stopped at the first instruction. */
  launchAtEntry(args?: readonly string[]): string;
  /** Launches and runs to the first breakpoint (or exit). */
  readonly launch: string;
  readonly resume: string;
  readonly kill: string;
  readonly detach: string;
  readonly deleteBreakpoints: string;
  attach(pid: string): string;
  breakAtLine(file: string, line: number): string;
  /** A breakpoint on a symbol's first instruction. */
  breakAtSymbol(name: string): string;
  /** One line of Python in the debugger's embedded interpreter. */
  python(code: string): string;
  /** Python expressions: whether the process is stopped, the innermost
   * frame's function name, the PC, a symbol's load address, a local's
   * number value. */
  readonly stoppedExpression: string;
  readonly functionExpression: string;
  readonly pcExpression: string;
  symbolExpression(name: string): string;
  localNumberExpression(name: string): string;
  /** Asserts the process exited with the status. */
  assertExit(status: number): string;
  /** Writes a core file of the stopped process holding its heap. */
  saveCore(path: string): string;
  /** Arguments loading a core file with the image. */
  coreArguments(core: string): string[];
}

export const lldb: HeapDebugger = {
  name: "lldb",
  run: runLldb,
  launchAtEntry: (args = []) =>
    "process launch --stop-at-entry" +
    (args.length > 0 ? " -- " + args.map(quote).join(" ") : ""),
  launch: "process launch",
  resume: "continue",
  kill: "process kill",
  detach: "process detach",
  deleteBreakpoints: "breakpoint delete --force",
  attach: (pid) => "process attach --pid " + pid,
  breakAtLine: (file, line) =>
    "breakpoint set --file " + file + " --line " + String(line),
  breakAtSymbol: (name) => "breakpoint set --name " + name,
  python: (code) => "script " + code,
  stoppedExpression: "lldb.process.GetState() == lldb.eStateStopped",
  functionExpression: "lldb.thread.GetFrameAtIndex(0).GetFunctionName()",
  pcExpression: "lldb.thread.GetFrameAtIndex(0).GetPC()",
  symbolExpression: (name) =>
    "lldb.target.FindSymbols('" +
    name +
    "').GetContextAtIndex(0).GetSymbol().GetStartAddress().GetLoadAddress(lldb.target)",
  localNumberExpression: (name) =>
    "float(lldb.frame.FindVariable('" + name + "').GetValue())",
  assertExit: (status) =>
    "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == " +
    String(status) +
    ", lldb.process.GetExitStatus()",
  // Linux LLDB writes a minidump holding only stacks unless asked for
  // every region.
  saveCore: (path) =>
    "process save-core " +
    (process.platform === "linux" ? "--style full " : "") +
    path,
  coreArguments: (core) => ["-c", core],
};

export const gdb: HeapDebugger = {
  name: "gdb",
  run: runGdb,
  launchAtEntry: (args = []) =>
    "starti" + (args.length > 0 ? " " + args.map(quote).join(" ") : ""),
  launch: "run",
  resume: "continue",
  kill: "kill",
  detach: "detach",
  deleteBreakpoints: "delete",
  attach: (pid) => "attach " + pid,
  breakAtLine: (file, line) => "break " + file + ":" + String(line),
  breakAtSymbol: (name) => "break *'" + name + "'",
  python: (code) => "python " + code,
  stoppedExpression:
    "gdb.selected_inferior().pid != 0 and gdb.selected_thread().is_stopped()",
  functionExpression: "gdb.newest_frame().name()",
  pcExpression: "gdb.newest_frame().pc()",
  symbolExpression: (name) =>
    "int(gdb.parse_and_eval(\"(unsigned long)&'" + name + "'\"))",
  localNumberExpression: (name) =>
    "float(gdb.selected_frame().read_var('" + name + "'))",
  assertExit: (status) =>
    "python assert gdb.selected_inferior().pid == 0 and gdb.convenience_variable('_exitcode') == " +
    String(status) +
    ", gdb.convenience_variable('_exitcode')",
  saveCore: (path) => "gcore " + path,
  coreArguments: (core) => [core],
};

export function heapDebugger(name: string | undefined): HeapDebugger {
  if (name === undefined || name === "lldb") return lldb;
  if (name === "gdb") return gdb;
  throw Error("unknown debugger " + name + " (lldb or gdb)");
}

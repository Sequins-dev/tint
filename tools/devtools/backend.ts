// Debug backends: a DAP adapter plus what the bridge needs beyond DAP
// (native debugger commands for source enumeration, symbolisation and
// plugin fast paths). lldb-dap is the default; another adapter (gdb >= 14's
// `gdb -i dap`, or any DAP server) plugs in by implementing DebugBackend.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DapClient } from "./dap-client.ts";
import { findLlvmTool } from "../host-tools.ts";

export interface LaunchRequest {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
}

export interface DebugBackend {
  /** Shown in /json/version and logs. */
  readonly name: string;
  readonly dap: DapClient;
  /** The `launch` request arguments for this adapter. */
  launchArguments(request: LaunchRequest, initCommands: string[]): object;
  /** The `attach` request arguments for this adapter. */
  attachArguments(pid: number, initCommands: string[]): object;
  /** Runs a native debugger command and returns its output (rejecting on
   * a reported error), or is undefined when the adapter has none. */
  readonly command?:
    ((text: string, timeoutMs?: number) => Promise<string>) | undefined;
  /** A command that loads a Python/LLDB script module, for plugins. */
  importScript?(path: string): string;
  /** Lists the source files of the debug info (absolute or as DWARF
   * spells them), when the adapter supports it. */
  sources?(): Promise<string[]>;
  /** Lines with code in a source range, when the adapter lacks DAP's
   * `breakpointLocations`. */
  breakpointLocations?(
    path: string,
    line: number,
    endLine: number,
  ): Promise<{ line: number; column: number }[]>;
  /** Symbolises load addresses: lines innermost first. */
  symbolize?(addresses: readonly number[]): Promise<Map<number, RawLine[]>>;
  /** Before the process starts: arranges for `entered` to report when the
   * program's entry point runs, without a visible stop. False when the
   * executable has no entry point the debugger can watch. */
  watchEntry?(): Promise<boolean>;
  /** Whether the watched entry point has run. */
  entered?(): Promise<boolean>;
  /** The stopped thread's stack as locations (backend sampling). */
  stack?(threadId: number): Promise<{ address: number; lines: RawLine[] }[]>;
  /** Whether the debugger can inspect the stopped process. */
  readonly inspectableStop?: () => Promise<boolean>;
  close(): void;
}

export interface RawLine {
  readonly function?: string | null;
  readonly file?: string | null;
  readonly line?: number | null;
  readonly column?: number | null;
  readonly startLine?: number | null;
}

export const devtoolsLldbModule = fileURLToPath(
  new URL("../lldb/devtools.py", import.meta.url),
);

/** The lldb-dap binary: $LLDB_DAP, then the Xcode toolchain's on macOS
 * (else PATH); on Linux the distribution's, which is versioned on Debian
 * (lldb-dap-19) and called lldb-vscode by older LLVM releases. */
export function findLldbDap(): string | undefined {
  const explicit = process.env.LLDB_DAP;
  if (explicit !== undefined && explicit !== "") return explicit;
  if (process.platform !== "darwin")
    return findLlvmTool("lldb-dap") ?? findLlvmTool("lldb-vscode");
  const found = spawnSync("xcrun", ["-f", "lldb-dap"], { encoding: "utf8" });
  const path = found.stdout?.trim();
  if (found.status === 0 && path !== undefined && existsSync(path)) return path;
  for (const name of ["lldb-dap", "lldb-vscode"]) {
    const found = spawnSync("sh", ["-c", "command -v " + name], {
      encoding: "utf8",
    });
    const path = found.stdout?.trim();
    if (found.status === 0 && path !== undefined && path !== "") return path;
  }
  return undefined;
}

/** The escape that makes lldb-dap's repl evaluate an LLDB command. */
const commandEscape = "`";

function devtoolsJson(output: string): unknown {
  const line = output.split("\n").find((text) => text.startsWith("DEVTOOLS "));
  if (line === undefined) throw Error("no devtools output:\n" + output);
  return JSON.parse(line.slice("DEVTOOLS ".length));
}

export class LldbDapBackend implements DebugBackend {
  readonly name = "lldb-dap";
  readonly dap: DapClient;

  constructor(path = findLldbDap()) {
    if (path === undefined)
      throw Error(
        "lldb-dap not found: install Xcode or LLVM, or set LLDB_DAP to its path",
      );
    this.dap = new DapClient(path, []);
  }

  launchArguments(request: LaunchRequest, initCommands: string[]): object {
    return {
      program: request.program,
      args: request.args,
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(request.env === undefined
        ? {}
        : {
            env: Object.entries(request.env).map(
              ([key, value]) => key + "=" + value,
            ),
          }),
      stopOnEntry: false,
      initCommands: [
        "command script import " + devtoolsLldbModule,
        ...initCommands,
      ],
      commandEscapePrefix: commandEscape,
    };
  }

  attachArguments(pid: number, initCommands: string[]): object {
    return {
      pid,
      initCommands: [
        "command script import " + devtoolsLldbModule,
        ...initCommands,
      ],
      commandEscapePrefix: commandEscape,
    };
  }

  readonly command = async (
    text: string,
    timeoutMs = 600000,
  ): Promise<string> => {
    const body = await this.dap.request<{ result?: string }>(
      "evaluate",
      { expression: commandEscape + text, context: "repl" },
      timeoutMs,
    );
    let result = body.result ?? "";
    // LLVM 19's lldb-dap echoes the command line before its output.
    const echo = "(lldb) " + text + "\n";
    if (result.startsWith(echo)) result = result.slice(echo.length);
    if (/^error: /m.test(result))
      throw Error(text.split(" ").slice(0, 2).join(" ") + ": " + result.trim());
    return result;
  };

  /** Lines (and columns) with code between `line` and `endLine` of a
   * source file, from the line tables: for adapters without the DAP
   * `breakpointLocations` request (lldb-dap before LLVM 20). */
  async breakpointLocations(
    path: string,
    line: number,
    endLine: number,
  ): Promise<{ line: number; column: number }[]> {
    return devtoolsJson(
      await this.command(
        "devtools lines " +
          JSON.stringify(path) +
          " " +
          String(line) +
          " " +
          String(endLine),
      ),
    ) as { line: number; column: number }[];
  }

  importScript(path: string): string {
    return "command script import " + path;
  }

  async sources(): Promise<string[]> {
    const entries = devtoolsJson(await this.command("devtools sources")) as {
      path: string;
    }[];
    return entries.map((entry) => entry.path);
  }

  async symbolize(
    addresses: readonly number[],
  ): Promise<Map<number, RawLine[]>> {
    const result = new Map<number, RawLine[]>();
    const unique = [...new Set(addresses)].filter((address) => address > 0);
    for (let at = 0; at < unique.length; at += 500) {
      const batch = unique.slice(at, at + 500);
      const parsed = devtoolsJson(
        await this.command(
          "devtools symbolize " +
            batch.map((address) => "0x" + address.toString(16)).join(" "),
        ),
      ) as Record<string, RawLine[]>;
      for (const [key, lines] of Object.entries(parsed))
        result.set(Number(key), lines);
    }
    return result;
  }

  async watchEntry(): Promise<boolean> {
    return devtoolsJson(await this.command("devtools watch-entry")) === true;
  }

  async entered(): Promise<boolean> {
    return devtoolsJson(await this.command("devtools entered")) === true;
  }

  readonly inspectableStop = async (): Promise<boolean> =>
    devtoolsJson(await this.command("devtools inspectable-stop", 30000)) ===
    true;

  async stack(
    threadId: number,
  ): Promise<{ address: number; lines: RawLine[] }[]> {
    return devtoolsJson(
      await this.command("devtools stack --thread " + threadId),
    ) as { address: number; lines: RawLine[] }[];
  }

  close(): void {
    this.dap.kill();
  }
}

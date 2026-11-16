// Chrome DevTools for native programs (docs/native-devtools.md): a CDP
// server backed by a DAP debug adapter (lldb-dap by default).
//
//   node tools/devtools/cli.ts [options] <program> [-- <args>...]
//   node tools/devtools/cli.ts [options] --pid <pid>
//
//   --port <n>            CDP/HTTP port (default 9229; 0 picks one)
//   --host <address>      listen address (default 127.0.0.1)
//   --wait                start the program when DevTools connects
//                         (Runtime.runIfWaitingForDebugger), like
//                         node --inspect-brk without the initial pause
//   --plugin <name>       auto (default), tint or none
//   --source-root <dir>   resolve relative debug-info paths (repeatable)
//   --source-map <p>=<f>  read debug-info path p from file f (repeatable)
//   --adapter <path>      the lldb-dap binary (default: xcrun -f lldb-dap,
//                         $LLDB_DAP, then PATH)
//   --trace               log CDP and DAP traffic to stderr
//
// The program needs only debug info (clang -g, or a Tint debug build).
// Nothing DevTools-specific runs inside it: the bridge controls it through
// the OS debugger interface.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LldbDapBackend } from "./backend.ts";
import { Bridge } from "./bridge.ts";
import type { BridgePlugin } from "./plugin.ts";
import { serveDevTools, type DevToolsServer } from "./server.ts";

export interface DevToolsOptions {
  readonly program?: string | undefined;
  readonly args?: readonly string[] | undefined;
  readonly pid?: number | undefined;
  readonly port?: number | undefined;
  readonly host?: string | undefined;
  readonly wait?: boolean | undefined;
  readonly plugins?: readonly BridgePlugin[] | undefined;
  readonly sourceRoots?: readonly string[] | undefined;
  readonly sourceMap?: ReadonlyMap<string, string> | undefined;
  readonly adapter?: string | undefined;
  readonly trace?: boolean | undefined;
  readonly log?: ((text: string) => void) | undefined;
}

export interface DevToolsSession {
  readonly bridge: Bridge;
  readonly server: DevToolsServer;
  close(): Promise<void>;
}

/** Starts the adapter, the bridge and the CDP server. */
export async function startDevTools(
  options: DevToolsOptions,
): Promise<DevToolsSession> {
  const backend = new LldbDapBackend(options.adapter);
  const log = options.log ?? ((text: string) => console.error(text));
  if (options.trace === true)
    backend.dap.trace = (direction, message) =>
      log("dap " + direction + " " + JSON.stringify(message).slice(0, 400));
  const bridge = new Bridge({
    backend,
    ...(options.pid === undefined
      ? {
          launch: {
            program: resolve(options.program ?? ""),
            args: options.args ?? [],
          },
        }
      : { attachPid: options.pid }),
    wait: options.wait,
    sourceRoots: options.sourceRoots,
    sourceMap: options.sourceMap,
    plugins: options.plugins,
    log,
  });
  try {
    await bridge.ready;
  } catch (error) {
    await bridge.close();
    throw error;
  }
  const server = await serveDevTools(bridge, {
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.trace === true
      ? { trace: (line: string) => log("cdp " + line) }
      : {}),
  });
  return {
    bridge,
    server,
    close: async () => {
      await server.close();
      await bridge.close();
    },
  };
}

/** Plugins for a program: `auto` enables the Tint plugin for Tint
 * images (their symbol table names the Tint process entry). */
export async function pluginsFor(
  name: string,
  program: string | undefined,
): Promise<BridgePlugin[]> {
  if (name === "none") return [];
  let tint = name === "tint";
  if (name === "auto" && program !== undefined) {
    try {
      tint = readFileSync(program).includes("tint:process-entry");
    } catch {
      tint = false;
    }
  }
  if (!tint) return [];
  const { TintPlugin } = await import("./tint-plugin.ts");
  return [new TintPlugin()];
}

async function main(argv: string[]): Promise<void> {
  const separator = argv.indexOf("--");
  const own = separator >= 0 ? argv.slice(0, separator) : argv;
  const args = separator >= 0 ? argv.slice(separator + 1) : [];
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  let program: string | undefined;
  for (let index = 0; index < own.length; index++) {
    const arg = own[index] ?? "";
    if (arg === "--wait" || arg === "--trace" || arg === "--help")
      flags.add(arg);
    else if (arg.startsWith("--")) {
      const value = own[++index];
      if (value === undefined) throw Error(arg + " needs a value");
      values.set(arg, [...(values.get(arg) ?? []), value]);
    } else if (program === undefined) program = arg;
    else args.unshift(arg);
  }
  const one = (name: string): string | undefined => values.get(name)?.at(-1);
  const pid = one("--pid");
  if (flags.has("--help") || (program === undefined && pid === undefined)) {
    console.error(
      readFileSync(fileURLToPath(import.meta.url), "utf8")
        .split("\n")
        .filter((line) => line.startsWith("//"))
        .join("\n"),
    );
    process.exitCode = 2;
    return;
  }
  const sourceMap = new Map<string, string>();
  for (const entry of values.get("--source-map") ?? []) {
    const at = entry.lastIndexOf("=");
    if (at <= 0) throw Error("--source-map wants <debug path>=<file>");
    sourceMap.set(entry.slice(0, at), resolve(entry.slice(at + 1)));
  }
  const session = await startDevTools({
    program,
    args,
    pid: pid === undefined ? undefined : Number(pid),
    port: one("--port") === undefined ? undefined : Number(one("--port")),
    host: one("--host"),
    wait: flags.has("--wait"),
    trace: flags.has("--trace"),
    plugins: await pluginsFor(one("--plugin") ?? "auto", program),
    sourceRoots: (values.get("--source-root") ?? []).map((dir) => resolve(dir)),
    sourceMap,
    adapter: one("--adapter"),
  });
  const { server, bridge } = session;
  console.error("DevTools listening on " + server.webSocketUrl);
  console.error("Open " + server.devtoolsUrl);
  console.error(
    "or chrome://inspect (Configure: " +
      server.host +
      ":" +
      String(server.port) +
      ")",
  );
  bridge.backend.dap.on("event:terminated", () =>
    console.error(
      "process exited" +
        (bridge.exitStatus() === undefined
          ? ""
          : " with status " + String(bridge.exitStatus())) +
        "; DevTools stays connected (Ctrl-C to quit)",
    ),
  );
  let closing = false;
  const stop = (): void => {
    if (closing) process.exit(130);
    closing = true;
    void session.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href)
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

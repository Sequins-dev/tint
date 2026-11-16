// The frontend side: HTTP discovery (/json/version, /json/list,
// /json/protocol) so chrome://inspect finds the target, and the CDP
// WebSocket at /<target id>. One frontend at a time; a new connection
// replaces the previous one, as with Node's inspector.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Bridge } from "./bridge.ts";
import {
  acceptWebSocket,
  allowedHost,
  type WebSocketConnection,
} from "./websocket.ts";

export interface DevToolsServer {
  readonly server: Server;
  readonly port: number;
  readonly host: string;
  /** ws://host:port/id */
  readonly webSocketUrl: string;
  /** devtools://devtools/bundled/inspector.html?ws=... */
  readonly devtoolsUrl: string;
  close(): Promise<void>;
}

export async function serveDevTools(
  bridge: Bridge,
  options: {
    port?: number;
    host?: string;
    trace?: (line: string) => void;
  } = {},
): Promise<DevToolsServer> {
  const host = options.host ?? "127.0.0.1";
  let current: WebSocketConnection | undefined;
  const server = createServer((request, response) => {
    if (!allowedHost(request.headers.host)) {
      response.writeHead(403).end("Host header is not allowed\n");
      return;
    }
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const address = request.headers.host ?? host + ":" + String(port);
    const json = (value: unknown): void => {
      const text = JSON.stringify(value, null, 2);
      response.writeHead(200, {
        "Content-Type": "application/json; charset=UTF-8",
        "Content-Length": Buffer.byteLength(text),
      });
      response.end(text);
    };
    if (path === "/json/version") {
      json({
        Browser: "tint-devtools/1.0 (" + bridge.backend.name + ")",
        "Protocol-Version": "1.3",
      });
    } else if (path === "/json" || path === "/json/list") {
      const ws = address + "/" + bridge.targetId;
      json([
        {
          description: "native process (" + bridge.backend.name + ")",
          devtoolsFrontendUrl:
            "devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=" +
            ws,
          devtoolsFrontendUrlCompat:
            "devtools://devtools/bundled/inspector.html?experiments=true&v8only=true&ws=" +
            ws,
          id: bridge.targetId,
          title: bridge.program ?? "native process",
          type: "node",
          url:
            bridge.program === undefined
              ? "native://process/" + String(bridge.pid() ?? "")
              : "file://" + bridge.program,
          webSocketDebuggerUrl: "ws://" + ws,
        },
      ]);
    } else if (path === "/json/protocol") {
      const domains = new Map<string, string[]>();
      for (const method of bridge.methods()) {
        const [domain = "", name = ""] = method.split(".");
        domains.set(domain, [...(domains.get(domain) ?? []), name]);
      }
      json({
        version: { major: "1", minor: "3" },
        domains: [...domains].map(([domain, commands]) => ({
          domain,
          commands: commands.map((name) => ({ name })),
        })),
      });
    } else {
      response.writeHead(404).end("not found\n");
    }
  });
  server.on("upgrade", (request, socket) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    if (path !== "/" + bridge.targetId) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    const connection = acceptWebSocket(request, socket);
    if (connection === undefined) return;
    current?.close();
    current = connection;
    const detach = bridge.connect({
      send: (message) => {
        const text = JSON.stringify(message);
        options.trace?.("<- " + text.slice(0, 400));
        return connection.send(text);
      },
    });
    connection.on("message", (text: string) => {
      options.trace?.("-> " + text.slice(0, 400));
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }
      void bridge.dispatch(message as Parameters<Bridge["dispatch"]>[0]);
    });
    connection.on("close", () => {
      detach();
      if (current === connection) current = undefined;
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 9229, host, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const ws = host + ":" + String(port) + "/" + bridge.targetId;
  return {
    server,
    port,
    host,
    webSocketUrl: "ws://" + ws,
    devtoolsUrl: "devtools://devtools/bundled/inspector.html?ws=" + ws,
    close: () =>
      new Promise<void>((resolve) => {
        current?.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

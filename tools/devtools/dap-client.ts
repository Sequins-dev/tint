// A Debug Adapter Protocol client over a child process's stdio
// (Content-Length framed JSON). Adapter-neutral: lldb-dap, gdb's DAP
// interpreter (`gdb -i dap`) or any other adapter that speaks DAP on stdio.
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export interface DapMessage {
  readonly seq: number;
  readonly type: "request" | "response" | "event";
}
export interface DapResponse extends DapMessage {
  readonly type: "response";
  readonly request_seq: number;
  readonly success: boolean;
  readonly command: string;
  readonly message?: string;
  readonly body?: unknown;
}
export interface DapEvent extends DapMessage {
  readonly type: "event";
  readonly event: string;
  readonly body?: unknown;
}
interface DapReverseRequest extends DapMessage {
  readonly type: "request";
  readonly command: string;
  readonly arguments?: unknown;
}

export class DapError extends Error {
  readonly command: string;
  constructor(command: string, message: string) {
    super(command + ": " + message);
    this.command = command;
  }
}

/** Events: "event" (DapEvent), `event:<name>` (body), "exit" (code),
 * "stderr" (text). */
export class DapClient extends EventEmitter {
  private readonly child: ChildProcess;
  private seq = 1;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<
    number,
    {
      resolve: (body: unknown) => void;
      reject: (error: Error) => void;
      command: string;
    }
  >();
  private exited = false;
  /** Logs every message when set (TINT_DEVTOOLS_TRACE=1). */
  trace: ((direction: "->" | "<-", message: unknown) => void) | undefined;

  constructor(command: string, args: readonly string[]) {
    super();
    this.child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout?.on("data", (chunk: Buffer) => this.receive(chunk));
    this.child.stderr?.on("data", (chunk: Buffer) =>
      this.emit("stderr", chunk.toString("utf8")),
    );
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) => {
      this.exited = true;
      this.fail(new Error("debug adapter exited with " + String(code)));
      this.emit("exit", code);
    });
  }

  get running(): boolean {
    return !this.exited;
  }

  private fail(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const header = this.buffer.subarray(0, end).toString("ascii"),
        match = /Content-Length: *(\d+)/i.exec(header);
      if (match === null) throw Error("DAP header without length: " + header);
      const length = Number(match[1]),
        start = end + 4;
      if (this.buffer.length < start + length) return;
      const text = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);
      this.dispatch(JSON.parse(text) as DapMessage);
    }
  }

  private dispatch(message: DapMessage): void {
    this.trace?.("<-", message);
    if (message.type === "response") {
      const response = message as DapResponse,
        entry = this.pending.get(response.request_seq);
      if (entry === undefined) return;
      this.pending.delete(response.request_seq);
      if (response.success) entry.resolve(response.body ?? {});
      else
        entry.reject(
          new DapError(entry.command, response.message ?? "request failed"),
        );
    } else if (message.type === "event") {
      const event = message as DapEvent;
      this.emit("event", event);
      this.emit("event:" + event.event, event.body ?? {});
    } else {
      // Reverse requests (runInTerminal, startDebugging): unsupported.
      const request = message as DapReverseRequest;
      this.write({
        seq: this.seq++,
        type: "response",
        request_seq: request.seq,
        command: request.command,
        success: false,
        message: "not supported by the DevTools bridge",
      });
    }
  }

  private write(message: object): void {
    this.trace?.("->", message);
    const text = JSON.stringify(message);
    this.child.stdin?.write(
      "Content-Length: " + Buffer.byteLength(text) + "\r\n\r\n" + text,
    );
  }

  request<T = Record<string, unknown>>(
    command: string,
    args?: object,
    timeoutMs = 120000,
  ): Promise<T> {
    if (this.exited)
      return Promise.reject(new DapError(command, "debug adapter exited"));
    const seq = this.seq++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new DapError(command, "timed out after " + timeoutMs + " ms"));
      }, timeoutMs);
      this.pending.set(seq, {
        resolve: (body) => {
          clearTimeout(timer);
          resolve(body as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        command,
      });
      this.write({
        seq,
        type: "request",
        command,
        ...(args === undefined ? {} : { arguments: args }),
      });
    });
  }

  /** Resolves with the next event of that name (and matching `filter`). */
  waitFor<T = Record<string, unknown>>(
    event: string,
    timeoutMs = 120000,
    filter: (body: T) => boolean = () => true,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const listener = (body: T): void => {
        if (!filter(body)) return;
        cleanup();
        resolve(body);
      };
      const onExit = (): void => {
        cleanup();
        reject(new Error("debug adapter exited waiting for " + event));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("timed out waiting for DAP event " + event));
      }, timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        this.off("event:" + event, listener);
        this.off("exit", onExit);
      };
      this.on("event:" + event, listener);
      this.on("exit", onExit);
    });
  }

  kill(): void {
    if (!this.exited) this.child.kill("SIGKILL");
  }
}

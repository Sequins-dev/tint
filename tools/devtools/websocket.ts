// A minimal RFC 6455 WebSocket server endpoint over node:http's `upgrade`
// event: text and binary messages, fragmentation, ping/pong and close.
// Enough for the Chrome DevTools frontend; no extensions or subprotocols.
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const acceptGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Host headers allowed to reach the bridge: loopback names and IP
 * literals only, so a web page cannot reach it through DNS rebinding (the
 * same rule as Node's inspector). */
export function allowedHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  const name = host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : (host.split(":")[0] ?? "");
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(name) ||
    name.includes(":")
  );
}

/** Events: "message" (text: string), "close". */
export class WebSocketConnection extends EventEmitter {
  private readonly socket: Duplex;
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentOpcode = 0;
  private closed = false;

  constructor(socket: Duplex) {
    super();
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => this.receive(chunk));
    socket.on("close", () => this.finish());
    socket.on("error", () => this.finish());
  }

  get open(): boolean {
    return !this.closed;
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }

  private receive(chunk: Buffer): void {
    this.buffer =
      this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 2) return;
      const first = this.buffer[0] ?? 0,
        second = this.buffer[1] ?? 0;
      const fin = (first & 0x80) !== 0,
        opcode = first & 0x0f,
        masked = (second & 0x80) !== 0;
      let length = second & 0x7f,
        offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      const payload = Buffer.from(
        this.buffer.subarray(offset, offset + length),
      );
      if (masked)
        for (let index = 0; index < payload.length; index++)
          payload[index] =
            (payload[index] ?? 0) ^
            (this.buffer[maskOffset + (index % 4)] ?? 0);
      this.buffer = this.buffer.subarray(offset + length);
      this.frame(fin, opcode, payload);
    }
  }

  private frame(fin: boolean, opcode: number, payload: Buffer): void {
    if (opcode === 0x8) {
      if (!this.closed) this.sendFrame(0x8, payload.subarray(0, 2));
      this.socket.end();
      this.finish();
      return;
    }
    if (opcode === 0x9) {
      this.sendFrame(0xa, payload);
      return;
    }
    if (opcode === 0xa) return;
    if (opcode !== 0) {
      this.fragments = [];
      this.fragmentOpcode = opcode;
    }
    this.fragments.push(payload);
    if (!fin) return;
    const message = Buffer.concat(this.fragments);
    this.fragments = [];
    if (this.fragmentOpcode === 0x1 || this.fragmentOpcode === 0x2)
      this.emit("message", message.toString("utf8"));
  }

  private sendFrame(opcode: number, payload: Buffer): boolean {
    if (this.closed) return false;
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    this.socket.write(header);
    return this.socket.write(payload);
  }

  /** Sends a text message; resolves once the socket can take more (so
   * large streams such as heap snapshot chunks respect backpressure). */
  send(text: string): Promise<void> {
    if (this.sendFrame(0x1, Buffer.from(text, "utf8")) || this.closed)
      return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        this.socket.off("drain", done);
        this.off("close", done);
        resolve();
      };
      this.socket.once("drain", done);
      this.once("close", done);
    });
  }

  close(): void {
    if (this.closed) return;
    this.sendFrame(0x8, Buffer.from([0x03, 0xe8]));
    this.socket.end();
    this.finish();
  }
}

/** Completes the opening handshake, or rejects the request (false). */
export function acceptWebSocket(
  request: IncomingMessage,
  socket: Duplex,
): WebSocketConnection | undefined {
  const key = request.headers["sec-websocket-key"];
  if (
    request.headers.upgrade?.toLowerCase() !== "websocket" ||
    typeof key !== "string" ||
    !allowedHost(request.headers.host)
  ) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return undefined;
  }
  const accept = createHash("sha1")
    .update(key + acceptGuid)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " +
      accept +
      "\r\n\r\n",
  );
  return new WebSocketConnection(socket);
}

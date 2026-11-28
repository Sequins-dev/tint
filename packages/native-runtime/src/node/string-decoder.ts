import { Buffer } from "node:buffer";
import { bufferEncoding, type NodeBufferEncoding } from "./buffer-encoding.ts";
import { codedError, invalidArgument } from "./coded-errors.ts";

function bufferText(bytes: Uint8Array, encoding: NodeBufferEncoding): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    encoding,
  );
}

function trailingUTF8Width(bytes: Uint8Array): number {
  let at = bytes.length - 1;
  // Look back for a lead byte. Preserve structurally incomplete sequences
  // here, including malformed scalars, for the Buffer codec to replace.
  while (at >= 0 && bytes.length - at <= 3 && ((bytes[at] ?? 0) & 192) === 128)
    at--;
  if (at < 0 || bytes.length - at > 3) return 0;
  const lead = bytes[at] ?? 0;
  const width =
    lead >= 192 && lead < 224
      ? 2
      : lead >= 224 && lead < 240
        ? 3
        : lead >= 240 && lead < 248
          ? 4
          : 0;
  return width > bytes.length - at ? width : 0;
}

export class StringDecoder {
  readonly encoding: NodeBufferEncoding;
  readonly #last = new Uint8Array(4);
  #pending = 0;
  #total = 0;
  constructor(encoding?: string) {
    const selected =
      encoding === undefined || encoding === null || encoding === ""
        ? "utf8"
        : typeof encoding === "string"
          ? bufferEncoding(encoding)
          : undefined;
    if (selected === undefined)
      throw codedError(
        new TypeError("Unknown encoding: " + String(encoding)),
        "ERR_UNKNOWN_ENCODING",
      );
    this.encoding = selected;
  }

  get lastNeed(): number {
    return this.#total - this.#pending;
  }
  get lastTotal(): number {
    return this.#total;
  }
  get lastChar(): Buffer {
    return Buffer.from(this.#last);
  }

  write(input: ArrayBufferView | string): string {
    if (typeof input === "string") return input;
    if (!ArrayBuffer.isView(input))
      throw invalidArgument(
        "buf",
        "an instance of Buffer, TypedArray, or DataView",
        input,
      );
    const current = new Uint8Array(
      input.buffer,
      input.byteOffset,
      input.byteLength,
    );
    if (current.length === 0) return "";
    let bytes = current;
    let prefix = "";
    if (this.#pending !== 0 && this.encoding === "utf16le") {
      const count = Math.min(this.lastNeed, current.length);
      this.#last.set(current.subarray(0, count), this.#pending);
      this.#pending += count;
      if (this.#pending < this.#total) return "";
      prefix = bufferText(this.#last.subarray(0, this.#total), this.encoding);
      bytes = current.subarray(count);
    } else if (this.#pending !== 0) {
      bytes = new Uint8Array(current.length + this.#pending);
      bytes.set(this.#last.subarray(0, this.#pending));
      bytes.set(current, this.#pending);
    }
    let tail = 0,
      total = 0;
    switch (this.encoding) {
      case "utf8": {
        total = trailingUTF8Width(bytes);
        if (total !== 0) {
          tail = 1;
          while (((bytes[bytes.length - tail] ?? 0) & 192) === 128) tail++;
        }
        break;
      }
      case "utf16le":
        if (bytes.length % 2 !== 0) {
          tail = 1;
          total = 2;
        } else {
          const high = bytes[bytes.length - 1] ?? 0;
          if (high >= 216 && high <= 219) {
            tail = 2;
            total = 4;
          }
        }
        break;
      case "base64":
      case "base64url":
        tail = bytes.length % 3;
        if (tail !== 0) total = 3;
        break;
    }
    this.#pending = tail;
    this.#total = total;
    if (tail !== 0) this.#last.set(bytes.subarray(bytes.length - tail));
    return (
      prefix + bufferText(bytes.subarray(0, bytes.length - tail), this.encoding)
    );
  }

  end(input?: ArrayBufferView | string): string {
    const text = input === undefined ? "" : this.write(input);
    const tail =
      this.#pending === 0
        ? ""
        : bufferText(this.#last.subarray(0, this.#pending), this.encoding);
    this.#pending = 0;
    this.#total = 0;
    return text + tail;
  }

  text(input: Uint8Array, offset: number): string {
    this.#pending = 0;
    this.#total = 0;
    return this.write(input.subarray(offset));
  }
}
export default { StringDecoder };

declare module "node:crypto" {
  import type { Buffer } from "node:buffer";
  export interface Digest {
    update(data: string | ArrayBufferView, inputEncoding?: string): this;
    digest(): Buffer;
    digest(encoding: "buffer"): Buffer;
    digest(encoding: string): string;
  }
  export function createHash(algorithm: string): Digest;
  export function createHmac(
    algorithm: string,
    key: string | ArrayBuffer | ArrayBufferView,
  ): Digest;
  export function randomBytes(size: number): Buffer;
  export function pbkdf2(
    password: string | ArrayBuffer | ArrayBufferView,
    salt: string | ArrayBuffer | ArrayBufferView,
    iterations: number,
    keylen: number,
    digest: string,
    callback: (error: Error | null, bytes: Buffer) => void,
  ): void;
  export function hash(
    algorithm: string,
    data: string | ArrayBufferView,
  ): string;
  export function hash(
    algorithm: string,
    data: string | ArrayBufferView,
    outputEncoding: "buffer" | { outputEncoding: "buffer" },
  ): Buffer;
  export function hash(
    algorithm: string,
    data: string | ArrayBufferView,
    outputEncoding?: string | { outputEncoding?: string },
  ): string | Buffer;
  export function randomUUID(options?: {
    disableEntropyCache?: boolean;
  }): `${string}-${string}-${string}-${string}-${string}`;
  const crypto: {
    createHash: typeof createHash;
    createHmac: typeof createHmac;
    randomBytes: typeof randomBytes;
    pbkdf2: typeof pbkdf2;
    hash: typeof hash;
    randomUUID: typeof randomUUID;
  };
  export default crypto;
}

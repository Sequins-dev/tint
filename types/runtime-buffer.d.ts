/** Byte view contracts used by the runtime modules that return Node Buffers. */
declare module "node:buffer" {
  interface Buffer extends Uint8Array {
    toString(encoding?: string, start?: number, end?: number): string;
  }
  const Buffer: {
    from(value: Uint8Array | readonly number[]): Buffer;
    from(value: ArrayBufferLike, byteOffset?: number, length?: number): Buffer;
    isBuffer(value: unknown): value is Buffer;
  };
}

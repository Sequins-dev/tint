// Trusted type-only view of the standard globals used by portable source loading.
// Runtime implementation: Node globals during bootstrap; Tint globals after self-hosting.
// This deliberately exposes only the currently consumed standard surface.
declare class TextEncoder {
  readonly encoding: "utf-8";
  encodeInto(
    input: string,
    destination: Uint8Array,
  ): { read: number; written: number };
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  constructor(
    label?: string,
    options?: { fatal?: boolean; ignoreBOM?: boolean },
  );
  decode(
    input?: ArrayBufferView | ArrayBuffer,
    options?: { stream?: boolean },
  ): string;
}

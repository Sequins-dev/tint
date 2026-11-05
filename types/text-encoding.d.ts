// Trusted type-only view of the standard globals used by portable source loading.
// Runtime implementation: Node globals during bootstrap; Tint globals after self-hosting.
// This deliberately exposes only the currently consumed standard surface.
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(
    label?: string,
    options?: { fatal?: boolean; ignoreBOM?: boolean },
  );
  decode(
    input?: ArrayBufferView | ArrayBuffer,
    options?: { stream?: boolean },
  ): string;
}

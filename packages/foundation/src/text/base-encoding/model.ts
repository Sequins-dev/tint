/** Decoders preserve committed bytes on syntax errors; read counts source units. */
export interface BaseDecodeResult {
  readonly read: number;
  readonly written: number;
  readonly error: "none" | "syntax" | "bounds";
}
export type Base64Alphabet = "base64" | "base64url";
export type Base64LastChunkHandling =
  "loose" | "strict" | "stop-before-partial";

// Node's side of the string benchmark codec (tools/string-bench/bench.ts):
// the standard globals whose Tint cores native-codec.ts calls. A string's
// clone uses V8's value serializer, which Worker messages use: Node's
// structuredClone returns a primitive string without copying it.
import { deserialize, serialize } from "node:v8";
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
export function encodeText(text: string): Uint8Array {
  return encoder.encode(text);
}
export function decodeText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
/** Node needs no clone state; Tint's cloner holds the two realms. */
export function createCloner(): number {
  return 0;
}
export function cloneString(_cloner: number, text: string): string {
  return deserialize(serialize(text)) as string;
}

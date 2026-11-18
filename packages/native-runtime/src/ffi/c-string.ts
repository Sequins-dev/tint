/** NUL-terminated C strings for `tint:ffi` (docs/native-ffi.md). */
import { strlen, memcpy } from "tint:c/memory";
import {
  createUTF8Decoder,
  decodeUTF8,
} from "@tint/foundation/text/text-encoding";

/** A copy of the UTF-8 text at nonzero address `text` up to its NUL
 * (malformed sequences become U+FFFD). */
export function readCString(text: number): string {
  const length = strlen(text);
  const bytes = new Uint8Array(length);
  memcpy(bytes, text, length);
  const decoded = decodeUTF8(createUTF8Decoder(false, true), bytes);
  if (decoded === undefined) throw new TypeError("C string decoding failed");
  return decoded;
}

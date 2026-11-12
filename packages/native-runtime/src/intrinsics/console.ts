import { encodeUTF8 } from "@tint/foundation/text/text-encoding";
import { write } from "./fs.ts";

/** Writes one line through the host's authorized `write` binding; a failed
 * or zero-length write ends the line silently, as console output does. */
function emit(fd: number, text: string): void {
  const bytes = encodeUTF8(text + "\n");
  let offset = 0;
  while (offset < bytes.length) {
    const written = write(fd, bytes.subarray(offset));
    if (written <= 0) return;
    offset += written;
  }
}
/** `console.log`/`info` for typed programs, which pass the formatted line. */
export function consoleLog(text: string): void {
  emit(1, text);
}
/** `console.error`/`warn` for typed programs. */
export function consoleError(text: string): void {
  emit(2, text);
}

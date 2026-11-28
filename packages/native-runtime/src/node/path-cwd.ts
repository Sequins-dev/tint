import { getcwd } from "tint:c/libsystem";
import {
  createUTF8Decoder,
  decodeUTF8,
} from "@tint/foundation/text/text-encoding";

export function currentDirectory(): string {
  for (let capacity = 1024; capacity <= 1048576; capacity *= 2) {
    const buffer = new Uint8Array(capacity);
    if (getcwd(buffer, capacity) === 0) continue;
    let length = 0;
    while (length < capacity && buffer[length] !== 0) length++;
    return (
      decodeUTF8(createUTF8Decoder(false, true), buffer.subarray(0, length)) ??
      ""
    );
  }
  throw new Error("Cannot get current working directory");
}

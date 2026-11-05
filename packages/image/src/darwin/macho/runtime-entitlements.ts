import type { SignatureBlob } from "../signature.ts";
import { writeUnsigned } from "@tint/foundation/binary/bytes";

function blob(magic: number, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length);
  if (
    !writeUnsigned(bytes, 0, 4, magic, "big").ok ||
    !writeUnsigned(bytes, 4, 4, bytes.length, "big").ok
  )
    throw "ENTITLEMENT_BLOB_INVARIANT";
  bytes.set(payload, 8);
  return bytes;
}
function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) {
    if (part === undefined) throw "ENTITLEMENT_PART_INVARIANT";
    length += part.length;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    if (part === undefined) throw "ENTITLEMENT_PART_INVARIANT";
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
/** Only the two fixed Boolean permissions below are encoded. Their bounded DER
 * payloads use short lengths; this is not a general plist/ASN.1 serializer. */
function tagged(tag: number, payload: Uint8Array): Uint8Array {
  if (payload.length >= 128) throw "ENTITLEMENT_LENGTH_INVARIANT";
  const bytes = new Uint8Array(payload.length + 2);
  bytes[0] = tag;
  bytes[1] = payload.length;
  bytes.set(payload, 2);
  return bytes;
}
export function runtimeEntitlements(
  allowDebugger: boolean,
  allowJit: boolean,
): readonly SignatureBlob[] {
  const keys: string[] = [];
  // DER dictionaries use canonical key order, independently of request order.
  if (allowJit) keys.push("com.apple.security.cs.allow-jit");
  if (allowDebugger) keys.push("com.apple.security.get-task-allow");
  if (keys.length === 0) return [];
  const encoder = new TextEncoder(),
    entries: Uint8Array[] = [];
  let properties = "";
  for (const key of keys) {
    if (key === undefined) throw "ENTITLEMENT_KEY_INVARIANT";
    properties += "<key>" + key + "</key><true/>";
    entries.push(
      tagged(
        0x30,
        concatenate([
          tagged(0x0c, encoder.encode(key)),
          new Uint8Array([0x01, 0x01, 0xff]),
        ]),
      ),
    );
  }
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>' +
    properties +
    "</dict></plist>";
  const der = tagged(
    0x70,
    concatenate([
      new Uint8Array([0x02, 0x01, 0x01]),
      tagged(0xb0, concatenate(entries)),
    ]),
  );
  return [
    { slot: 5, bytes: blob(0xfade7171, encoder.encode(xml)) },
    { slot: 7, bytes: blob(0xfade7172, der) },
  ];
}

export function fixed(version = 0): Uint8Array {
  const bytes = new Uint8Array(54),
    view = new DataView(bytes.buffer);
  bytes.set([84, 90, 105, 102, version]);
  view.setUint32(36, 1);
  view.setUint32(40, 4);
  view.setInt32(44, 19800);
  bytes.set([73, 83, 84, 0], 50);
  return bytes;
}
export function transitions(version: number): Uint8Array {
  const width = version === 0 ? 4 : 8,
    body = 44 + 2 * width + 2 + 12 + 8;
  const bytes = new Uint8Array(body),
    view = new DataView(bytes.buffer);
  bytes.set([84, 90, 105, 102, version]);
  view.setUint32(32, 2);
  view.setUint32(36, 2);
  view.setUint32(40, 8);
  if (width === 4) {
    view.setInt32(44, -1);
    view.setInt32(48, 1000);
  } else {
    view.setBigInt64(44, -9223372036854775808n);
    view.setBigInt64(52, 9223372036854775807n);
  }
  const types = 44 + width * 2;
  bytes.set([1, 0], types);
  view.setInt32(types + 2, 0);
  view.setInt32(types + 8, 3600);
  bytes[types + 12] = 1;
  bytes[types + 13] = 4;
  bytes.set([83, 84, 68, 0, 68, 83, 84, 0], types + 14);
  if (version === 0) return bytes;
  const first = fixed(version),
    footer = new TextEncoder().encode("\nUTC0\n");
  const all = new Uint8Array(first.length + bytes.length + footer.length);
  all.set(first);
  all.set(bytes, first.length);
  all.set(footer, first.length + bytes.length);
  return all;
}

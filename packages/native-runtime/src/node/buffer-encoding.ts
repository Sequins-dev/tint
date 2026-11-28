export type NodeBufferEncoding =
  "utf8" | "utf16le" | "latin1" | "ascii" | "base64" | "base64url" | "hex";

/** Node's encoding aliases are ASCII case-insensitive. */
export function bufferEncoding(name: string): NodeBufferEncoding | undefined {
  if (name.length > 9) return undefined;
  switch (name.toLowerCase()) {
    case "utf8":
    case "utf-8":
      return "utf8";
    case "utf16le":
    case "utf-16le":
    case "ucs2":
    case "ucs-2":
      return "utf16le";
    case "latin1":
    case "binary":
      return "latin1";
    case "ascii":
      return "ascii";
    case "base64":
      return "base64";
    case "base64url":
      return "base64url";
    case "hex":
      return "hex";
  }
  return undefined;
}

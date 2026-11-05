import { hashString } from "@tint/foundation/collections/key-index";
import { scriptStrictEqual } from "./values.ts";

export function collectionKeyHash(value: unknown): number {
  if (typeof value === "string") return hashString(value);
  if (typeof value === "number") return value >>> 0;
  return 0;
}
export function collectionKeyEqual(left: unknown, right: unknown): boolean {
  return (
    scriptStrictEqual(left, right) ||
    (typeof left === "number" &&
      typeof right === "number" &&
      left !== left &&
      right !== right)
  );
}

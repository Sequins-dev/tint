/** Shared category encoding for lowering and run-time type contracts. */
export function primitiveContractBit(name: string): number {
  switch (name) {
    case "undefined":
      return 1;
    case "null":
      return 2;
    case "boolean":
      return 4;
    case "number":
      return 8;
    case "string":
      return 16;
    case "bigint":
      return 32;
    case "symbol":
      return 64;
    case "never":
      return 128;
    default:
      return 0;
  }
}

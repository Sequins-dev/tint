import { nativeHostedContextByteLength } from "@tint/abi/host";
import type { FunctionIR, ScalarType } from "@tint/ir/scalar";
/** Hosted context retains its existing fields; the registrar is a permanent
 * control-allocated function reference. Domain identity occupies the last word. */
export const nativeContextBytes = nativeHostedContextByteLength;
export const nativeAllocationStateOffset = 56;
export const nativeExternalMemoryOffset = 64;
export interface ParameterLocation {
  readonly kind: "float" | "integer" | "stack";
  readonly index: number;
}
export interface SignatureLayout {
  readonly parameters: readonly ParameterLocation[];
  readonly stackBytes: number;
}
export function signatureLayout(fn: FunctionIR): SignatureLayout {
  const parameters: ParameterLocation[] = [];
  let numbers = 0,
    booleans = 0,
    overflow = 0;
  for (const slot of fn.parameters) {
    if (slot === undefined) throw "signature slot invariant";
    const type: ScalarType | undefined = fn.slots[slot];
    if (type === undefined) throw "verified signature invariant";
    if (type === "number" && numbers < 8)
      parameters.push({ kind: "float", index: numbers++ });
    else if (type !== "number" && booleans < 4)
      parameters.push({ kind: "integer", index: 4 + booleans++ });
    else {
      parameters.push({ kind: "stack", index: overflow });
      overflow += 8;
    }
  }
  return { parameters, stackBytes: Math.ceil(overflow / 16) * 16 };
}

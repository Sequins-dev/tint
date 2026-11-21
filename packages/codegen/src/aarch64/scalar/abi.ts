import { nativeHostedContextByteLength } from "@tint/abi/host";
import type { FunctionIR, ScalarType } from "@tint/ir/scalar";
/** Hosted context retains its existing fields; the registrar is a permanent
 * control-allocated function reference. Domain identity occupies the last word. */
export const nativeContextBytes = nativeHostedContextByteLength;
export const nativeAllocationStateOffset = 56;
export const nativeExternalMemoryOffset = 64;
export interface ParameterLocation {
  readonly kind: "float" | "integer" | "stack" | "pair" | "script-list";
  readonly index: number;
}
export interface SignatureLayout {
  readonly parameters: readonly ParameterLocation[];
  readonly stackBytes: number;
}
// x0/x1 retain the context and closure environment. x2 carries either
// (argc * 2 + 1) or an aligned reference to an existing argument list.
// x3 carries the completion area. x4–x9 hold callee, receiver and new.target.
// x16/x17 are available for entry dispatch and x18 is reserved on Darwin.
export const scriptFirstActualRegister = 10;
export const scriptActualRegisterPairs = 3;
export function scriptArgumentLayout(count: number): {
  readonly registerArguments: number;
  readonly stackBytes: number;
} {
  const registerArguments = Math.min(count, scriptActualRegisterPairs);
  return { registerArguments, stackBytes: 16 * (count - registerArguments) };
}
export function signatureLayout(fn: FunctionIR): SignatureLayout {
  if (fn.scriptEntry === true)
    return {
      parameters: fn.parameters.map((_, index): ParameterLocation =>
        index === 3
          ? { kind: "script-list", index: 2 }
          : { kind: "pair", index: 4 + index * 2 },
      ),
      stackBytes: 0,
    };
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

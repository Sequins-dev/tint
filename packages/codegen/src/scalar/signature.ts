import {
  nativeSignatureVoidCode,
  nativeSignatureGeneralCode,
  nativeSignatureOptionalBooleanCode,
  nativeSignaturePrimitiveCode,
  nativeSignatureStringCode,
  nativeSignatureReferenceCode,
  nativeSignatureOptionalReferenceCode,
  nativeSignatureOptionalStringCode,
  nativeSignatureNumberCode,
  nativeSignatureBooleanCode,
  nativeSignatureUint8ArrayCode,
  nativeSignatureUint16ArrayCode,
  nativeSignatureUint32ArrayCode,
  nativeSignatureFloat64ArrayCode,
  nativeSignatureOptionalNumberCode,
} from "@tint/abi/function";
import type { ScalarType } from "@tint/ir/scalar";

export function nativeSignatureTypeCode(type: ScalarType | "void"): number {
  switch (type) {
    case "void":
      return nativeSignatureVoidCode;
    case "general":
      return nativeSignatureGeneralCode;
    case "optional-boolean":
      return nativeSignatureOptionalBooleanCode;
    case "primitive":
      return nativeSignaturePrimitiveCode;
    case "string":
      return nativeSignatureStringCode;
    case "reference":
      return nativeSignatureReferenceCode;
    case "optional-reference":
      return nativeSignatureOptionalReferenceCode;
    case "optional-string":
      return nativeSignatureOptionalStringCode;
    case "number":
      return nativeSignatureNumberCode;
    case "boolean":
      return nativeSignatureBooleanCode;
    case "Uint8Array":
      return nativeSignatureUint8ArrayCode;
    case "Uint16Array":
      return nativeSignatureUint16ArrayCode;
    case "Uint32Array":
      return nativeSignatureUint32ArrayCode;
    case "Float64Array":
      return nativeSignatureFloat64ArrayCode;
    case "optional-number":
      return nativeSignatureOptionalNumberCode;
  }
}

const π = 3.141592653589793;
/** Standard numeric values. Callers must first establish an unshadowed global. */
export function numericConstant(
  namespace: string,
  name: string,
): number | undefined {
  if (namespace === "") {
    if (name === "NaN") return 0 / 0;
    if (name === "Infinity") return 1 / 0;
  } else if (namespace === "Number") {
    switch (name) {
      case "NaN":
        return 0 / 0;
      case "POSITIVE_INFINITY":
        return 1 / 0;
      case "NEGATIVE_INFINITY":
        return -1 / 0;
      case "MAX_SAFE_INTEGER":
        return 9007199254740991;
      case "MIN_SAFE_INTEGER":
        return -9007199254740991;
      case "MAX_VALUE":
        return 1.7976931348623157e308;
      case "MIN_VALUE":
        return 5e-324;
      case "EPSILON":
        return 2.220446049250313e-16;
    }
  } else if (namespace === "Math") {
    switch (name) {
      case "E":
        return 2.718281828459045;
      case "LN10":
        return 2.302585092994046;
      case "LN2":
        return 0.6931471805599453;
      case "LOG10E":
        return 0.4342944819032518;
      case "LOG2E":
        return 1.4426950408889634;
      case "PI":
        return π;
      case "SQRT1_2":
        return 0.7071067811865476;
      case "SQRT2":
        return 1.4142135623730951;
    }
  } else if (name === "BYTES_PER_ELEMENT") {
    switch (namespace) {
      case "Int8Array":
      case "Uint8Array":
      case "Uint8ClampedArray":
        return 1;
      case "Int16Array":
      case "Uint16Array":
      case "Float16Array":
        return 2;
      case "Int32Array":
      case "Uint32Array":
      case "Float32Array":
        return 4;
      case "Float64Array":
      case "BigInt64Array":
      case "BigUint64Array":
        return 8;
    }
  }
  return undefined;
}

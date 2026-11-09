import {
  createUTF8Decoder as createDecoder,
  decodeUTF8 as decode,
  type UTF8Decoder,
} from "@tint/foundation/text/text-encoding";
import {
  createDecimalNumberFormatter as createNumberFormatter,
  type DecimalNumberFormatter,
} from "./decimal-number-format.ts";
import type { NumberFormatDigitOptions } from "./intl-number-options.ts";
import type {
  NumberGrouping,
  NumberSignDisplay,
} from "./decimal-number-parts.ts";

/** Concrete managed callback contracts; defaults stay inside ordinary direct calls. */
export function createUTF8Decoder(
  fatal: boolean,
  ignoreBOM: boolean,
): UTF8Decoder {
  return createDecoder(fatal, ignoreBOM);
}
export function decodeUTF8(
  state: UTF8Decoder,
  input: Uint8Array,
  stream: boolean,
): string | undefined {
  return decode(state, input, stream);
}
export function createDecimalNumberFormatter(
  locale: string,
  numberingSystem: string | undefined,
  digitOptions: NumberFormatDigitOptions,
  useGrouping: NumberGrouping,
  signDisplay: NumberSignDisplay,
): DecimalNumberFormatter | undefined {
  return createNumberFormatter(
    locale,
    numberingSystem,
    digitOptions,
    useGrouping,
    signDisplay,
  );
}

import { createScanner } from "../../text/text-scanner.ts";
import { createDuration, type Duration } from "./duration.ts";

/** ISO Duration grammar, with exact decimal fractions only on the final clock unit. */
export function parseDuration(text: string): Duration | undefined {
  const scanner = createScanner(text);
  let sign = 1;
  if (scanner.match("-")) sign = -1;
  else scanner.match("+");
  if (!scanner.match("P") && !scanner.match("p")) return undefined;
  const fields: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let time = false,
    previous = -1,
    units = 0,
    clockUnits = 0;
  while (!scanner.done()) {
    if (scanner.match("T") || scanner.match("t")) {
      if (time) return undefined;
      time = true;
      if (scanner.done()) return undefined;
    }
    const digits = scanner.eatWhile(
      (code): boolean => code >= 48 && code <= 57,
    );
    if (digits.length === 0) return undefined;
    const value = Number(digits);
    let fraction = -1;
    if (scanner.match(".") || scanner.match(",")) {
      const decimal = scanner.eatWhile(
        (code): boolean => code >= 48 && code <= 57,
      );
      if (decimal.length === 0 || decimal.length > 9) return undefined;
      fraction = Number(decimal.padEnd(9, "0"));
    }
    const code = scanner.peekCode();
    scanner.advance();
    const unit = code >= 97 && code <= 122 ? code - 32 : code;
    const index = time
      ? unit === 72
        ? 4
        : unit === 77
          ? 5
          : unit === 83
            ? 6
            : -1
      : unit === 89
        ? 0
        : unit === 77
          ? 1
          : unit === 87
            ? 2
            : unit === 68
              ? 3
              : -1;
    if (index < 0 || index <= previous) return undefined;
    if (fraction >= 0 && (!time || !scanner.done())) return undefined;
    fields[index] = value;
    if (fraction >= 0) {
      let nanoseconds = fraction * (index === 4 ? 3600 : index === 5 ? 60 : 1);
      if (index === 4) {
        fields[5] = Math.floor(nanoseconds / 60000000000);
        nanoseconds %= 60000000000;
      }
      if (index <= 5) {
        fields[6] = Math.floor(nanoseconds / 1000000000);
        nanoseconds %= 1000000000;
      }
      fields[7] = Math.floor(nanoseconds / 1000000);
      fields[8] = Math.floor(nanoseconds / 1000) % 1000;
      fields[9] = nanoseconds % 1000;
    }
    units++;
    if (time) clockUnits++;
    previous = index;
  }
  if (units === 0 || (time && clockUnits === 0)) return undefined;
  for (let i = 0; i < fields.length; i++) fields[i] = (fields[i] ?? 0) * sign;
  return createDuration(fields);
}

export interface MonthCode {
  readonly month: number;
  readonly leap: boolean;
}
/** Syntactic MonthCode parsing precedes options and calendar-specific validation. */
export function parseMonthCodeText(text: string): MonthCode | undefined {
  if (text.length !== 3 && text.length !== 4) return undefined;
  if (text.charAt(0) !== "M") return undefined;
  const a = text.charCodeAt(1) - 48,
    b = text.charCodeAt(2) - 48;
  if (a < 0 || a > 9 || b < 0 || b > 9) return undefined;
  const leap = text.length === 4;
  if (leap && text.charAt(3) !== "L") return undefined;
  const month = a * 10 + b;
  return month === 0 && !leap ? undefined : { month, leap };
}

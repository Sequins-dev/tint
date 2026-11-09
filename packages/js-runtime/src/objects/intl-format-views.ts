import type { DateTimeFormatter } from "./date-time-service-contracts.ts";
import type { DurationFormatter } from "./duration-format.ts";

/** Checked record views over OrdinaryObject.internalIntlFormatData. The slot is
 * a general value so formatter record types never enter the core Script
 * surface that every runtime-compiled eval/Function prepares. Each view is a
 * compiler-bound record test (operation "view") returning the record only when
 * the value has exactly that record's managed class; it is not a cast. */
export function viewDateTimeFormatter(
  value: unknown,
): DateTimeFormatter | undefined {
  throw "UNBOUND_DATE_TIME_FORMATTER_VIEW";
}
export function viewDurationFormatter(
  value: unknown,
): DurationFormatter | undefined {
  throw "UNBOUND_DURATION_FORMATTER_VIEW";
}

import { resolveDateTimeFormatOptions } from "./date-time-format-options.ts";
import {
  dateTimeComponentSkeleton,
  resolveDateTimeComponentPattern,
  type DateTimeFormatter,
} from "./date-time-service.ts";
import type { ResolvedDateTimePattern } from "./date-time-service-contracts.ts";
/** Slots follow the public formattable kinds: date, year-month, month-day, time,
 * date-time, instant. A mask distinguishes unsuitable formats from cache misses. */
export function dateTimeTemporalPattern(
  formatter: DateTimeFormatter,
  kind: number,
): ResolvedDateTimePattern | undefined {
  if (kind < 0 || kind > 5) return undefined;
  const mask = 1 << kind;
  if ((formatter.temporalPatternMask & mask) !== 0)
    return formatter.temporalPatterns[kind];
  const required =
      kind === 0
        ? "date"
        : kind === 1
          ? "year-month"
          : kind === 2
            ? "month-day"
            : kind === 3
              ? "time"
              : "any",
    defaults =
      kind < 4
        ? required
        : kind === 5 && formatter.defaults === "zoned-date-time"
          ? "zoned-date-time"
          : "all",
    config = formatter.configuration,
    cycle = config.locale.hourCycle,
    styled = config.dateStyle !== undefined || config.timeStyle !== undefined;
  let pattern: ResolvedDateTimePattern | undefined = undefined;
  if (styled) {
    if (!(
      (kind <= 2 && config.dateStyle === undefined) ||
      (kind === 3 && config.timeStyle === undefined)
    )) {
      if (kind === 5) pattern = formatter.pattern;
      else {
        const fields = resolveDateTimeFormatOptions(
          formatter.pattern.fields,
          required,
          defaults,
          false,
        );
        if (fields !== undefined)
          pattern =
            dateTimeComponentSkeleton(fields, cycle) ===
            dateTimeComponentSkeleton(formatter.pattern.fields, cycle)
              ? formatter.pattern
              : resolveDateTimeComponentPattern(
                  formatter.parts,
                  fields,
                  cycle,
                  config.formatMatcher,
                );
      }
    }
  } else {
    const fields = resolveDateTimeFormatOptions(
      config.fields,
      required,
      defaults,
      kind === 5,
    );
    if (fields !== undefined)
      pattern = resolveDateTimeComponentPattern(
        formatter.parts,
        fields,
        cycle,
        config.formatMatcher,
      );
  }
  formatter.temporalPatterns[kind] = pattern;
  formatter.temporalPatternMask |= mask;
  return pattern;
}

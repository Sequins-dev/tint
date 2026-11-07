import { getDateTimeService } from "./date-time-service-instance.ts";
import type {
  DateTimeFormatFields,
  DateTimePatternToken,
} from "./date-time-pattern.ts";
import type {
  DateTimeFormatConfiguration,
  DateTimeFormatter,
  DateTimeInput,
  DateTimePart,
  DateTimeRangePart,
  DateTimePartsFormatter,
  DateTimeDisplayFields,
  ResolvedDateTimeLocale,
  ResolvedDateTimePattern,
} from "./date-time-service-contracts.ts";
export function dateTimeComponentSkeleton(
  fields: DateTimeFormatFields,
  cycle: string,
): string {
  return getDateTimeService().dateTimeComponentSkeleton(fields, cycle);
}
export function resolveDateTimeComponentPattern(
  parts: DateTimePartsFormatter,
  fields: DateTimeFormatFields,
  cycle: string,
  matcher: string,
): ResolvedDateTimePattern | undefined {
  return getDateTimeService().resolveDateTimeComponentPattern(
    parts,
    fields,
    cycle,
    matcher,
  );
}
export function createDateTimeFormatter(
  configuration: DateTimeFormatConfiguration,
  required: string = "any",
  defaults: string = "date",
): DateTimeFormatter | undefined {
  return getDateTimeService().createDateTimeFormatter(
    configuration,
    required,
    defaults,
  );
}
export function dateTimeEpochInput(
  formatter: DateTimeFormatter,
  pattern: ResolvedDateTimePattern,
  seconds: number,
  fractionNanoseconds: number,
): DateTimeInput | undefined {
  return getDateTimeService().dateTimeEpochInput(
    formatter,
    pattern,
    seconds,
    fractionNanoseconds,
  );
}
export function dateTimeFormatParts(
  formatter: DateTimeFormatter,
  value: number,
): DateTimePart[] | undefined {
  return getDateTimeService().dateTimeFormatParts(formatter, value);
}
export function dateTimeFormatRangeParts(
  formatter: DateTimeFormatter,
  first: number,
  last: number,
): DateTimeRangePart[] | undefined {
  return getDateTimeService().dateTimeFormatRangeParts(formatter, first, last);
}
export function resolveDateTimeLocale(
  requested: readonly string[],
  optionCalendar: string | undefined,
  optionSystem: string | undefined,
  optionCycle: string | undefined,
  hour12: boolean | undefined,
): ResolvedDateTimeLocale {
  return getDateTimeService().resolveDateTimeLocale(
    requested,
    optionCalendar,
    optionSystem,
    optionCycle,
    hour12,
  );
}
export function dateTimePatternParts(
  formatter: DateTimePartsFormatter,
  tokens: readonly DateTimePatternToken[],
  input: DateTimeDisplayFields,
  zoneName: string | undefined,
): DateTimePart[] | undefined {
  return getDateTimeService().dateTimePatternParts(
    formatter,
    tokens,
    input,
    zoneName,
  );
}
export function dateTimeRangeParts(
  formatter: DateTimePartsFormatter,
  pattern: ResolvedDateTimePattern,
  first: DateTimeDisplayFields,
  last: DateTimeDisplayFields,
  firstZone: string | undefined,
  lastZone: string | undefined,
): DateTimeRangePart[] | undefined {
  return getDateTimeService().dateTimeRangeParts(
    formatter,
    pattern,
    first,
    last,
    firstZone,
    lastZone,
  );
}
export type {
  DateTimeFormatter,
  DateTimeInput,
  DateTimePart,
  DateTimeRangePart,
  DateTimePartsFormatter,
  DateTimeDisplayFields,
  ResolvedDateTimeLocale,
  ResolvedDateTimePattern,
} from "./date-time-service-contracts.ts";

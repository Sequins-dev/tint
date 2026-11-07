import {
  createDateTimeFormatter,
  dateTimeComponentSkeleton,
  dateTimeEpochInput,
  dateTimeFormatParts,
  dateTimeFormatRangeParts,
  resolveDateTimeComponentPattern,
} from "./date-time-format.ts";
import { resolveDateTimeLocale } from "./date-time-locale.ts";
import { dateTimePatternParts } from "./date-time-parts.ts";
import { dateTimeRangeParts } from "./date-time-range.ts";
import type {
  DateTimeService,
  DateTimeFormatConfiguration,
  DateTimeFormatter,
} from "./date-time-service-contracts.ts";
// A required callback signature must receive all arguments even when the direct
// implementation supports omitted defaults.
function create(
  configuration: DateTimeFormatConfiguration,
  required: string,
  defaults: string,
): DateTimeFormatter | undefined {
  return createDateTimeFormatter(configuration, required, defaults);
}
export function createDateTimeService(): DateTimeService {
  return {
    createDateTimeFormatter: create,
    resolveDateTimeLocale,
    dateTimeComponentSkeleton,
    resolveDateTimeComponentPattern,
    dateTimeEpochInput,
    dateTimeFormatParts,
    dateTimeFormatRangeParts,
    dateTimePatternParts,
    dateTimeRangeParts,
  };
}

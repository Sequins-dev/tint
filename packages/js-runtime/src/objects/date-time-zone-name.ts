import {
  tzifOffsetSecondsAt,
  tzifDaylightSavingAt,
  posixTransitionEpochSeconds,
  type TzifZone,
} from "@tint/foundation/chrono/tzif";
import { gregorianCoordinateFromEpochDay } from "@tint/foundation/chrono/gregorian-calendar";
import {
  dateTimeZoneValue,
  dateTimeZoneCanonicalName,
  dateTimeZoneMetazone,
  dateTimeZoneReference,
  dateTimeZoneTerritory,
  dateTimeZonePrimary,
  type DateTimeZoneProfile,
} from "./date-time-zone-data.ts";
import { dateTimeNumberText } from "./date-time-parts.ts";
import type { DecimalNumberFormatter } from "./decimal-number-format.ts";
import type { TemporalTimeZone } from "./temporal-time-zone.ts";
import {
  parseDateTimePattern,
  type DateTimePatternToken,
} from "./date-time-pattern.ts";
export interface DateTimeZoneNameFormatter {
  readonly data: DateTimeZoneProfile;
  readonly numeric: DecimalNumberFormatter;
  readonly twoDigits: DecimalNumberFormatter;
  readonly region: string;
}
function substitute(
  pattern: string,
  zero: string,
  one: string | undefined,
): string | undefined {
  let result = "",
    cursor = 0;
  while (cursor < pattern.length) {
    const open = pattern.indexOf("{", cursor);
    if (open < 0) return result + pattern.slice(cursor);
    result += pattern.slice(cursor, open);
    const marker = pattern.slice(open, open + 3);
    if (marker === "{0}") result += zero;
    else if (marker === "{1}" && one !== undefined) result += one;
    else return undefined;
    cursor = open + 3;
  }
  return result;
}
function localizedOffset(
  formatter: DateTimeZoneNameFormatter,
  offset: number,
  long: boolean,
): string | undefined {
  const hourFormat = dateTimeZoneValue(formatter.data, "formats", "hourFormat"),
    gmt = dateTimeZoneValue(formatter.data, "formats", "gmtFormat");
  if (hourFormat === undefined || gmt === undefined) return undefined;
  const split = hourFormat.indexOf(";");
  if (split < 0) return undefined;
  const pattern =
    offset < 0 ? hourFormat.slice(split + 1) : hourFormat.slice(0, split);
  const tokens = parseDateTimePattern(pattern);
  if (tokens === undefined) return undefined;
  const absolute = Math.abs(offset),
    hours = Math.floor(absolute / 3600),
    minutes = Math.floor(absolute / 60) % 60,
    seconds = absolute % 60,
    includeMinutes = long || minutes !== 0 || seconds !== 0;
  let result = "",
    separator = "";
  for (let index = 0; index < tokens.length; index++) {
    const item: DateTimePatternToken | undefined = tokens[index];
    if (item === undefined) throw "DATE_TIME_ZONE_OFFSET_TOKEN_INVARIANT";
    if (item.symbol === "H")
      result += dateTimeNumberText(
        long ? formatter.twoDigits : formatter.numeric,
        hours,
      );
    else if (item.symbol === "m") {
      if (includeMinutes)
        result += dateTimeNumberText(formatter.twoDigits, minutes);
      if (seconds !== 0)
        result += separator + dateTimeNumberText(formatter.twoDigits, seconds);
    } else if (item.symbol === "") {
      const next: DateTimePatternToken | undefined = tokens[index + 1];
      if (next !== undefined && next.symbol === "m") {
        separator = item.literal;
        if (!includeMinutes) continue;
      }
      result += item.literal;
    } else return undefined;
  }
  return substitute(gmt, result, undefined);
}
function sameState(
  model: TzifZone,
  second: number,
  offset: number,
  daylight: boolean,
): boolean {
  return (
    tzifOffsetSecondsAt(model, second) === offset &&
    tzifDaylightSavingAt(model, second) === daylight
  );
}
/** Check the entire 184-day interval, not merely two seasonal samples. Recorded
 * transitions and future rule anchors include changes with identical offsets. */
function stableSeason(zone: TemporalTimeZone, second: number): boolean {
  if (zone.kind === "fixed") return true;
  const model = zone.model,
    offset = tzifOffsetSecondsAt(model, second),
    daylight = tzifDaylightSavingAt(model, second);
  if (offset === undefined || daylight === undefined) return false;
  const first = second - 15897600,
    last = second + 15897600;
  if (
    !sameState(model, first, offset, daylight) ||
    !sameState(model, last, offset, daylight)
  )
    return false;
  const times = model.transitionSeconds;
  let low = 0,
    high = times.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2),
      at = times[middle];
    if (at === undefined) throw "DATE_TIME_ZONE_TRANSITION_INVARIANT";
    if (at <= first) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < times.length; index++) {
    const at = times[index];
    if (at === undefined) throw "DATE_TIME_ZONE_TRANSITION_INVARIANT";
    if (at > last) break;
    if (
      !sameState(model, at - 1, offset, daylight) ||
      !sameState(model, at, offset, daylight)
    )
      return false;
  }
  const future = model.future;
  if (future !== undefined && future.kind === "alternating") {
    const from = gregorianCoordinateFromEpochDay(Math.floor(first / 86400)),
      to = gregorianCoordinateFromEpochDay(Math.floor(last / 86400));
    if (from === undefined || to === undefined) return false;
    const recorded = times[times.length - 1];
    for (let year = from.year - 1; year <= to.year + 1; year++) {
      const start = posixTransitionEpochSeconds(
          future.start,
          year,
          future.standardOffsetSeconds,
        ),
        end = posixTransitionEpochSeconds(
          future.end,
          year,
          future.daylightOffsetSeconds,
        );
      if (start === undefined || end === undefined) return false;
      const anchors: readonly number[] = [start, end];
      for (let index = 0; index < anchors.length; index++) {
        const at = anchors[index];
        if (at === undefined) throw "DATE_TIME_ZONE_FUTURE_ANCHOR_INVARIANT";
        if (
          at <= first ||
          at > last ||
          (recorded !== undefined && at <= recorded)
        )
          continue;
        if (
          !sameState(model, at - 1, offset, daylight) ||
          !sameState(model, at, offset, daylight)
        )
          return false;
      }
    }
  }
  return true;
}
function daylightName(
  zone: TemporalTimeZone,
  second: number,
  offset: number,
): boolean | undefined {
  if (zone.kind === "fixed") return false;
  const state = tzifDaylightSavingAt(zone.model, second);
  if (state === undefined) return undefined;
  const future = zone.model.future;
  // TZif can encode winter as negative daylight saving. When the current type
  // matches that exact rule pair, CLDR's standard/daylight labels follow the
  // conventional lower/higher seasonal offset, independently of the raw flag.
  if (
    future !== undefined &&
    future.kind === "alternating" &&
    future.daylightOffsetSeconds < future.standardOffsetSeconds &&
    offset ===
      (state ? future.daylightOffsetSeconds : future.standardOffsetSeconds)
  )
    return !state;
  return state;
}
function localizedName(
  formatter: DateTimeZoneNameFormatter,
  group: string,
  prefix: string,
  width: string,
  type: string,
  zone: TemporalTimeZone,
  second: number,
): string | undefined {
  const key = prefix + "." + width + ".",
    requested = dateTimeZoneValue(formatter.data, group, key + type);
  if (requested !== undefined) return requested;
  const daylight = dateTimeZoneValue(formatter.data, group, key + "daylight"),
    generic = dateTimeZoneValue(formatter.data, group, key + "generic"),
    standard = dateTimeZoneValue(formatter.data, group, key + "standard");
  if (daylight === undefined) return generic ?? standard;
  return type === "generic" &&
    standard !== undefined &&
    stableSeason(zone, second)
    ? standard
    : undefined;
}
function country(
  formatter: DateTimeZoneNameFormatter,
  region: string,
  short: boolean,
): string {
  const full = dateTimeZoneValue(formatter.data, "countries", region) ?? region;
  return short
    ? (dateTimeZoneValue(formatter.data, "countries", region + ".short") ??
        full)
    : full;
}
function city(
  formatter: DateTimeZoneNameFormatter,
  identifier: string,
): string | undefined {
  const named = dateTimeZoneValue(
    formatter.data,
    "zones",
    identifier + ".city",
  );
  if (named !== undefined) return named;
  if (dateTimeZoneTerritory(identifier) === undefined) return undefined;
  const raw = identifier.slice(identifier.lastIndexOf("/") + 1);
  let text = "";
  for (let index = 0; index < raw.length; index++)
    text += raw.charAt(index) === "_" ? " " : raw.charAt(index);
  return text;
}
function locationName(
  formatter: DateTimeZoneNameFormatter,
  identifier: string,
): string | undefined {
  const region = dateTimeZoneTerritory(identifier),
    pattern = dateTimeZoneValue(formatter.data, "formats", "regionFormat");
  if (pattern === undefined || region === undefined) return undefined;
  const location =
    dateTimeZonePrimary(region) === identifier
      ? country(formatter, region, true)
      : city(formatter, identifier);
  return location === undefined
    ? undefined
    : substitute(pattern, location, undefined);
}
function qualify(
  formatter: DateTimeZoneNameFormatter,
  identifier: string,
  metazone: string,
  name: string,
): string | undefined {
  const preferred = dateTimeZoneReference(metazone, formatter.region);
  if (preferred === identifier) return name;
  const region = dateTimeZoneTerritory(identifier);
  const qualifier =
    region !== undefined &&
    dateTimeZoneReference(metazone, region) === identifier
      ? country(formatter, region, false)
      : city(formatter, identifier);
  if (qualifier === undefined) return undefined;
  const pattern = dateTimeZoneValue(
    formatter.data,
    "formats",
    "fallbackFormat",
  );
  return pattern === undefined
    ? undefined
    : substitute(pattern, qualifier, name);
}
/** Pure names/offset rendering. The embedding supplies the same immutable zone
 * model used for converting the formatted instant into local calendar fields. */
export function dateTimeZoneName(
  formatter: DateTimeZoneNameFormatter,
  zone: TemporalTimeZone,
  epochSecond: number,
  style: string,
): string | undefined {
  const styles: readonly string[] = [
    "short",
    "long",
    "shortOffset",
    "longOffset",
    "shortGeneric",
    "longGeneric",
  ];
  if (!Number.isSafeInteger(epochSecond) || !styles.includes(style))
    return undefined;
  const offset =
    zone.kind === "fixed"
      ? zone.offsetNanoseconds / 1000000000
      : tzifOffsetSecondsAt(zone.model, epochSecond);
  if (
    offset === undefined ||
    !Number.isInteger(offset) ||
    Math.abs(offset) >= 86400
  )
    return undefined;
  const long =
    style === "long" || style === "longOffset" || style === "longGeneric";
  if (style === "shortOffset" || style === "longOffset")
    return localizedOffset(formatter, offset, long);
  const identifier = dateTimeZoneCanonicalName(
    zone.kind === "named" && zone.primaryIdentifier === "UTC"
      ? "UTC"
      : zone.identifier,
  );
  if (identifier === undefined || identifier === "Etc/Unknown")
    return localizedOffset(formatter, offset, long);
  const generic = style === "shortGeneric" || style === "longGeneric",
    daylight = daylightName(zone, epochSecond, offset);
  if (daylight === undefined) return undefined;
  const type = generic ? "generic" : daylight ? "daylight" : "standard",
    width = long ? "long" : "short";
  const direct = localizedName(
    formatter,
    "zones",
    identifier,
    width,
    type,
    zone,
    epochSecond,
  );
  if (direct !== undefined) return direct;
  const metazone = dateTimeZoneMetazone(identifier, epochSecond);
  if (metazone !== undefined) {
    const name = localizedName(
      formatter,
      "metazones",
      metazone,
      width,
      type,
      zone,
      epochSecond,
    );
    if (name !== undefined) {
      const qualified = qualify(formatter, identifier, metazone, name);
      if (qualified !== undefined) return qualified;
    }
  }
  if (generic) {
    const name = locationName(formatter, identifier);
    if (name !== undefined) return name;
  }
  return localizedOffset(formatter, offset, long);
}

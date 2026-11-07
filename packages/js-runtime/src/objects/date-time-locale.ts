import type { ResolvedDateTimeLocale } from "./date-time-service-contracts.ts";
export type { ResolvedDateTimeLocale } from "./date-time-service-contracts.ts";
import {
  parseLocaleId,
  type LocaleExtension,
  type LocaleField,
} from "./locale-id.ts";
import { maximizeLocaleId } from "./locale-likely.ts";
import { localeCalendars, localeHourCycles } from "./locale-info.ts";
import { runtimeDefaultLocale } from "./locale-objects.ts";
import { canonicalCalendarIdentifier } from "./calendar.ts";
import {
  lookupNumberFormatLocale,
  numberFormatLocaleData,
} from "./number-format-profile.ts";
import { createDateTimeCalendarProfile } from "./date-time-calendar.ts";

function keyword(tag: string, name: string): string | undefined {
  const parsed = parseLocaleId(tag);
  if (parsed === undefined) throw "DATE_TIME_LOCALE_TAG_INVARIANT";
  for (let index = 0; index < parsed.extensions.length; index++) {
    const extension: LocaleExtension | undefined = parsed.extensions[index];
    if (extension === undefined) throw "DATE_TIME_LOCALE_EXTENSION_INVARIANT";
    if (extension.key !== "u") continue;
    for (
      let fieldIndex = 0;
      fieldIndex < extension.fields.length;
      fieldIndex++
    ) {
      const field: LocaleField | undefined = extension.fields[fieldIndex];
      if (field === undefined) throw "DATE_TIME_LOCALE_FIELD_INVARIANT";
      if (field.key === name) return field.value;
    }
  }
  return undefined;
}
function supportedCalendar(
  locale: string,
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const canonical = canonicalCalendarIdentifier(value);
  if (canonical === undefined) return undefined;
  const calendar =
    canonical === "islamic" || canonical === "islamic-rgsa"
      ? "islamic-civil"
      : canonical;
  return createDateTimeCalendarProfile(locale, calendar) === undefined
    ? undefined
    : calendar;
}
function hourCycle(value: string | undefined): boolean {
  return (
    value === "h11" || value === "h12" || value === "h23" || value === "h24"
  );
}
/** Resolve only against complete shipped profiles. Observable option coercion and
 * validation belong to the object adapter; unsupported options preserve valid
 * requested extension values. Each keyword negotiates independently. */
export function resolveDateTimeLocale(
  requested: readonly string[],
  optionCalendar: string | undefined,
  optionSystem: string | undefined,
  optionCycle: string | undefined,
  hour12: boolean | undefined,
): ResolvedDateTimeLocale {
  const optionNumberingSystem = optionSystem,
    optionHourCycle = optionCycle;
  let base: string = runtimeDefaultLocale,
    tag: string = base;
  for (let index = 0; index < requested.length; index++) {
    const candidate = requested[index];
    if (candidate === undefined) throw "DATE_TIME_REQUESTED_LOCALE_INVARIANT";
    const matched = lookupNumberFormatLocale(candidate);
    if (matched !== undefined) {
      base = matched;
      tag = candidate;
      break;
    }
  }
  const data = numberFormatLocaleData(base),
    calendars = localeCalendars(base),
    cycles = localeHourCycles(base);
  if (data === undefined) throw "DATE_TIME_DEFAULT_LOCALE_INVARIANT";
  let calendar = supportedCalendar(base, calendars[0]) ?? "gregory",
    system: string = data.defaultNumberingSystem,
    cycle: string = cycles[0] ?? "h23",
    calendarAddition = "",
    systemAddition = "",
    cycleAddition = "";
  const requestedCalendar = keyword(tag, "ca"),
    extensionCalendar = supportedCalendar(base, requestedCalendar),
    extensionSystem = keyword(tag, "nu"),
    extensionCycle = keyword(tag, "hc");
  if (extensionCalendar !== undefined && requestedCalendar !== undefined) {
    calendar = extensionCalendar;
    // Deprecated identities are negotiated before their arithmetic fallback.
    calendarAddition = "-ca-" + requestedCalendar;
  }
  const selectedCalendar = supportedCalendar(base, optionCalendar);
  if (selectedCalendar !== undefined && selectedCalendar !== calendar) {
    calendar = selectedCalendar;
    calendarAddition = "";
  }
  if (
    extensionSystem !== undefined &&
    data.numberingSystems.includes(extensionSystem)
  ) {
    system = extensionSystem;
    systemAddition = "-nu-" + system;
  }
  if (
    optionNumberingSystem !== undefined &&
    optionNumberingSystem !== system &&
    data.numberingSystems.includes(optionNumberingSystem)
  ) {
    system = optionNumberingSystem;
    systemAddition = "";
  }
  if (hour12 === undefined) {
    if (extensionCycle !== undefined && hourCycle(extensionCycle)) {
      cycle = extensionCycle;
      cycleAddition = "-hc-" + cycle;
    }
    if (
      optionHourCycle !== undefined &&
      hourCycle(optionHourCycle) &&
      optionHourCycle !== cycle
    ) {
      cycle = optionHourCycle;
      cycleAddition = "";
    }
  } else {
    const desired = hour12 ? ["h11", "h12"] : ["h23", "h24"];
    cycle = hour12 ? "h12" : "h23";
    for (let index = 0; index < cycles.length; index++) {
      const candidate = cycles[index];
      if (candidate !== undefined && desired.includes(candidate)) {
        cycle = candidate;
        break;
      }
    }
  }
  const extensions = calendarAddition + cycleAddition + systemAddition,
    maximal = parseLocaleId(maximizeLocaleId(base) ?? base);
  if (maximal === undefined) throw "DATE_TIME_LOCALE_REGION_INVARIANT";
  return {
    locale: base + (extensions === "" ? "" : "-u" + extensions),
    dataLocale: base,
    calendar,
    numberingSystem: system,
    hourCycle: cycle,
    region: maximal.language.region === "" ? "001" : maximal.language.region,
  };
}

import { calendarAlgorithmsAvailable } from "./calendar-query.ts";
import { availableCollations } from "./collation-locales.ts";
import { availableCurrencyCodes } from "./currency-names.ts";
import { sanctionedSimpleUnits } from "./number-unit.ts";
import { installDurationFormatIntrinsic } from "./intl-duration-format.ts";
import { installDisplayNamesIntrinsic } from "./intl-display-names.ts";
import { installDateTimeFormatIntrinsic } from "./intl-date-time-format.ts";
import { installRelativeTimeFormatIntrinsic } from "./intl-relative-time-format.ts";
import { availableLocaleCalendars } from "./locale-info.ts";
import { numberFormatLocaleData } from "./number-format-profile.ts";
import { installNumberFormatIntrinsic } from "./intl-number-format.ts";
import { installPluralRulesIntrinsic } from "./intl-plural-rules.ts";
import {
  createObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { builtinProperty, builtinFunction } from "./intrinsics.ts";
import {
  createArrayFromList,
  createStringArrayFromList,
} from "./array-like.ts";
import { canonicalLocaleList, runtimeDefaultLocale } from "./locale-objects.ts";
import { stringValue } from "./coercion.ts";
import { installLocaleIntrinsic } from "./intl-locale.ts";
import { installCollatorIntrinsic } from "./intl-collator.ts";
import { installListFormatIntrinsic } from "./intl-list-format.ts";
import { installSegmenterIntrinsic } from "./intl-segmenter.ts";
import {
  createRuntimeError,
  rejectUnsupportedExecution,
  type ErrorRealm,
} from "./errors.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";

/** Locale algorithms and timezone enumeration do not call host Intl services. */
export function installIntlIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const intl = createObject<ScriptPropertyKey, unknown>(realm.objectPrototype);
  installLocaleIntrinsic(intl, realm, hooks);
  installListFormatIntrinsic(intl, realm, hooks);
  installSegmenterIntrinsic(intl, realm, hooks);
  installCollatorIntrinsic(intl, realm, hooks);
  installPluralRulesIntrinsic(intl, realm, hooks);
  installNumberFormatIntrinsic(intl, realm, hooks);
  installRelativeTimeFormatIntrinsic(intl, realm, hooks);
  installDateTimeFormatIntrinsic(intl, realm, hooks);
  installDurationFormatIntrinsic(intl, realm, hooks);
  installDisplayNamesIntrinsic(intl, realm, hooks);
  builtinProperty(
    intl,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Intl",
    false,
    true,
    hooks,
  );
  builtinProperty(
    intl,
    "getCanonicalLocales",
    builtinFunction(
      realm.functionPrototype,
      "getCanonicalLocales",
      1,
      (receiver, args): unknown =>
        createStringArrayFromList(
          canonicalLocaleList(args[0], realm, hooks),
          realm,
          hooks,
        ),
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(
    intl,
    "supportedValuesOf",
    builtinFunction(
      realm.functionPrototype,
      "supportedValuesOf",
      1,
      (receiver, args): unknown => {
        const key = stringValue(args[0], hooks, realm);
        if (key.error === "unsupported")
          return rejectUnsupportedExecution(realm);
        if (key.error !== "none") throw createRuntimeError(realm, "type");
        if (key.value === "numberingSystem") {
          const data = numberFormatLocaleData(runtimeDefaultLocale);
          if (data === undefined)
            throw "NUMBERING_SYSTEM_AVAILABILITY_INVARIANT";
          return createStringArrayFromList(data.numberingSystems, realm, hooks);
        }
        // Only calendars with their own algorithms: DateTimeFormat resolves
        // "islamic" and "islamic-rgsa" to "islamic-civil", so listing them
        // would contradict that service's resolved calendar.
        if (key.value === "calendar") {
          const calendars: string[] = [];
          for (const calendar of availableLocaleCalendars()) {
            if (calendar === undefined) throw "INTL_CALENDAR_INVARIANT";
            if (calendarAlgorithmsAvailable(calendar)) calendars.push(calendar);
          }
          return createStringArrayFromList(calendars, realm, hooks);
        }
        if (key.value === "collation")
          return createStringArrayFromList(availableCollations(), realm, hooks);
        if (key.value === "currency")
          return createStringArrayFromList(
            availableCurrencyCodes(),
            realm,
            hooks,
          );
        if (key.value === "unit")
          return createStringArrayFromList(
            sanctionedSimpleUnits(),
            realm,
            hooks,
          );
        if (key.value !== "timeZone") throw createRuntimeError(realm, "range");
        const available = realm.availableTimeZoneIdentifiers;
        if (available === undefined) return rejectUnsupportedExecution(realm);
        const values: unknown[] = [];
        for (const name of available()) {
          if (name === undefined) throw "INTL_TIME_ZONE_IDENTIFIER_INVARIANT";
          values.push(name);
        }
        return createArrayFromList(
          values,
          0,
          realm.arrayPrototype,
          realm,
          hooks,
        );
      },
      hooks,
    ),
    true,
    true,
    hooks,
  );
  builtinProperty(global, "Intl", intl, true, true, hooks);
}

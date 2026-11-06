import type { TzifDisambiguation } from "@tint/foundation/chrono/tzif";
import { interpretNamedZonedOffset } from "./temporal-zone-local.ts";
import {
  parseISODateTime,
  type ISODateTime,
} from "@tint/foundation/chrono/iso-date-time";
import { epochDayFromGregorian } from "@tint/foundation/chrono/gregorian-calendar";
import { createBigIntValue, type BigIntValue } from "./bigints.ts";
import { temporalDateTimeEpoch } from "./temporal-epoch.ts";
import {
  temporalTimeZone,
  type TemporalTimeZone,
} from "./temporal-time-zone.ts";
import {
  readTemporalDateFields,
  regulateISODateFields,
  mergeISODateFields,
} from "./temporal-date-fields.ts";
import { regulateTemporalTime } from "./temporal-time-conversion.ts";
import { combineTemporalDateTime } from "./temporal-date-time-conversion.ts";
import {
  requireISOCalendar,
  objectTemporalCalendarIdentifier,
} from "./temporal-coercion.ts";
import { requirePartialTemporalObject } from "./temporal-partial-object.ts";
import type { TemporalZonedDateTime } from "./temporal-zoned-date-time.ts";
import {
  temporalStringOption,
  temporalDisambiguationOption,
} from "./temporal-options.ts";
import { viewObjectValue } from "./values.ts";
import type { ObjectHooks } from "./operations.ts";
import { createRuntimeError, type ErrorRealm } from "./errors.ts";
export interface TemporalZonedInput {
  readonly epoch: BigIntValue;
  readonly zone: TemporalTimeZone;
}
/** Read independent options in their specified order, even when cloning slots. */
function readZonedOptions(
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  fallback: string = "reject",
): {
  readonly offset: string;
  readonly overflow: string;
  readonly disambiguation: TzifDisambiguation;
} {
  const disambiguation = temporalDisambiguationOption(options, realm, hooks);
  const offset = temporalStringOption(
    options,
    "offset",
    fallback,
    ["use", "ignore", "prefer", "reject"],
    realm,
    hooks,
  );
  const overflow = temporalStringOption(
    options,
    "overflow",
    "constrain",
    ["constrain", "reject"],
    realm,
    hooks,
  );
  return { offset, overflow, disambiguation };
}
/** Partial replacement preserves the receiver's zone and omitted clock fields. */
export function zonedDateTimeWith(
  receiver: TemporalZonedDateTime,
  item: unknown,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): TemporalZonedInput {
  const object = requirePartialTemporalObject(item, realm, hooks);
  const fields = readTemporalDateFields(
    object,
    item,
    "zoned-partial",
    realm,
    hooks,
    receiver.dateTime,
  );
  if (!fields.present) throw createRuntimeError(realm, "type");
  const policy = readZonedOptions(options, realm, hooks, "prefer");
  const data = combineTemporalDateTime(
    regulateISODateFields(
      mergeISODateFields(receiver.dateTime.date, fields),
      policy.overflow,
      realm,
    ),
    regulateTemporalTime(fields.time, policy.overflow, realm),
    realm,
  );
  return interpretZonedOffset(
    data,
    receiver.zone,
    fields.offsetNanoseconds ?? receiver.offsetNanoseconds,
    policy.offset,
    realm,
    policy.disambiguation,
  );
}
/** ISO strings, ordered property bags and branded cloning retain zone models. */
export function zonedDateTimeFrom(
  item: unknown,
  options: unknown,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): TemporalZonedInput {
  const object = viewObjectValue(item, realm.objectPrototype);
  if (object !== undefined) {
    const branded = object.internalTemporalZonedDateTime;
    if (branded === undefined) {
      const calendar = objectTemporalCalendarIdentifier(
        object,
        item,
        realm,
        hooks,
      );
      const fields = readTemporalDateFields(
        object,
        item,
        "zoned-date-time",
        realm,
        hooks,
        undefined,
        calendar,
      );
      const zone = fields.timeZone;
      if (zone === undefined) throw "ZONED_TIME_ZONE_INVARIANT";
      const policy = readZonedOptions(options, realm, hooks);
      requireISOCalendar(calendar, realm);
      const data = combineTemporalDateTime(
        regulateISODateFields(fields, policy.overflow, realm),
        regulateTemporalTime(fields.time, policy.overflow, realm),
        realm,
      );
      return interpretZonedOffset(
        data,
        zone,
        fields.offsetNanoseconds,
        policy.offset,
        realm,
        policy.disambiguation,
      );
    }
    readZonedOptions(options, realm, hooks);
    return {
      epoch: branded.epoch,
      zone: branded.zone,
    };
  }
  if (typeof item !== "string") throw createRuntimeError(realm, "type");
  const parsed = parseISODateTime(item),
    data = parsed.value;
  if (
    parsed.error !== "none" ||
    data === undefined ||
    data.timeZone === undefined
  )
    throw createRuntimeError(realm, "range");
  const zone = temporalTimeZone(data.timeZone, realm);
  requireISOCalendar(data.calendar, realm);
  const policy = readZonedOptions(options, realm, hooks);
  return interpretZonedOffset(
    data,
    zone,
    data.offsetNanoseconds,
    policy.offset,
    realm,
    policy.disambiguation,
    !parsed.offsetHasSeconds,
  );
}
/** Shared interpretation; only strings without explicit offset seconds use minute matching. */
export function interpretZonedOffset(
  data: ISODateTime,
  zone: TemporalTimeZone,
  supplied: number | undefined,
  policy: string,
  realm: ErrorRealm,
  mode: TzifDisambiguation = "compatible",
  matchMinutes: boolean = false,
): TemporalZonedInput {
  if (zone.kind === "named") {
    if (
      data.hasTime &&
      !data.utc &&
      supplied !== undefined &&
      policy !== "use" &&
      policy !== "ignore"
    ) {
      const day = epochDayFromGregorian(
        data.date.year,
        data.date.month,
        data.date.day,
      );
      if (day === undefined || day < -100000000 || day > 100000000)
        throw createRuntimeError(realm, "range");
    }
    return {
      epoch: createBigIntValue(
        interpretNamedZonedOffset(
          data,
          zone,
          supplied,
          policy,
          realm,
          mode,
          matchMinutes,
        ),
      ),
      zone,
    };
  }
  let offset = zone.offsetNanoseconds;
  if (data.utc) offset = 0;
  else if (supplied !== undefined && policy !== "ignore") {
    if (policy === "use") offset = supplied;
    else {
      // Offset matching checks the wall-clock day before considering candidates.
      // Exact/use/ignore paths instead validate their final interpreted instant.
      const day = epochDayFromGregorian(
        data.date.year,
        data.date.month,
        data.date.day,
      );
      if (day === undefined || day < -100000000 || day > 100000000)
        throw createRuntimeError(realm, "range");
      if (policy === "reject" && supplied !== zone.offsetNanoseconds)
        throw createRuntimeError(realm, "range");
    }
  }
  const epoch = temporalDateTimeEpoch(data, offset);
  if (epoch === undefined) throw createRuntimeError(realm, "range");
  return { epoch: createBigIntValue(epoch), zone };
}

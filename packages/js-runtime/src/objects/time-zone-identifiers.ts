import {
  lookupTimeZoneIdentifier,
  type TimeZoneIdentifiers,
} from "@tint/foundation/chrono/time-zone-identifiers";
import { timeZonePrimaryMappings } from "./time-zone-primary-data.ts";

export interface NamedTimeZoneIdentifier {
  readonly identifier: string;
  /** Undefined means the database name exists but its language-level primary policy is unavailable. */
  readonly primaryIdentifier: string | undefined;
  readonly dataIdentifier: string;
}
function mappedPrimary(identifier: string): string | undefined {
  let low = 0,
    high = timeZonePrimaryMappings.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2),
      row = timeZonePrimaryMappings[middle];
    if (row === undefined) throw "TIME_ZONE_PRIMARY_TABLE_INVARIANT";
    const separator = row.indexOf("|"),
      name = row.slice(0, separator);
    if (identifier < name) high = middle;
    else if (identifier > name) low = middle + 1;
    else return row.slice(separator + 1);
  }
  return undefined;
}
/** Separate language primary identity from the database file used for transitions.
 * CLDR supplies country exceptions and aliases; never invent an unavailable rename. */
export function resolveNamedTimeZoneIdentifier(
  index: TimeZoneIdentifiers,
  input: string,
): NamedTimeZoneIdentifier | undefined {
  const entry = lookupTimeZoneIdentifier(index, input);
  if (entry === undefined) return undefined;
  const mapped = mappedPrimary(entry.identifier);
  let primary =
    mapped ??
    (entry.identifier === entry.targetIdentifier
      ? entry.identifier
      : undefined);
  if (
    primary !== undefined &&
    primary !== "UTC" &&
    lookupTimeZoneIdentifier(index, primary) === undefined
  )
    primary = undefined;
  return {
    identifier: entry.identifier,
    primaryIdentifier: primary,
    dataIdentifier: entry.targetIdentifier,
  };
}

/** ECMA-402 primary names, independent of alias spelling and transition storage. */
export function primaryTimeZoneIdentifiers(
  index: TimeZoneIdentifiers,
): readonly string[] {
  const names: string[] = ["UTC"];
  const seen = new Set<string>();
  seen.add("UTC");
  for (const entry of index.entries) {
    if (entry === undefined) throw "TIME_ZONE_IDENTIFIER_INVARIANT";
    const resolved = resolveNamedTimeZoneIdentifier(index, entry.identifier);
    if (resolved === undefined) throw "TIME_ZONE_IDENTIFIER_INVARIANT";
    if (
      resolved.identifier === resolved.primaryIdentifier &&
      !seen.has(resolved.identifier)
    ) {
      seen.add(resolved.identifier);
      names.push(resolved.identifier);
    }
  }
  names.sort((one, two): number => (one < two ? -1 : one > two ? 1 : 0));
  return names;
}

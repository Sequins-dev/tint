import {
  createTzifZone,
  type TzifZone,
  type TzifZoneError,
} from "@tint/foundation/chrono/tzif";
import type { TimeZoneIdentifiers } from "@tint/foundation/chrono/time-zone-identifiers";
import {
  resolveNamedTimeZoneIdentifier,
  type NamedTimeZoneIdentifier,
} from "./time-zone-identifiers.ts";

type ZoneDataResult =
  | { readonly ok: true; readonly value: TzifZone }
  | { readonly ok: false; readonly error: TzifZoneError | "MISSING_DATA" };
export type NamedTimeZoneLookup =
  | { readonly status: "unknown" }
  | {
      readonly status: "unavailable";
      readonly error: TzifZoneError | "MISSING_DATA";
    }
  | {
      readonly status: "available";
      readonly identifier: NamedTimeZoneIdentifier;
      readonly zone: TzifZone;
    };
export interface NamedTimeZoneProvider {
  readonly lookup: (identifier: string) => NamedTimeZoneLookup;
}

/** Agent-owned immutable database view. The host supplies bounded reads of safe,
 * validated database targets; neither language identity nor file policy is inferred
 * from the bytes. Failed data reads are cached alongside successful models. */
export function createNamedTimeZoneProvider(
  identifiers: TimeZoneIdentifiers,
  read: (dataIdentifier: string) => Uint8Array | undefined,
): NamedTimeZoneProvider {
  const cache = new Map<string, ZoneDataResult>();
  function data(key: string): ZoneDataResult {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const bytes = read(key);
    const loaded: ZoneDataResult =
      bytes === undefined
        ? { ok: false, error: "MISSING_DATA" }
        : createTzifZone(bytes, "stored");
    cache.set(key, loaded);
    return loaded;
  }
  return {
    lookup: (input): NamedTimeZoneLookup => {
      const identifier = resolveNamedTimeZoneIdentifier(identifiers, input);
      if (identifier === undefined) return { status: "unknown" };
      const cached = data(identifier.dataIdentifier);
      if (!cached.ok) return { status: "unavailable", error: cached.error };
      return { status: "available", identifier, zone: cached.value };
    },
  };
}

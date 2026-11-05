import {
  tzifOffsetSecondsAt,
  resolveTzifLocalSeconds,
  type TzifZone,
} from "@tint/foundation/chrono/tzif";
import { rejectUnsupportedExecution, type ErrorRealm } from "./errors.ts";
/** Bind both directions to the same immutable zone model. Subsecond fields stay
 * separate from integral-second transition lookup, including negative epochs. */
export function installDateTimeZone(realm: ErrorRealm, zone: TzifZone): void {
  // Language policy uses the stored offset for unspecified civil prehistory.
  // Preserve the generic model and its raw designation for diagnostics.
  const model: TzifZone = { ...zone, unspecifiedOffsetPolicy: "stored" };
  realm.localTimeOffsetSeconds = (second): number => {
    const offset = tzifOffsetSecondsAt(model, second);
    return offset === undefined ? rejectUnsupportedExecution(realm) : offset;
  };
  realm.localTimeToUTC = (milliseconds): number => {
    if (!Number.isSafeInteger(milliseconds)) return NaN;
    const second = Math.floor(milliseconds / 1000),
      remainder = milliseconds - second * 1000;
    const resolved = resolveTzifLocalSeconds(model, second);
    if (!resolved.ok) {
      if (resolved.error === "invalid") return NaN;
      return rejectUnsupportedExecution(realm);
    }
    return resolved.epochSeconds * 1000 + remainder;
  };
}

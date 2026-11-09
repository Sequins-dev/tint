import { installTemporalLocaleStrings } from "./temporal-locale-string.ts";
import { installTemporalNow } from "./temporal-now.ts";
import { installTemporalInstant } from "./temporal-instant.ts";
import { installTemporalPlainTime } from "./temporal-plain-time.ts";
import { installTemporalZonedDateTime } from "./temporal-zoned-date-time.ts";
import { installTemporalPartialDates } from "./temporal-partial-date.ts";
import { installTemporalPlainDateTime } from "./temporal-plain-date-time.ts";
import {
  createObject,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { builtinProperty } from "./intrinsics.ts";
import type { ErrorRealm } from "./errors.ts";
import { wellKnownSymbol, type ScriptPropertyKey } from "./symbols.ts";
import { installTemporalPlainDate } from "./temporal-plain-date.ts";
import { installTemporalDuration } from "./temporal-duration.ts";
/** Realm-owned Temporal namespace; each constructor keeps its own semantic adapter. */
export function installTemporalIntrinsics(
  global: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): void {
  const temporal = createObject<ScriptPropertyKey, unknown>(
    realm.objectPrototype,
  );
  builtinProperty(
    temporal,
    wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
    "Temporal",
    false,
    true,
    hooks,
  );
  installTemporalPlainDate(temporal, realm, hooks);
  installTemporalInstant(temporal, realm, hooks);
  installTemporalDuration(temporal, realm, hooks);
  installTemporalPlainDateTime(temporal, realm, hooks);
  installTemporalPlainTime(temporal, realm, hooks);
  installTemporalPartialDates(temporal, realm, hooks);
  installTemporalZonedDateTime(temporal, realm, hooks);
  installTemporalNow(temporal, realm, hooks);
  installTemporalLocaleStrings(realm, hooks);
  builtinProperty(global, "Temporal", temporal, true, true, hooks);
}

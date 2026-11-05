import { scriptPropertyKeyOrder } from "./symbols.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import {
  createDataProperty,
  defineOwnProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
import { createArrayObject } from "./arrays.ts";
import { setIntegrityLevel } from "./integrity.ts";
import type { ErrorRealm } from "./errors.ts";
import type { ScriptRecord } from "./jobs.ts";
import { emptyUpdate, valueField } from "../descriptors/index.ts";

/** Identity belongs to a parsed source location, not its string contents. */
export interface TemplateSite {
  readonly cooked: readonly (string | undefined)[];
  readonly raw: readonly string[];
}
export interface TemplateCacheEntry {
  readonly site: TemplateSite;
  readonly value: OrdinaryObject<ScriptPropertyKey, unknown>;
}

/** Managed entries initialize their parsed sites in ordinal order. A fresh
 * carrier belongs to each parse, including evals sharing an effective referrer.
 * Text is recipe data; neither equal text nor a shared recipe grants identity. */
export function getScriptTemplateSite(
  owner: ScriptRecord,
  index: number,
  recipe: TemplateSite,
): TemplateSite {
  if (index < 0 || index !== Math.trunc(index))
    throw "TEMPLATE_SITE_INDEX_INVARIANT";
  const sites = owner.templateSites;
  if (index < sites.length) {
    const site = sites[index];
    if (site === undefined) throw "TEMPLATE_SITE_CACHE_INVARIANT";
    return site;
  }
  if (index !== sites.length) throw "TEMPLATE_SITE_ORDER_INVARIANT";
  const site: TemplateSite = { cooked: recipe.cooked, raw: recipe.raw };
  sites.push(site);
  return site;
}

/** Realm-owned caches avoid retaining a realm through a process-global site. */
export function getTemplateObject(
  site: TemplateSite,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
): OrdinaryObject<ScriptPropertyKey, unknown> {
  for (const entry of realm.templateObjects) {
    if (entry === undefined) throw "TEMPLATE_CACHE_INVARIANT";
    if (entry.site === site) return entry.value;
  }
  const length = site.cooked.length;
  if (length === 0 || site.raw.length !== length)
    throw "TEMPLATE_SITE_INVARIANT";
  const cooked = createArrayObject<ScriptPropertyKey, unknown>(
    length,
    realm.arrayPrototype,
    realm.arrayHooks,
    hooks,
  );
  const raw = createArrayObject<ScriptPropertyKey, unknown>(
    length,
    realm.arrayPrototype,
    realm.arrayHooks,
    hooks,
  );
  for (let i = 0; i < length; i++) {
    const text = site.raw[i];
    if (text === undefined) throw "TEMPLATE_RAW_INVARIANT";
    if (
      !createDataProperty<ScriptPropertyKey, unknown>(
        cooked,
        String(i),
        site.cooked[i],
        hooks,
      ) ||
      !createDataProperty<ScriptPropertyKey, unknown>(
        raw,
        String(i),
        text,
        hooks,
      )
    )
      throw "TEMPLATE_ELEMENT_INVARIANT";
  }
  setIntegrityLevel<ScriptPropertyKey, unknown>(
    raw,
    true,
    hooks,
    scriptPropertyKeyOrder,
  );
  if (
    defineOwnProperty<ScriptPropertyKey, unknown>(
      cooked,
      "raw",
      {
        ...emptyUpdate<unknown>(undefined),
        fields: valueField,
        value: raw,
      },
      hooks,
    ) !== "accepted"
  )
    throw "TEMPLATE_RAW_PROPERTY_INVARIANT";
  setIntegrityLevel<ScriptPropertyKey, unknown>(
    cooked,
    true,
    hooks,
    scriptPropertyKeyOrder,
  );
  realm.templateObjects.push({ site, value: cooked });
  return cooked;
}

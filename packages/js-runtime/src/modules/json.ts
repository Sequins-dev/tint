import { parseJSONText } from "@tint/foundation/text/json-syntax";
import { parseJSON } from "../objects/json-parse.ts";
import { createRuntimeError, type ErrorRealm } from "../objects/errors.ts";
import type { ObjectHooks } from "../objects/operations.ts";
import type { ModuleCompletion } from "./loading.ts";
import {
  createSyntheticModule,
  setSyntheticModuleExport,
} from "./synthetic.ts";

/** JSON syntax is checked before creating the record. Runtime realization and
 * invariant failures propagate to the host rather than becoming loading errors. */
export function parseJSONModule(
  source: string,
  realm: ErrorRealm,
  hooks: ObjectHooks<unknown>,
  hostDefined: unknown,
): ModuleCompletion {
  if (parseJSONText(source).node === undefined)
    return { ok: false, error: createRuntimeError(realm, "syntax") };
  const value = parseJSON(source, undefined, realm, hooks);
  return {
    ok: true,
    module: createSyntheticModule(
      realm,
      ["default"],
      (module) => setSyntheticModuleExport(module, "default", value),
      hostDefined,
    ),
  };
}

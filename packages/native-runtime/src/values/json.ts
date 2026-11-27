import {
  installProgramArrayIntrinsics,
  installProgramConstructorGroup,
  installProgramObjectIntrinsics,
  parseJSON,
  programRealmCore,
  quoteJSONString,
  stringifyJSON,
  tryParseJSONStringLiteral,
  type ProgramRealmCore,
} from "@tint/js-runtime/objects";

let jsonCore: ProgramRealmCore | undefined = undefined;

function ensureJSONRealm(): ProgramRealmCore {
  const cached = jsonCore;
  if (cached !== undefined) return cached;
  const core = programRealmCore();
  installProgramObjectIntrinsics(core);
  installProgramArrayIntrinsics(core);
  installProgramConstructorGroup(core, "installErrorIntrinsics");
  jsonCore = core;
  return core;
}

/** Typed `JSON.stringify(value, replacer?, space?)` backed by the program realm. */
export function jsonStringify(
  value: unknown,
  replacer: unknown,
  space: unknown,
): string | undefined {
  if ((replacer === undefined || replacer === null) && space === undefined) {
    if (typeof value === "string") return quoteJSONString(value);
    if (typeof value === "number")
      return Number.isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value === null) return "null";
    if (value === undefined) return undefined;
  }
  const core = ensureJSONRealm();
  return stringifyJSON(value, replacer, space, core.realm, core.hooks);
}

/** Typed `JSON.parse(text, reviver?)` backed by the program realm. */
export function jsonParse(input: unknown, reviver: unknown): unknown {
  if (
    typeof input === "string" &&
    (reviver === undefined || reviver === null)
  ) {
    const fast = tryParseJSONStringLiteral(input);
    if (fast !== undefined) return fast;
  }
  const core = ensureJSONRealm();
  return parseJSON(input, reviver, core.realm, core.hooks);
}

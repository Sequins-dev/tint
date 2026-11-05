import type { RegExpFlags, RegExpResult } from "./model.ts";
export function parseRegExpFlags(text: string): RegExpResult<RegExpFlags> {
  const seen = new Set<string>();
  for (let i = 0; i < text.length; i++) {
    const flag = text.charAt(i);
    if (!"dgimsuvy".includes(flag) || seen.has(flag))
      return {
        ok: false,
        error: {
          kind: "syntax",
          source: "flags",
          offset: i,
          message: "invalid or repeated regular expression flag",
        },
      };
    if ((flag === "u" && seen.has("v")) || (flag === "v" && seen.has("u")))
      return {
        ok: false,
        error: {
          kind: "syntax",
          source: "flags",
          offset: i,
          message: "u and v flags are mutually exclusive",
        },
      };
    seen.add(flag);
  }
  return {
    ok: true,
    value: {
      indices: seen.has("d"),
      global: seen.has("g"),
      ignoreCase: seen.has("i"),
      multiline: seen.has("m"),
      dotAll: seen.has("s"),
      unicode: seen.has("u"),
      unicodeSets: seen.has("v"),
      sticky: seen.has("y"),
    },
  };
}

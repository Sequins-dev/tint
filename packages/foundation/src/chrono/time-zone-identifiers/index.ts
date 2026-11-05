import { createScanner } from "../../text/text-scanner.ts";

/** Database spelling and terminal zic Zone target, not ECMA-402 primary-zone policy. */
export interface TimeZoneIdentifier {
  readonly identifier: string;
  readonly targetIdentifier: string;
}
export interface TimeZoneIdentifiers {
  readonly entries: readonly TimeZoneIdentifier[];
  readonly find: (identifier: string) => TimeZoneIdentifier | undefined;
}
export type TimeZoneIdentifierResult =
  | { readonly ok: true; readonly value: TimeZoneIdentifiers }
  | {
      readonly ok: false;
      readonly error:
        | "INVALID_RECORD"
        | "DUPLICATE_IDENTIFIER"
        | "MISSING_TARGET"
        | "LINK_CYCLE";
      readonly line: number;
    };
interface Declaration {
  readonly identifier: string;
  readonly target: string | undefined;
  readonly line: number;
}
/** Keep identifiers relative and ASCII; they can safely name entries in a host-owned root. */
function validIdentifier(value: string): boolean {
  if (value.length === 0) return false;
  for (const component of value.split("/")) {
    if (
      component === undefined ||
      component === "" ||
      component === "." ||
      component === ".."
    )
      return false;
    for (let index = 0; index < component.length; index++) {
      const code = component.charCodeAt(index);
      if (!(
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        code === 95 ||
        code === 45 ||
        code === 43 ||
        code === 46
      ))
        return false;
    }
  }
  return true;
}
/** Identifier grammar is ASCII. Do not introduce Unicode or locale equivalences. */
function identifierKey(value: string): string {
  const pieces: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    pieces.push(
      String.fromCharCode(code >= 65 && code <= 90 ? code + 32 : code),
    );
  }
  return pieces.join("");
}
function whitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 13;
}

/** Read Zone/Link records from standard or compact zic input. Rules and continuation
 * records are intentionally ignored: transition data remains the TZif reader's job. */
export function readTimeZoneIdentifiers(
  text: string,
): TimeZoneIdentifierResult {
  const declarations = new Map<string, Declaration>();
  let lineNumber = 0;
  for (const line of text.split("\n")) {
    lineNumber++;
    if (line === undefined) throw "ZONE_INDEX_LINE_INVARIANT";
    const scanner = createScanner(line);
    function token(): string {
      scanner.eatWhile(whitespace);
      return scanner.eatWhile(
        (code): boolean => !whitespace(code) && code !== 35,
      );
    }
    const kind = token();
    const zone = kind === "Z" || kind === "Zone";
    const link = kind === "L" || kind === "Link";
    if (!zone && !link) continue;
    const first = token(),
      identifier = link ? token() : first;
    if (
      !validIdentifier(identifier) ||
      (link && (!validIdentifier(first) || token() !== "")) ||
      (zone && token() === "")
    )
      return { ok: false, error: "INVALID_RECORD", line: lineNumber };
    const key = identifierKey(identifier);
    if (declarations.has(key))
      return { ok: false, error: "DUPLICATE_IDENTIFIER", line: lineNumber };
    declarations.set(key, {
      identifier,
      target: link ? identifierKey(first) : undefined,
      line: lineNumber,
    });
  }
  const targets = new Map<string, string>();
  const entries: TimeZoneIdentifier[] = [];
  const lookup = new Map<string, TimeZoneIdentifier>();
  for (const [key, declaration] of declarations) {
    const path: string[] = [],
      seen = new Set<string>();
    let current = key;
    let target = targets.get(current);
    while (target === undefined) {
      if (seen.has(current))
        return { ok: false, error: "LINK_CYCLE", line: declaration.line };
      seen.add(current);
      path.push(current);
      const item = declarations.get(current);
      if (item === undefined)
        return { ok: false, error: "MISSING_TARGET", line: declaration.line };
      if (item.target === undefined) {
        target = item.identifier;
        break;
      }
      current = item.target;
      target = targets.get(current);
    }
    const resolvedTarget = target;
    if (resolvedTarget === undefined) throw "ZONE_INDEX_TARGET_INVARIANT";
    for (const name of path) {
      if (name === undefined) throw "ZONE_INDEX_PATH_INVARIANT";
      targets.set(name, resolvedTarget);
    }
    const entry = {
      identifier: declaration.identifier,
      targetIdentifier: resolvedTarget,
    };
    entries.push(entry);
    lookup.set(key, entry);
  }
  entries.sort((a, b): number =>
    a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0,
  );
  return {
    ok: true,
    value: {
      entries,
      find: (identifier): TimeZoneIdentifier | undefined =>
        validIdentifier(identifier)
          ? lookup.get(identifierKey(identifier))
          : undefined,
    },
  };
}
export function lookupTimeZoneIdentifier(
  index: TimeZoneIdentifiers,
  identifier: string,
): TimeZoneIdentifier | undefined {
  return index.find(identifier);
}

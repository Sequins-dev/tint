/** Restricted extraction from checksum-pinned CLDR XML, not a general XML API. */
export function xmlText(text: string): string {
  const entities = /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/g;
  if (text.replace(entities, "").includes("&") || text.includes("<"))
    throw new Error("Unsupported CLDR text markup");
  return text.replace(entities, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    const point = entity.startsWith("&#x")
      ? parseInt(entity.slice(3, -1), 16)
      : Number(entity.slice(2, -1));
    if (
      !Number.isInteger(point) ||
      point < 0 ||
      point > 0x10ffff ||
      (point >= 0xd800 && point <= 0xdfff)
    )
      throw new Error("Invalid XML character reference");
    return String.fromCodePoint(point);
  });
}
export function attributes(text: string): Map<string, string> {
  return new Map(
    [...text.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map((match) => [
      match[1]!,
      xmlText(match[2]!),
    ]),
  );
}

export interface CldrElement {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: CldrElement[];
  text: string;
  readonly parent: CldrElement | undefined;
}
/** Parse the element/text subset used by pinned CLDR; never expand external DTDs. */
export function parseCldrElements(text: string): CldrElement {
  const document: CldrElement = {
    name: "document",
    attributes: new Map(),
    children: [],
    text: "",
    parent: undefined,
  };
  const stack = [document];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf("<", cursor),
      current = stack.at(-1)!;
    if (open < 0) {
      current.text += xmlText(text.slice(cursor));
      break;
    }
    current.text += xmlText(text.slice(cursor, open));
    if (text.startsWith("<!--", open) || text.startsWith("<?", open)) {
      const comment = text.startsWith("<!--", open),
        terminator = comment ? "-->" : "?>";
      const end = text.indexOf(terminator, open + (comment ? 4 : 2));
      if (end < 0)
        throw Error("Unclosed CLDR XML comment or processing instruction");
      cursor = end + terminator.length;
      continue;
    }
    let end = open + 1,
      quote = "",
      brackets = 0;
    for (; end < text.length; end++) {
      const character = text.charAt(end);
      if (quote !== "") {
        if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      else if (character === "[") brackets++;
      else if (character === "]") brackets--;
      else if (character === ">" && brackets === 0) break;
    }
    if (end >= text.length) throw Error("Unclosed CLDR XML tag");
    const body = text.slice(open + 1, end);
    cursor = end + 1;
    if (/^!DOCTYPE\s/.test(body)) continue;
    if (body.startsWith("!")) throw Error("Unsupported CLDR XML declaration");
    if (body.startsWith("/")) {
      const closed = stack.pop();
      if (stack.length === 0 || closed?.name !== body.slice(1).trim())
        throw Error("Mismatched CLDR XML tag");
      continue;
    }
    const selfClosing = /\/\s*$/.test(body),
      content = selfClosing ? body.replace(/\/\s*$/, "") : body;
    const match = /^([A-Za-z][\w:.-]*)([\s\S]*)$/.exec(content);
    if (match === null) throw Error("Invalid CLDR XML element name");
    const parent = stack.at(-1)!;
    const node: CldrElement = {
      name: match[1]!,
      attributes: attributes(match[2]!),
      children: [],
      text: "",
      parent,
    };
    parent.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (
    stack.length !== 1 ||
    document.children.length !== 1 ||
    document.text.trim() !== ""
  )
    throw Error("Invalid CLDR XML document shape");
  return document.children[0]!;
}
export interface CldrPathStep {
  readonly name: string;
  readonly attributes: readonly (readonly [string, string])[];
}
const distinguishingAttributes = [
  "type",
  "id",
  "count",
  "choice",
  "numberSystem",
  "yeartype",
  "case",
  "gender",
];
// LDML declares these four type attributes with the default "standard".
// Normalize both XML nodes and alias selectors so an omitted default is equal
// to an explicit one without treating unrelated distinguishing attributes alike.
function explicitAttributes(
  name: string,
  values: readonly (readonly [string, string])[],
): readonly (readonly [string, string])[] {
  return values.filter(
    ([key, value]) =>
      !(
        key === "type" &&
        value === "standard" &&
        ["dateFormat", "timeFormat", "dateTimeFormat", "pattern"].includes(name)
      ),
  );
}
function elementStep(node: CldrElement): CldrPathStep {
  return {
    name: node.name,
    attributes: explicitAttributes(
      node.name,
      [...node.attributes]
        .filter(([key]) => distinguishingAttributes.includes(key))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };
}
function elementPath(node: CldrElement): CldrPathStep[] {
  const path: CldrPathStep[] = [];
  for (
    let current = node;
    current.parent?.name !== "document";
    current = current.parent!
  )
    path.push(elementStep(current));
  return path.reverse();
}
function pathParts(expression: string): (CldrPathStep | "." | "..")[] {
  const segments: string[] = [];
  let start = 0,
    quote = "",
    brackets = 0;
  for (let index = 0; index <= expression.length; index++) {
    const character = expression.charAt(index);
    if (quote !== "") {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "[") brackets++;
    else if (character === "]") {
      brackets--;
      if (brackets < 0) throw Error("Invalid CLDR alias selector");
    } else if (
      (character === "/" && brackets === 0) ||
      index === expression.length
    ) {
      const part = expression.slice(start, index);
      if (part !== "") segments.push(part);
      start = index + 1;
    }
  }
  if (brackets !== 0 || quote !== "")
    throw Error("Unclosed CLDR alias selector");
  return segments.map((part) => {
    if (part === "." || part === "..") return part;
    const name = /^[A-Za-z][\w:.-]*/.exec(part)?.[0];
    if (name === undefined) throw Error("Invalid CLDR alias path name");
    const values: [string, string][] = [];
    let remaining = part.slice(name.length);
    while (remaining !== "") {
      const predicate = /^\[@([\w]+)=(?:'([^']*)'|"([^"]*)")\]/.exec(remaining);
      if (predicate === null)
        throw Error("Unsupported CLDR alias path selector");
      values.push([predicate[1]!, predicate[2] ?? predicate[3]!]);
      remaining = remaining.slice(predicate[0].length);
    }
    values.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return { name, attributes: explicitAttributes(name, values) };
  });
}
/** Resolve the restricted LDML alias path grammar, including slashes in attributes. */
export function resolveCldrAliasPath(
  context: readonly CldrPathStep[],
  expression: string,
): CldrPathStep[] {
  const result = expression.startsWith("/") ? [] : [...context];
  for (const part of pathParts(expression)) {
    if (part === ".") continue;
    if (part === "..") {
      if (result.length === 0) throw Error("CLDR alias above document root");
      result.pop();
    } else result.push(part);
  }
  if (result[0]?.name === "ldml") result.shift();
  return result;
}
export function cldrPath(expression: string): CldrPathStep[] {
  return resolveCldrAliasPath([], expression);
}
function matchesStep(node: CldrElement, wanted: CldrPathStep): boolean {
  if (node.name !== wanted.name || node.attributes.has("alt")) return false;
  const actual = elementStep(node).attributes;
  return (
    actual.length === wanted.attributes.length &&
    wanted.attributes.every(([key, value]) =>
      actual.some(
        ([actualKey, actualValue]) =>
          key === actualKey && value === actualValue,
      ),
    )
  );
}
export interface CldrLocaleResolver {
  readonly value: (
    locale: string,
    path: readonly CldrPathStep[],
  ) => string | undefined;
  /** Data generators clear between locale batches rather than retain all lookups. */
  readonly clear: () => void;
}
/** An inherited source="locale" alias still resolves in the requested locale. */
export function createCldrLocaleResolver(
  locales: ReadonlyMap<string, CldrElement>,
  parent: (locale: string) => string | undefined,
): CldrLocaleResolver {
  const cache = new Map<string, string | undefined>();
  function resolve(
    locale: string,
    path: readonly CldrPathStep[],
    active: Set<string>,
  ): string | undefined {
    const key = locale + "|" + JSON.stringify(path);
    if (cache.has(key)) return cache.get(key);
    if (active.has(key)) throw Error("CLDR alias cycle: " + key);
    active.add(key);
    const visited = new Set<string>();
    let current: string | undefined = locale;
    function aliasValue(
      node: CldrElement,
      remaining: readonly CldrPathStep[],
    ): { value: string | undefined } | undefined {
      const alias = node.children.find((child) => child.name === "alias");
      if (alias === undefined) return undefined;
      const source = alias.attributes.get("source"),
        target = alias.attributes.get("path");
      if (source === undefined || target === undefined)
        throw Error("Invalid CLDR alias record");
      return {
        value: resolve(
          source === "locale" ? locale : source,
          [...resolveCldrAliasPath(elementPath(node), target), ...remaining],
          active,
        ),
      };
    }
    while (current !== undefined) {
      if (visited.has(current)) throw Error("CLDR parent cycle: " + current);
      visited.add(current);
      let node = locales.get(current);
      if (node !== undefined) {
        let index = 0;
        for (; index < path.length; index++) {
          const aliased = aliasValue(node, path.slice(index));
          if (aliased !== undefined) {
            active.delete(key);
            cache.set(key, aliased.value);
            return aliased.value;
          }
          const child: CldrElement | undefined = node.children.find((child) =>
            matchesStep(child, path[index]!),
          );
          if (child === undefined) break;
          node = child;
        }
        if (index === path.length) {
          const aliased = aliasValue(node, []);
          if (aliased !== undefined) {
            active.delete(key);
            cache.set(key, aliased.value);
            return aliased.value;
          }
          if (node.children.length === 0 && node.text !== "↑↑↑") {
            const value = node.text === "∅∅∅" ? "" : node.text;
            active.delete(key);
            cache.set(key, value);
            return value;
          }
        }
      }
      current = parent(current);
    }
    active.delete(key);
    cache.set(key, undefined);
    return undefined;
  }
  return {
    value: (locale, path) => resolve(locale, path, new Set()),
    clear: () => cache.clear(),
  };
}

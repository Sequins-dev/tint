export interface LocaleLanguage {
  readonly language: string;
  readonly script: string;
  readonly region: string;
  readonly variants: readonly string[];
}

export interface LocaleField {
  readonly key: string;
  readonly value: string;
}

export interface LocaleExtension {
  readonly key: string;
  readonly subtags: readonly string[];
  readonly attributes: readonly string[];
  readonly fields: readonly LocaleField[];
  readonly language: LocaleLanguage | undefined;
}

export interface LocaleId {
  readonly language: LocaleLanguage;
  readonly extensions: readonly LocaleExtension[];
}

export interface LocaleData {
  readonly locale: string;
  readonly keywords: readonly LocaleField[];
}

function letters(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 97 || code > 122) return false;
  }
  return true;
}

function digits(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function tokenAt(tokens: readonly string[], index: number): string {
  return tokens[index] ?? "";
}

function languageSubtag(value: string): boolean {
  return (
    letters(value) &&
    (value.length === 2 ||
      value.length === 3 ||
      (value.length >= 5 && value.length <= 8))
  );
}

function variantSubtag(value: string): boolean {
  return (
    (value.length >= 5 && value.length <= 8) ||
    (value.length === 4 && digits(value.slice(0, 1)))
  );
}

function typeSubtag(value: string): boolean {
  return value.length >= 3 && value.length <= 8;
}

function transformedKey(value: string): boolean {
  return (
    value.length === 2 && letters(value.slice(0, 1)) && digits(value.slice(1))
  );
}

/** All tokens have already been checked for ASCII alphanumeric content. */
function parseLanguage(
  tokens: readonly string[],
  start: number,
):
  | {
      readonly language: LocaleLanguage;
      readonly end: number;
    }
  | undefined {
  let index = start;
  const language = tokenAt(tokens, index++);
  if (!languageSubtag(language)) return undefined;
  let script = "",
    region = "";
  const next = tokenAt(tokens, index);
  if (next.length === 4 && letters(next)) {
    script = next;
    index++;
  }
  const territory = tokenAt(tokens, index);
  if (
    (territory.length === 2 && letters(territory)) ||
    (territory.length === 3 && digits(territory))
  ) {
    region = territory;
    index++;
  }
  const variants: string[] = [];
  while (variantSubtag(tokenAt(tokens, index))) {
    const value = tokenAt(tokens, index++);
    if (variants.includes(value)) return undefined;
    variants.push(value);
  }
  return { language: { language, script, region, variants }, end: index };
}

function parseExtension(
  key: string,
  parts: readonly string[],
): LocaleExtension | undefined {
  const attributes: string[] = [],
    fields: LocaleField[] = [];
  let language: LocaleLanguage | undefined;
  let index = 0;
  if (key !== "u" && key !== "t")
    return { key, subtags: parts, attributes, fields, language };
  if (key === "u") {
    while (typeSubtag(tokenAt(parts, index)))
      attributes.push(tokenAt(parts, index++));
  } else if (!transformedKey(tokenAt(parts, 0))) {
    const parsed = parseLanguage(parts, 0);
    if (parsed === undefined) return undefined;
    language = parsed.language;
    index = parsed.end;
  }
  while (index < parts.length) {
    const field = tokenAt(parts, index++);
    if (
      key === "u"
        ? field.length !== 2 || !letters(field.slice(1))
        : !transformedKey(field)
    )
      return undefined;
    const values: string[] = [];
    while (typeSubtag(tokenAt(parts, index)))
      values.push(tokenAt(parts, index++));
    if (key === "t" && values.length === 0) return undefined;
    fields.push({ key: field, value: values.join("-") });
  }
  return { key, subtags: [], attributes, fields, language };
}

/** ECMA-402 Unicode BCP47 locale subset; not arbitrary BCP47 or CLDR syntax.
 * Parsing is ASCII-only and does not consult host locale services. */
export function parseLocaleId(source: string): LocaleId | undefined {
  if (source.length === 0) return undefined;
  let lower = "";
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (
      code !== 45 &&
      !(code >= 48 && code <= 57) &&
      !(code >= 65 && code <= 90) &&
      !(code >= 97 && code <= 122)
    )
      return undefined;
    lower += String.fromCharCode(code >= 65 && code <= 90 ? code + 32 : code);
  }
  const tokens = lower.split("-");
  const parsed = parseLanguage(tokens, 0);
  if (parsed === undefined) return undefined;
  let index = parsed.end;
  const seen: string[] = [],
    extensions: LocaleExtension[] = [];
  while (index < tokens.length) {
    const key = tokenAt(tokens, index++);
    if (key.length !== 1 || seen.includes(key)) return undefined;
    seen.push(key);
    const start = index;
    while (
      index < tokens.length &&
      (key === "x" || tokenAt(tokens, index).length !== 1)
    ) {
      const part = tokenAt(tokens, index++);
      if (part.length < (key === "x" ? 1 : 2) || part.length > 8)
        return undefined;
    }
    if (start === index) return undefined;
    const extension = parseExtension(key, tokens.slice(start, index));
    if (extension === undefined) return undefined;
    extensions.push(extension);
  }
  return { language: parsed.language, extensions };
}

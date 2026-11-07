import { implicitCollationElement } from "./collation-root-input.ts";
import { normalizeUnicode } from "@tint/foundation/unicode/normalization";
import type {
  CollationRoot,
  CollationElement,
} from "./collation-root-input.ts";
interface RuleToken {
  readonly kind: "option" | "operator" | "text";
  readonly value: string;
}
function parseRules(source: string): RuleToken[] {
  const tokens: RuleToken[] = [];
  let i = 0;
  const escape = () => {
    const kind = source[i++]!;
    if (kind === "u" || kind === "U") {
      const size = kind === "u" ? 4 : 8,
        hex = source.slice(i, i + size);
      if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== size)
        throw Error("Bad escape");
      i += size;
      return String.fromCodePoint(parseInt(hex, 16));
    }
    if (kind === undefined) throw Error("Trailing slash");
    return kind;
  };
  while (i < source.length) {
    const c = source[i++]!;
    if (/\s/.test(c)) continue;
    if (c === "#") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "[") {
      const start = i;
      let depth = 1;
      while (i < source.length && depth) {
        const x = source[i++]!;
        if (x === "[") depth++;
        if (x === "]") depth--;
      }
      if (depth) throw Error("Unclosed option");
      tokens.push({ kind: "option", value: source.slice(start, i - 1) });
      continue;
    }
    if (c === "&" || c === "=" || c === "<" || c === "/" || c === "|") {
      let value = c;
      if (c === "<") while (source[i] === "<") value += source[i++]!;
      tokens.push({ kind: "operator", value });
      continue;
    }
    let value = "";
    i--;
    while (i < source.length) {
      const x = source[i]!;
      if (/\s/.test(x) || "&=</|[#".includes(x)) break;
      i++;
      if (x === "\\") {
        value += escape();
        continue;
      }
      if (x === "'") {
        if (source[i] === "'") {
          value += "'";
          i++;
          continue;
        }
        let closed = false;
        while (i < source.length) {
          const q = source[i++]!;
          if (q === "'") {
            if (source[i] === "'") {
              value += "'";
              i++;
            } else {
              closed = true;
              break;
            }
          } else value += q === "\\" ? escape() : q;
        }
        if (!closed) throw Error("Unclosed quote");
      } else value += x;
    }
    if (!value) throw Error("Empty token " + i);
    tokens.push({ kind: "text", value });
  }
  return tokens;
}
export interface CollationTailoring {
  readonly locale: string;
  readonly type: string;
  readonly changes: readonly (readonly [string, CollationElement[] | null])[];
  readonly suppressed: readonly number[];
  readonly settings: { reorder: string[]; shifted: boolean };
}
export function compileCollationTailoring(
  root: CollationRoot,
  files: ReadonlyMap<string, string>,
  locale: string,
  type: string,
): CollationTailoring {
  const rootRows = root.rows,
    han = root.han,
    common = 1280;
  function nfd(text: string): string {
    const result = normalizeUnicode(text, "NFD");
    if (result === undefined) throw Error("Invalid normalization form");
    return result;
  }

  function rules(locale: string, type: string): string {
    if (locale === "und") locale = "root";
    let xml = files.get(locale);
    if (xml === undefined)
      throw Error("Unregistered collation input " + locale);
    const blocks = [
      ...xml.matchAll(/<collation\s+([^>]*?)>([\s\S]*?)<\/collation>/g),
    ];
    const block = blocks.find(
      (x) =>
        x[1]!.includes(
          'type="' + (type === "phonebk" ? "phonebook" : type) + '"',
        ) &&
        !x[1]!.includes("alt=") &&
        !/draft="(?:provisional|unconfirmed)"/.test(x[1]!),
    );
    if (block === undefined) {
      if (type === "standard") return "";
      if (locale !== "root") return rules("root", type);
      throw Error("Missing collation " + locale + "/" + type);
    }
    return block[2]!.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ?? "";
  }
  function clone(ces: readonly CollationElement[]): CollationElement[] {
    return ces.map((x) => [x[0], x[1], x[2]]);
  }
  function compile(locale: string, type: string): CollationTailoring {
    const rows = new Map(rootRows),
      changes = new Map<string, CollationElement[] | null>(),
      suppressed = new Set<number>(),
      settings: { reorder: string[]; shifted: boolean } = {
        reorder: [],
        shifted: false,
      },
      active = new Set<string>();
    let maximumWidth = 0;
    for (const key of rootRows.keys())
      maximumWidth = Math.max(maximumWidth, Array.from(key).length);
    function lookup(
      text: string,
      source: ReadonlyMap<string, CollationElement[]> = rows,
    ): CollationElement[] {
      text = nfd(text);
      const chars = Array.from(text);
      const result: CollationElement[] = [];
      for (let i = 0; i < chars.length;) {
        let found: CollationElement[] | undefined;
        for (let n = Math.min(maximumWidth, chars.length - i); n > 0; n--) {
          const key = chars.slice(i, i + n).join("");
          if (source.has(key)) {
            found = source.get(key);
            i += n;
            break;
          }
        }
        if (found === undefined) {
          const cp = chars[i++]!.codePointAt(0)!;
          found = [implicitCollationElement(cp, han)];
        }
        result.push(...clone(found));
      }
      return result;
    }
    function set(key: string, ces: CollationElement[]): void {
      key = nfd(key);
      rows.set(key, ces);
      changes.set(key, ces);
      maximumWidth = Math.max(maximumWidth, Array.from(key).length);
    }
    function nextWeight(
      value: number,
      level: number,
      context: CollationElement,
    ): number {
      let next = Infinity;
      for (const ces of rows.values())
        for (const ce of ces) {
          if (ce.slice(0, level).some((w, i) => w !== context[i])) continue;
          const weight = level === 2 ? ce[2] % 16384 : ce[level]!;
          if (weight > value && weight < next) next = weight;
        }
      if (!Number.isFinite(next)) next = value + 256;
      return next;
    }
    function apply(locale: string, type: string): void {
      const label = locale + "/" + type;
      if (active.has(label)) throw Error("Import cycle");
      active.add(label);
      const tokens = parseRules(rules(locale, type)),
        divisor =
          tokens.filter((t) => t.kind === "operator" && t.value[0] === "<")
            .length + 2;
      let base: CollationElement[] | undefined,
        steps: (number | undefined)[] = [undefined, undefined, undefined],
        before = 0;
      function option(value: string): void {
        if (value.startsWith("import ")) {
          const tag = value.slice(7),
            m = /^(.*)-u-co-(.*)$/.exec(tag);
          if (!m) throw Error("Import syntax " + tag);
          apply(m[1]!, m[2]!);
          return;
        }
        if (value === "normalization on") return;
        if (value === "alternate shifted") {
          settings.shifted = true;
          return;
        }
        if (value.startsWith("reorder ")) {
          settings.reorder = value.slice(8).split(/\s+/);
          return;
        }
        if (value.startsWith("suppressContractions ")) {
          const raw = value.slice(21).trim();
          if (!raw.startsWith("[") || !raw.endsWith("]"))
            throw Error("Suppress syntax");
          const expanded = raw
            .slice(1, -1)
            .replace(/\\u([0-9A-Fa-f]{4})/g, (_: string, x: string) =>
              String.fromCodePoint(parseInt(x, 16)),
            );
          const cps = Array.from(expanded).filter((x) => !/^\s$/.test(x));
          for (let i = 0; i < cps.length; i++) {
            if (cps[i + 1] === "-") {
              for (
                let cp = cps[i]!.codePointAt(0)!;
                cp <= cps[i + 2]!.codePointAt(0)!;
                cp++
              )
                suppressed.add(cp);
              i += 2;
            } else suppressed.add(cps[i]!.codePointAt(0)!);
          }
          for (const key of rows.keys())
            if (
              Array.from(key).length > 1 &&
              suppressed.has(key.codePointAt(0)!)
            ) {
              rows.delete(key);
              changes.set(key, null);
            }
          return;
        }
        throw Error("Unsupported command " + value);
      }
      for (let i = 0; i < tokens.length;) {
        const token = tokens[i++]!;
        if (token.kind === "option") {
          option(token.value);
          continue;
        }
        if (token.kind !== "operator")
          throw Error("Expected operator " + JSON.stringify(token));
        if (token.value === "&") {
          before = 0;
          if (
            tokens[i]?.kind === "option" &&
            tokens[i]!.value.startsWith("before ")
          ) {
            before = Number(tokens[i++]!.value.slice(7));
            if (before !== 1) throw Error("Before strength");
          }
          const reset = tokens[i++];
          if (
            reset?.kind === "option" &&
            reset.value === "last primary ignorable"
          ) {
            let maximum = 0;
            for (const ces of rows.values())
              for (const ce of ces)
                if (ce[0] === 0) maximum = Math.max(maximum, ce[1]);
            base = [[0, maximum, common]];
          } else if (
            reset?.kind === "option" &&
            reset.value === "last tertiary ignorable"
          )
            base = [[0, 0, 0]];
          else if (reset?.kind === "text") base = lookup(reset.value);
          else throw Error("Reset " + JSON.stringify(reset));
          steps = [undefined, undefined, undefined];
          if (before) {
            const current = base.at(-1)![0];
            let previous = 0;
            for (const ces of rows.values())
              for (const ce of ces)
                if (ce[0] < current && ce[0] > previous) previous = ce[0];
            base = [[previous, common, common]];
            steps[0] = (current - previous) / divisor;
          }
          continue;
        }
        if (token.value !== "=" && !/^<{1,3}$/.test(token.value))
          throw Error("Unexpected relation " + token.value);
        if (!base) throw Error("Relation without reset");
        const target = tokens[i++];
        if (target?.kind !== "text") throw Error("Missing relation string");
        let extension = "";
        if (tokens[i]?.value === "/") {
          i++;
          const extra = tokens[i++];
          if (extra?.kind !== "text") throw Error("Missing extension");
          extension = extra.value;
        }
        if (tokens[i]?.value === "|")
          throw Error("Tailored context not supported in selected profiles");
        const ces = clone(base);
        if (token.value !== "=") {
          const level = token.value.length - 1;
          while (
            ces.length > 1 &&
            ces
              .at(-1)!
              .slice(0, level + 1)
              .every((x) => x === 0)
          )
            ces.pop();
          const ce = ces.at(-1)!;
          let value = level === 2 ? ce[2] % 16384 : ce[level]!;
          if (steps[level] === undefined)
            steps[level] = (nextWeight(value, level, ce) - value) / divisor;
          const next = value + steps[level]!;
          if (!(next > value))
            throw Error("No weight space " + label + " " + target.value);
          ce[level] = next;
          for (let weaker = level + 1; weaker < 3; weaker++) {
            ce[weaker] = common;
            steps[weaker] = undefined;
          }
        }
        const rootCase = lookup(target.value, rootRows)
          .filter((ce) => ce[0] !== 0)
          .map((ce) => Math.floor(ce[2] / 16384));
        const primaryCEs = ces.filter((ce) => ce[0] !== 0);
        for (let n = 0; n < ces.length; n++) {
          const ce = ces[n]!;
          let bits = 0;
          if (ce[0] !== 0) {
            const index = primaryCEs.indexOf(ce);
            if (
              index === primaryCEs.length - 1 &&
              rootCase.length > primaryCEs.length
            ) {
              const rest = rootCase.slice(index);
              bits = rest.every((x) => x === 2)
                ? 2
                : rest.every((x) => x === 0)
                  ? 0
                  : 1;
            } else bits = rootCase[index] ?? 0;
          } else if (ce[1] === 0 && ce[2] !== 0) bits = 2;
          ce[2] = (ce[2] % 16384) + bits * 16384;
        }
        base = clone(ces);
        if (extension) ces.push(...lookup(extension));
        set(target.value, ces);
      }
      active.delete(label);
    }
    apply(locale, type);
    return {
      locale,
      type,
      changes: [...changes],
      suppressed: [...suppressed],
      settings,
    };
  }

  return compile(locale, type);
}

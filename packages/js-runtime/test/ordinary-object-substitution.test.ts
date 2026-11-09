import { test } from "node:test";
import assert from "node:assert/strict";
import { substituteMatch } from "../src/objects/substitution.ts";

test("replacement tokens handle numbered captures, fallback digits, and source context", () => {
  for (const replacement of [
    "$$",
    "$&",
    "$`",
    "$'",
    "$1/$2/$3",
    "$01/$02/$00",
    "$10/$12/$20/$99",
    "$<x>",
    "$",
    "$x",
    "$&$$$1",
  ]) {
    const expected = "xabz".replace(/(a)(b)?/, replacement);
    assert.equal(
      "x" +
        substituteMatch("ab", "xabz", 1, ["a", "b"], undefined, replacement) +
        "z",
      expected,
      replacement,
    );
  }
  assert.equal(
    substituteMatch("a", "a", 0, ["a", undefined], undefined, "$2/$1"),
    "/a",
  );
});
test("named replacements request each capture in order and preserve unclosed tokens", () => {
  const names: string[] = [];
  assert.equal(
    substituteMatch(
      "a",
      "a",
      0,
      [],
      (name) => {
        names.push(name);
        return name === "x" ? "42" : undefined;
      },
      "$<x>/$<missing>/$<x>/$<",
    ),
    "42//42/$<",
  );
  assert.deepEqual(names, ["x", "missing", "x"]);
});

/** Direct transcription of GetSubstitution (ECMA-262 §22.1.3.19.1). */
function referenceSubstitution(
  matched: string,
  input: string,
  position: number,
  captures: readonly (string | undefined)[],
  named: Record<string, string | undefined> | undefined,
  template: string,
): string {
  let result = "";
  let index = 0;
  while (index < template.length) {
    const rest = template.slice(index);
    if (rest.startsWith("$$")) {
      result += "$";
      index += 2;
    } else if (rest.startsWith("$`")) {
      result += input.slice(0, position);
      index += 2;
    } else if (rest.startsWith("$&")) {
      result += matched;
      index += 2;
    } else if (rest.startsWith("$'")) {
      result += input.slice(Math.min(position + matched.length, input.length));
      index += 2;
    } else if (/^\$[0-9]/.test(rest)) {
      let digits = /^\$[0-9][0-9]/.test(rest) ? 2 : 1;
      let n = Number(rest.slice(1, 1 + digits));
      if (digits === 2 && (n < 1 || n > captures.length)) {
        digits = 1;
        n = Number(rest.slice(1, 2));
      }
      if (n < 1 || n > captures.length) {
        result += rest.slice(0, 1 + digits);
      } else {
        result += captures[n - 1] ?? "";
      }
      index += 1 + digits;
    } else if (rest.startsWith("$<")) {
      const close = rest.indexOf(">");
      if (close < 0 || named === undefined) {
        result += "$<";
        index += 2;
      } else {
        result += named[rest.slice(2, close)] ?? "";
        index += close + 1;
      }
    } else {
      result += template.charAt(index);
      index += 1;
    }
  }
  return result;
}

test("substitution matches the GetSubstitution transcription across token mixes", () => {
  const alphabet = [
    "$",
    "$",
    "$",
    "&",
    "`",
    "'",
    "<",
    ">",
    "0",
    "1",
    "2",
    "9",
    "x",
    "a",
  ];
  let seed = 12345;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  for (let trial = 0; trial < 4000; trial++) {
    const captureCount = next() % 13;
    const captures: (string | undefined)[] = [];
    for (let c = 0; c < captureCount; c++)
      captures.push(c % 4 === 3 ? undefined : `c${c}`);
    const named = next() % 2 === 0 ? undefined : { a: "A", x: undefined };
    let template = "";
    const length = next() % 12;
    for (let k = 0; k < length; k++)
      template += alphabet[next() % alphabet.length];
    const expected = referenceSubstitution(
      "MID",
      "preMIDpost",
      3,
      captures,
      named,
      template,
    );
    const actual = substituteMatch(
      "MID",
      "preMIDpost",
      3,
      captures,
      named === undefined
        ? undefined
        : (name) => (named as Record<string, string | undefined>)[name],
      template,
    );
    assert.equal(
      actual,
      expected,
      JSON.stringify({ template, captureCount, named: named !== undefined }),
    );
  }
});

test("substitution returns the template itself when it has no tokens", () => {
  const template = "plain text with a lone $ at the end $";
  assert.equal(substituteMatch("m", "m", 0, [], undefined, template), template);
});

test("substitution expands many large captures without per-token copies", () => {
  const capture = "y".repeat(1 << 16);
  const template = "$1-".repeat(512);
  const result = substituteMatch("m", "m", 0, [capture], undefined, template);
  assert.equal(result.length, 512 * (capture.length + 1));
});

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

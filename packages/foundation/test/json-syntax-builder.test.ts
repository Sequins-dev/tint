import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseJSONText,
  parseJSONWith,
  type JSONBuilder,
} from "../src/text/json-syntax.ts";

// A tracing builder records construction order; values are short tags.
function tracer(log: string[]): JSONBuilder<string, string[], string[]> {
  return {
    null: (s, e) => (log.push(`null@${s}-${e}`), "null"),
    boolean: (v, s, e) => (log.push(`bool ${v}@${s}-${e}`), String(v)),
    number: (t, s, e) => (log.push(`num ${t}@${s}-${e}`), t),
    string: (v, s, e) => (log.push(`str ${v}@${s}-${e}`), JSON.stringify(v)),
    openArray: (s) => (log.push(`[@${s}`), []),
    element: (a, v) => {
      a.push(v);
    },
    closeArray: (a, s, e) => (log.push(`]@${s}-${e}`), `[${a.join(",")}]`),
    openObject: (s) => (log.push(`{@${s}`), []),
    entry: (o, k, v) => {
      o.push(`${JSON.stringify(k)}:${v}`);
    },
    closeObject: (o, s, e) => (log.push(`}@${s}-${e}`), `{${o.join(",")}}`),
  };
}
test("parseJSONWith builds values in source order with spans", () => {
  const log: string[] = [];
  const result = parseJSONWith(' {"a":[1,true],"a":null} ', tracer(log));
  assert.equal(result.ok, true);
  assert.equal(result.value, '{"a":[1,true],"a":null}');
  assert.deepEqual(log, [
    "{@1",
    "[@6",
    "num 1@7-8",
    "bool true@9-13",
    "]@6-14",
    "null@19-23",
    "}@1-24",
  ]);
});
test("parseJSONWith reports malformed input without a value", () => {
  for (const text of ["[1,2", '{"a" 1}', "01", "[1,]", '"\\x"', "nul", "1 2"]) {
    const result = parseJSONWith(text, tracer([]));
    assert.equal(result.ok, false, text);
    assert.equal(result.value, undefined, text);
    assert.equal(parseJSONText(text).node, undefined, text);
  }
});
test("parseJSONText keeps its syntax tree through the node builder", () => {
  const tree = parseJSONText('[-1.5e2,"x\\u0041",{"k":false}]').node;
  assert.deepEqual(tree, {
    kind: "array",
    start: 0,
    end: 30,
    elements: [
      { kind: "number", text: "-1.5e2", start: 1, end: 7 },
      { kind: "string", value: "xA", start: 8, end: 17 },
      {
        kind: "object",
        start: 18,
        end: 29,
        entries: [
          {
            key: "k",
            value: { kind: "boolean", value: false, start: 23, end: 28 },
          },
        ],
      },
    ],
  });
});

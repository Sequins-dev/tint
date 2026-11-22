import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import * as generality from "./general-call-bench/generality.ts";
import {
  generalCallLoopSource,
  generalSlotCollectionSource,
  typedCallLoopSource,
} from "./general-call-loop-fixture-source.ts";

test("untyped generality kernels produce the expected observations", () => {
  const expected = {
    receivers2: 80,
    receivers4: 96,
    receivers8: 128,
    arguments3: 120,
    arguments4: 184,
    arguments5: 264,
    arguments6: 360,
    objectRoundTrip: 88,
    allocateObjects: 264,
    mutableCapture: 55,
    concatenateStrings: 88,
    buildString: 25,
    catchInLoop: 61,
    objectArray: 288,
    mixedCall: 46,
    numberCall: 56,
    mathMax: 68,
    builtinMethod: 48,
  };
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(generality).map(([name, kernel]) => [name, kernel(16)]),
    ),
    expected,
  );
});

for (const [mode, source] of [
  ["general", generalCallLoopSource],
  ["typed", typedCallLoopSource],
  [
    "general promoted slot",
    "const collectGarbage = () => {};\n" + generalSlotCollectionSource,
  ],
]) {
  test(mode + " call and loop fixture holds under Node", async () => {
    assert.ok(source);
    const body = stripTypeScriptTypes(source);
    const { run } = (await import(
      "data:text/javascript;base64," + Buffer.from(body).toString("base64")
    )) as { run(): number };
    assert.equal(run(), 42);
  });
}

import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import {
  generalCallLoopSource,
  typedCallLoopSource,
} from "./general-call-loop-fixture-source.ts";

for (const [mode, source] of [
  ["general", generalCallLoopSource],
  ["typed", typedCallLoopSource],
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

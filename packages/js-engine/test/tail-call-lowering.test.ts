import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { lowerScript } from "../src/lowering/index.ts";
function lowered(source: string) {
  const parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const result = lowerScript(parsed.value, source);
  assert.ok(result.ok, JSON.stringify(result));
  return JSON.stringify(result.value);
}

test("strict ordinary returns select the tail factory and request helper", () => {
  const text = lowered(
    'function f(n){"use strict";if(n===0)return 42;return f(n-1);}f(10);',
  );
  assert.ok(text.includes('"name":"createTailSourceFunction"'));
  assert.ok(text.includes('"name":"requestSourceTailCall"'));
});
test("sloppy bodies and suspended bodies retain their existing call path", () => {
  for (const source of [
    "function f(){return g();}",
    'async function f(){"use strict";return g();}',
    'function* f(){"use strict";return g();}',
  ]) {
    const text = lowered(source);
    assert.equal(text.includes('"name":"createTailSourceFunction"'), false);
    assert.equal(text.includes('"imported":"requestSourceTailCall"'), false);
  }
});
test("a tail eval candidate uses identity-sensitive deferred routing", () => {
  const text = lowered('function f(n){"use strict";return eval(n);}');
  assert.ok(text.includes('"name":"callEvalTailCandidate"'));
});
test("an access after eval keeps the ordinary direct-eval guard", () => {
  const text = lowered('function f(n){"use strict";return eval(n)?.x;}');
  assert.equal(text.includes('"name":"callEvalTailCandidate"'), false);
  assert.ok(text.includes('"name":"callEvalCandidate"'));
});
test("nested strict arrows own their tail factory", () => {
  const text = lowered('"use strict";const f=x=>x?g():h();');
  assert.ok(text.includes('"name":"createTailSourceFunction"'));
});
test("raw class constructor callbacks are not activated before their driver integration", () => {
  const text = lowered("class C{constructor(){return f();}}");
  assert.equal(text.includes('"name":"createTailSourceFunction"'), false);
  assert.equal(text.includes('"imported":"requestSourceTailCall"'), false);
});

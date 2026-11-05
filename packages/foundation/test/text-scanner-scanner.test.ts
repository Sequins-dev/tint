import { test } from "node:test";
import assert from "node:assert/strict";
import { createScanner } from "@tint/foundation/text/text-scanner";
test("cursor matching and checkpoint restoration are bounded and failure-atomic", () => {
  const s = createScanner("abc🙂");
  assert.equal(s.peekCode(), 97);
  assert.equal(s.match("ab"), true);
  const mark = s.mark();
  assert.equal(mark, 2);
  assert.equal(s.match("no"), false);
  assert.equal(s.offset(), 2);
  assert.equal(s.advance(99), false);
  assert.equal(s.offset(), 2);
  assert.equal(
    s.eatWhile((c) => c < 128),
    "c",
  );
  assert.equal(s.peekCode(), 0xd83d);
  assert.equal(s.advance(2), true);
  assert.equal(s.done(), true);
  assert.equal(s.peekCode(), -1);
  assert.equal(s.restore(mark), true);
  assert.equal(s.match("c🙂"), true);
  for (const n of [-1, NaN, 0.5, 99]) {
    assert.equal(s.restore(n), false);
    assert.equal(s.advance(n), false);
    assert.equal(s.peekCode(n), -1);
    assert.equal(s.offset(), 5);
  }
  assert.equal(s.match(""), false);
  assert.equal(s.restore(0), true);
  assert.equal(s.advance(0), true);
});

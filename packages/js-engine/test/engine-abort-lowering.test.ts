import assert from "node:assert/strict";
import { test } from "node:test";
import { createLoweredRealm } from "./lowered-node-host.ts";

// The managed allocators throw this marker when the heap is exhausted. It is
// an engine abort: no JavaScript handler may observe it, and the Script ends
// as unsupported (a resource limit), like the per-entry code budget.
const marker = JSON.stringify("MANAGED_HEAP_EXHAUSTED");

test("engine aborts bypass catch clauses, promise handlers and generator handlers", () => {
  for (const source of [
    `try { throw ${marker}; } catch (e) { print("catch " + typeof e); }`,
    `try { throw ${marker}; } catch { print("bare catch"); }`,
    `new Promise(function (_, reject) { reject(${marker}); }).then(undefined, function (e) { print("rejected " + e); });`,
    `function* g() { try { yield 1; } catch (e) { print("generator " + e); } } var it = g(); it.next(); it.throw(${marker});`,
  ]) {
    const realm = createLoweredRealm();
    assert.equal(realm.run(source), "unsupported", source);
    realm.drain();
    assert.deepEqual(realm.printed, [], source);
  }
});

test("ordinary thrown strings are still caught", () => {
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(`try { throw "x"; } catch (e) { print("caught " + e); }`),
    "none",
  );
  assert.deepEqual(realm.printed, ["caught x"]);
});

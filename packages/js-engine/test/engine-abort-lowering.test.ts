import assert from "node:assert/strict";
import { test } from "node:test";
import { createLoweredRealm } from "./lowered-node-host.ts";

// The managed allocators throw a raw runtime closure on heap exhaustion; the
// lowered host's engineAbortForTest throws the same kind of value. It is an
// engine abort: no JavaScript handler may observe it, and the Script ends as
// unsupported (a resource limit), like the per-entry code budget.
test("engine aborts bypass catch clauses, promise handlers and generator handlers", () => {
  for (const source of [
    `try { engineAbortForTest(); } catch (e) { print("catch " + typeof e); }`,
    `try { engineAbortForTest(); } catch { print("bare catch"); }`,
    `new Promise(function () { engineAbortForTest(); }).then(undefined, function (e) { print("rejected " + typeof e); });`,
    `Promise.resolve().then(function () { engineAbortForTest(); }).then(undefined, function (e) { print("handler " + typeof e); });`,
    `function* g() { try { yield 1; engineAbortForTest(); } catch (e) { print("generator " + typeof e); } } var it = g(); it.next(); it.next();`,
  ]) {
    const realm = createLoweredRealm();
    const result = realm.run(source);
    realm.drain();
    assert.ok(result === "unsupported" || result === "none", source);
    assert.deepEqual(realm.printed, [], source);
    assert.equal(realm.run("1;"), "unsupported", source);
  }
});

test("Scripts may throw and catch any JavaScript value, including the old marker string", () => {
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(
      `function seen(v) { try { throw v; } catch (e) { return e === v || (v !== v && e !== e); } }
       print(String(seen("MANAGED_HEAP_EXHAUSTED")));
       print(String(seen("x")));
       print(String(seen(42)));
       print(String(seen(NaN)));
       print(String(seen(true)));
       print(String(seen(undefined)));
       print(String(seen(null)));
       print(String(seen(Symbol("s"))));
       print(String(seen(10n)));
       print(String(seen({})));
       print(String(seen(function f() {})));
       Promise.reject("MANAGED_HEAP_EXHAUSTED").then(undefined, function (e) { print("rejected " + e); });`,
    ),
    "none",
  );
  realm.drain();
  assert.deepEqual(realm.printed, [
    ...Array.from({ length: 11 }, () => "true"),
    "rejected MANAGED_HEAP_EXHAUSTED",
  ]);
});

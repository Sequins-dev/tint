import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createLoweredRealm } from "./lowered-node-host.ts";
import { evalSourceCacheCorpus as corpus } from "./eval-source-cache-corpus.ts";

// Differential: programs that evaluate identical eval sources repeatedly in
// different callers, strictness, constructor contexts and realms run through
// the lowered evaluator (whose exact-source cache reuses compiled entries) and
// through Node. Every printed observation must agree.
// Compilations each program needs with the cache: a hit must not recompile,
// and failures are never compiled or retained.
const compiles: Readonly<Record<string, number>> = {
  privateNames: 1,
  functionIdentity: 1,
  freshSyntaxErrors: 0,
  syntaxErrorsRepeat: 0,
  callerScopes: 1,
  closures: 1,
};
for (const [name, program] of Object.entries(corpus))
  test("eval source cache matches Node: " + name, () => {
    const realm = createLoweredRealm();
    assert.equal(realm.run(program), "none", name);
    const expected: string[] = [];
    runInNewContext(program, {
      print: (value: unknown) => expected.push(String(value)),
    });
    assert.deepEqual(realm.printed, expected);
    const count = compiles[name];
    if (count !== undefined) assert.equal(realm.compiledEntries(), count, name);
  });
test("repeated eval sources compile once per entry shape", () => {
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(`
      function f() { return eval("1 + 1"); }
      var ie = eval;
      for (var i = 0; i < 20; i++) { f(); ie("1 + 1"); }
      function s() { "use strict"; return eval("1 + 1"); }
      s(); s();`),
    "none",
  );
  // Sloppy direct, indirect and strict direct are distinct shapes.
  assert.equal(realm.compiledEntries(), 3);
});
test("template sites keep per-evaluation identity in hosts that cannot reuse them", () => {
  // This host instantiates template recipes per compiled module, so it does
  // not mark such entries reusable; the native compiler reaches sites through
  // each evaluation's Script record instead (script-compile tests).
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(`
      function tag(s) { return s; }
      var a = eval("tag\`x\`"), b = eval("tag\`x\`");
      print(a !== b);
      var sites = [];
      for (var i = 0; i < 2; i++) sites.push(eval("tag\`y\`"));
      print(sites[0] !== sites[1]);`),
    "none",
  );
  assert.deepEqual(realm.printed, ["true", "true"]);
  assert.equal(realm.compiledEntries(), 4);
});

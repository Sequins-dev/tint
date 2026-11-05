import assert from "node:assert/strict";
import { test } from "node:test";
import { createObject, type ScriptPropertyKey } from "@tint/js-runtime/objects";
import { createDeclarativeEnvironment } from "@tint/js-runtime/environments/records";
import * as globals from "../src/environments/global/index.ts";

test("a direct eval site preserves typed scope and catch identities", () => {
  const global = globals.createGlobalEnvironment<ScriptPropertyKey, unknown>(
    createObject<ScriptPropertyKey, unknown>(undefined),
    undefined,
    undefined,
    (name) => name,
    { undefinedValue: undefined, sameValue: Object.is, call: () => undefined },
  );
  const variables = globals.createGlobalScope(global);
  const outer = createDeclarativeEnvironment<unknown>(undefined);
  const inner = createDeclarativeEnvironment<unknown>(undefined);
  const lexical = globals.createDeclarativeScope(
    globals.createDeclarativeScope(variables, outer),
    inner,
  );
  const catches: globals.DirectEvalCatch<unknown> = {
    record: inner,
    outer: { record: outer, outer: undefined },
  };
  const site: globals.DirectEvalSite = {
    scriptOrModule: {},
    lexical,
    variables,
    catches,
    thisValue: global.thisValue,
    newTarget: undefined,
    home: undefined,
    derived: undefined,
    activeFunction: undefined,
    privateEnvironment: undefined,
  };
  assert.equal(site.lexical.declarative, inner);
  assert.equal(site.variables.global, global);
  assert.equal(site.catches?.outer?.record, outer);
  for (const value of [site, 7, undefined]) {
    assert.throws(
      () => globals.viewDirectEvalSite(value),
      (error) => error === "UNBOUND_DIRECT_EVAL_SITE_VIEW",
    );
  }
});

test("eval private resolution preserves identity and lexical shadowing", () => {
  assert.equal(typeof globals.resolveDirectEvalPrivateName, "function");
  const outer = { description: "#x" },
    inner = { description: "#x" },
    other = { description: "#y" };
  const chain = {
    name: inner,
    outer: { name: other, outer: { name: outer, outer: undefined } },
  };
  assert.equal(globals.resolveDirectEvalPrivateName(chain, "#x"), inner);
  assert.equal(globals.resolveDirectEvalPrivateName(chain, "#y"), other);
  assert.equal(
    globals.resolveDirectEvalPrivateName(chain, "#missing"),
    undefined,
  );
  assert.equal(
    globals.resolveDirectEvalPrivateName(undefined, "#x"),
    undefined,
  );
});

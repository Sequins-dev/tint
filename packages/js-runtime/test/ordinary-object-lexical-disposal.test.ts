import assert from "node:assert/strict";
import test from "node:test";
import {
  createDisposalStack,
  pushDisposalResource,
} from "@tint/js-runtime/disposal";
import {
  disposeSyncResources,
  disposeMixedLexicalResources,
} from "../src/objects/disposal-resources.ts";
import {
  createObject,
  getOwnProperty,
  type OrdinaryObject,
  type ObjectHooks,
} from "../src/objects/operations.ts";
import { createErrorRealm } from "../src/objects/errors.ts";
import type { ScriptPropertyKey } from "../src/objects/symbols.ts";
const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: (fn) => {
    throw fn;
  },
};
const realm = createErrorRealm(
  createObject<ScriptPropertyKey, unknown>(undefined),
  hooks,
);
test("lexical cleanup includes the original abrupt completion in its suppression chain", () => {
  const stack = createDisposalStack<unknown>();
  pushDisposalResource(stack, { value: undefined, method: 19, hint: "sync" });
  pushDisposalResource(stack, { value: undefined, method: 42, hint: "sync" });
  let thrown: unknown;
  try {
    disposeSyncResources(stack, realm, hooks, true, 9);
  } catch (error) {
    thrown = error;
  }
  const outer = thrown as OrdinaryObject<ScriptPropertyKey, unknown>;
  assert.equal(getOwnProperty(outer, "error")?.value, 19);
  const inner = getOwnProperty(outer, "suppressed")?.value as OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(getOwnProperty(inner, "error")?.value, 42);
  assert.equal(getOwnProperty(inner, "suppressed")?.value, 9);
});

test("mixed lexical cleanup does not suspend when no Await is reached", () => {
  const empty = createDisposalStack<unknown>();
  assert.deepEqual(
    disposeMixedLexicalResources(empty, realm, hooks, false, undefined),
    {
      suspended: false,
      value: undefined,
    },
  );
  assert.equal(empty.state, "disposed");

  const throwing = createDisposalStack<unknown>();
  pushDisposalResource(throwing, {
    value: undefined,
    method: 19,
    hint: "async",
  });
  assert.throws(
    () =>
      disposeMixedLexicalResources(throwing, realm, hooks, false, undefined),
    (error) => error === 19,
  );
});

test("synchronous resources in a mixed scope ignore returned thenables", () => {
  const stack = createDisposalStack<unknown>();
  pushDisposalResource(stack, { value: undefined, method: 19, hint: "sync" });
  const returning: ObjectHooks<unknown> = {
    ...hooks,
    call: () => ({
      get then() {
        throw new Error("unexpected await");
      },
    }),
  };
  assert.deepEqual(
    disposeMixedLexicalResources(stack, realm, returning, false, undefined),
    {
      suspended: false,
      value: undefined,
    },
  );
});

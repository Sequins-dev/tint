import { test } from "node:test";
import {
  createSourceFunction,
  callObject,
  createGeneratorObject,
} from "../src/objects/index.ts";
import { builtinFunction } from "../src/objects/intrinsics.ts";
import { resumeGenerator } from "@tint/js-runtime/iterators";
import assert from "node:assert/strict";
import {
  createScriptAgent,
  runScriptContext,
  enqueueScriptJob,
  drainScriptJobs,
} from "../src/objects/jobs.ts";
import {
  createObject,
  type ObjectHooks,
  type ScriptPropertyKey,
} from "../src/objects/index.ts";
import { createErrorRealm } from "../src/objects/errors.ts";

const hooks: ObjectHooks<unknown> = {
  undefinedValue: undefined,
  sameValue: Object.is,
  call: () => undefined,
};
function realm() {
  return createErrorRealm(
    createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
  );
}

test("nested Script contexts restore realm and source on abrupt completion", () => {
  const agent = createScriptAgent(),
    a = { realm: realm(), scriptOrModule: "a" },
    b = { realm: realm(), scriptOrModule: "b" };
  const error = {};
  runScriptContext(agent, a, () => {
    assert.ok(agent.activeContext === a);
    assert.throws(
      () =>
        runScriptContext(agent, b, () => {
          assert.ok(agent.activeContext === b);
          throw error;
        }),
      (value) => value === error,
    );
    assert.ok(agent.activeContext === a);
  });
  assert.equal(agent.activeContext, undefined);
});

test("jobs retain enqueue-time source and callback realm and wait until Script execution exits", () => {
  const agent = createScriptAgent(),
    a = realm(),
    b = realm();
  const seen: unknown[] = [];
  const execution = {
    run: (action: () => unknown) =>
      runScriptContext(
        agent,
        { realm: b, scriptOrModule: "definition" },
        action,
      ),
  };
  runScriptContext(agent, { realm: a, scriptOrModule: "enqueue" }, () => {
    enqueueScriptJob(
      agent,
      () => {
        assert.ok(agent.activeContext?.realm === b);
        seen.push(agent.activeContext?.scriptOrModule);
        assert.equal(
          drainScriptJobs(agent, (error) => {
            throw error;
          }),
          0,
        );
      },
      execution,
    );
    assert.equal(
      drainScriptJobs(agent, (error) => {
        throw error;
      }),
      0,
    );
    assert.deepEqual(seen, []);
  });
  assert.equal(
    drainScriptJobs(agent, (error) => {
      throw error;
    }),
    1,
  );
  assert.deepEqual(seen, ["enqueue"]);
  assert.equal(agent.activeContext, undefined);
});

test("job errors are reported after context restoration and do not discard subsequent jobs", () => {
  const agent = createScriptAgent(),
    context = { realm: realm(), scriptOrModule: "job" };
  const execution = {
    run: (action: () => unknown) => runScriptContext(agent, context, action),
  };
  const error = {};
  const seen: unknown[] = [];
  enqueueScriptJob(
    agent,
    () => {
      throw error;
    },
    execution,
  );
  enqueueScriptJob(
    agent,
    () => {
      seen.push(42);
    },
    undefined,
  );
  const count = drainScriptJobs(agent, (value) => {
    assert.equal(agent.activeContext, undefined);
    seen.push(value);
  });
  assert.equal(count, 2);
  assert.deepEqual(seen, [error, 42]);
});

test("source functions retain their definition realm and Script/module", () => {
  const agent = createScriptAgent();
  const a = createErrorRealm(
    createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
    undefined,
    agent,
  );
  const b = createErrorRealm(
    createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
    undefined,
    agent,
  );
  const fn = runScriptContext(
    agent,
    { realm: a, scriptOrModule: "definition" },
    () =>
      createSourceFunction(
        () => {
          assert.ok(agent.activeContext?.realm === a);
          return agent.activeContext?.scriptOrModule;
        },
        false,
        a,
        hooks,
      ),
  );
  runScriptContext(agent, { realm: b, scriptOrModule: "caller" }, () => {
    assert.equal(callObject(fn, undefined, [], undefined).value, "definition");
    assert.ok(agent.activeContext?.realm === b);
    assert.equal(agent.activeContext?.scriptOrModule, "caller");
  });
  assert.equal(agent.activeContext, undefined);
});

test("built-ins enter their realm while preserving the caller's active Script/module", () => {
  const agent = createScriptAgent();
  const a = createErrorRealm(
    createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
    undefined,
    agent,
  );
  const b = createErrorRealm(
    createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
    undefined,
    agent,
  );
  const fn = builtinFunction(
    b.functionPrototype,
    "probe",
    0,
    () => {
      assert.ok(agent.activeContext?.realm === b);
      return agent.activeContext?.scriptOrModule;
    },
    hooks,
  );
  runScriptContext(agent, { realm: a, scriptOrModule: "caller" }, () => {
    assert.equal(callObject(fn, undefined, [], undefined).value, "caller");
    assert.ok(agent.activeContext?.realm === a);
  });
});

test("generator bodies restore their captured context independently of the resuming caller", () => {
  const agent = createScriptAgent();
  const a = createErrorRealm(
    createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
    undefined,
    agent,
  );
  const b = createErrorRealm(
    createObject<ScriptPropertyKey, unknown>(undefined),
    hooks,
    undefined,
    agent,
  );
  const generator = runScriptContext(
    agent,
    { realm: a, scriptOrModule: "definition" },
    () =>
      createGeneratorObject(() => {
        assert.ok(agent.activeContext?.realm === a);
        assert.equal(agent.activeContext?.scriptOrModule, "definition");
        return { kind: "return", value: 42 };
      }, a),
  );
  const record =
    generator.internalRareSlots?.internalExoticSlots?.internalGeneratorData;
  assert.ok(record);
  runScriptContext(agent, { realm: b, scriptOrModule: "consumer" }, () => {
    const result = resumeGenerator(record, "next", undefined, {
      undefinedValue: undefined,
      typeError: () => new TypeError(),
      iteratorResult: (value) => {
        assert.ok(agent.activeContext?.realm === b);
        return value;
      },
    });
    assert.equal(result, 42);
    assert.ok(agent.activeContext?.realm === b);
  });
});

test("agent suspension policy is fixed at construction and shared by its realms", () => {
  assert.equal(createScriptAgent().canSuspend, false);
  for (const allowed of [false, true]) {
    const agent = createScriptAgent(allowed),
      prototype = createObject<ScriptPropertyKey, unknown>(undefined);
    const a = createErrorRealm(prototype, hooks, undefined, agent);
    const b = createErrorRealm(prototype, hooks, a.symbolRegistry, agent);
    assert.equal(a.agent.canSuspend, allowed);
    assert.equal(b.agent, a.agent);
  }
});
test("kept weak targets clear at job boundaries, including abrupt jobs, without nested-drain clearing", () => {
  const agent = createScriptAgent(),
    target = {};
  assert.ok(Array.isArray(agent.keptAlive));
  agent.keptAlive.push(target);
  const seen: number[] = [];
  enqueueScriptJob(
    agent,
    () => {
      seen.push(agent.keptAlive.length);
      agent.keptAlive.push(target);
      assert.equal(
        drainScriptJobs(agent, () => {}),
        0,
      );
      seen.push(agent.keptAlive.length);
      throw target;
    },
    undefined,
  );
  enqueueScriptJob(agent, () => seen.push(agent.keptAlive.length), undefined);
  assert.equal(
    drainScriptJobs(agent, (error) => assert.equal(error, target)),
    2,
  );
  assert.deepEqual(seen, [0, 1, 0]);
  assert.equal(agent.keptAlive.length, 0);
});

test("Script records are fresh host identities retaining their realm and host data", async () => {
  const { createScriptRecord } = await import("../src/objects/index.ts");
  assert.equal(typeof createScriptRecord, "function");
  const owner = realm(),
    metadata = { source: "one" };
  const first = createScriptRecord(owner, metadata),
    second = createScriptRecord(owner, metadata);
  assert.notEqual(first, second);
  assert.equal(first.kind, "script");
  assert.equal(first.realm, owner);
  assert.equal(first.hostDefined, metadata);
  const agent = createScriptAgent();
  const execution = {
    run: (action: () => unknown) =>
      runScriptContext(agent, { realm: owner, scriptOrModule: first }, action),
  };
  let observed: unknown;
  execution.run(() =>
    enqueueScriptJob(
      agent,
      () => {
        observed = agent.activeContext?.scriptOrModule;
      },
      execution,
    ),
  );
  assert.equal(
    drainScriptJobs(agent, () => assert.fail("unexpected job error")),
    1,
  );
  assert.equal(observed, first);
  assert.equal(agent.activeContext, undefined);
});

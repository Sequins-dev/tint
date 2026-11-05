import { test } from "node:test";
import assert from "node:assert/strict";
import { executeNodeScript } from "./test262-node.ts";
import { executionPlan, type ExecutionJob } from "./test262-execution.ts";
function job(source: string): ExecutionJob {
  return {
    plan: executionPlan(source, "sloppy", {
      flags: [],
      features: [],
      includes: [],
    }),
    filename: "test.js",
    harness: [],
    timeoutMs: 100,
  };
}
test("reference adapter executes global Scripts in fresh realms", () => {
  assert.deepEqual(
    executeNodeScript(
      job(
        "var x=3;if(globalThis.x!==3||this!==globalThis)throw 1;globalThis.polluted=1;",
      ),
    ),
    { kind: "completed" },
  );
  assert.deepEqual(
    executeNodeScript(job('if("polluted" in globalThis)throw 1;')),
    { kind: "completed" },
  );
  const strict = job('"use strict";unresolvable=3;');
  const outcome = executeNodeScript(strict);
  assert.equal(outcome.kind, "error");
  if (outcome.kind === "error") {
    assert.equal(outcome.phase, "runtime");
    assert.equal(outcome.type, "ReferenceError");
  }
});
test("reference adapter distinguishes parse, harness, runtime and timeout outcomes", () => {
  const parse = executeNodeScript({
    ...job("let = ;"),
    harness: [
      { filename: "bad-harness.js", source: 'throw new Error("harness");' },
    ],
  });
  assert.equal(parse.kind, "error");
  if (parse.kind === "error") assert.equal(parse.phase, "parse");
  const harness = executeNodeScript({
    ...job('throw new TypeError("test");'),
    harness: [
      { filename: "bad-harness.js", source: 'throw new Error("harness");' },
    ],
  });
  assert.equal(harness.kind, "error");
  if (harness.kind === "error") assert.equal(harness.phase, "harness");
  const runtime = executeNodeScript(job('throw new RangeError("test");'));
  assert.equal(runtime.kind, "error");
  if (runtime.kind === "error") {
    assert.equal(runtime.phase, "runtime");
    assert.equal(runtime.type, "RangeError");
  }
  assert.deepEqual(executeNodeScript(job("while(true){}")), {
    kind: "timeout",
  });
});
test("reference adapter loads harness files in order and exposes realm host bindings", () => {
  assert.deepEqual(
    executeNodeScript({
      ...job(
        'if(order!==12)throw 1;var realm=$262.createRealm();if(realm.global===$262.global)throw 2;if(realm.evalScript("1+2")!==3)throw 3;var caught=false;try{$262.evalScript("let = ;");}catch(e){caught=e instanceof SyntaxError;}if(!caught)throw 4;',
      ),
      harness: [
        { filename: "first.js", source: "var order=1;" },
        { filename: "second.js", source: "order=order*10+2;" },
      ],
    }),
    { kind: "completed" },
  );
});

test("promise rejection tracking is distinct from a thrown test exception", async () => {
  const { executeNodeProcess } = await import("./test262-process.ts");
  for (const source of [
    "var x=1;",
    'Promise.reject(new RangeError("unhandled"));',
    "var p=new Promise(()=>{});p.constructor=null;Promise.resolve(p);",
  ]) {
    assert.deepEqual(executeNodeProcess(job(source)), { kind: "completed" });
  }
});

test("host bindings preserve descriptors, coercions and realm-local detachment errors", () => {
  assert.deepEqual(
    executeNodeScript(
      job(`
  var descriptor=Object.getOwnPropertyDescriptor(globalThis,"print");
  if(descriptor.enumerable||!descriptor.writable||!descriptor.configurable)throw 1;
  var calls=0;print({toString(){calls++;return "printed";}});if(calls!==1)throw 2;
  var buffer=new ArrayBuffer(8);$262.detachArrayBuffer(buffer);if(buffer.byteLength!==0)throw 3;
  var caught=false;try{$262.detachArrayBuffer({});}catch(e){caught=e instanceof TypeError;}if(!caught)throw 4;
 `),
    ),
    { kind: "completed" },
  );
});

test("late rejected jobs cannot turn a harness error into a runtime negative pass", async () => {
  const { executeNodeProcess } = await import("./test262-process.ts");
  const outcome = executeNodeProcess({
    ...job("0;"),
    harness: [
      {
        filename: "failing.js",
        source:
          'Promise.reject(new TypeError("late"));throw new Error("harness");',
      },
    ],
  });
  assert.equal(outcome.kind, "error");
  if (outcome.kind === "error") assert.equal(outcome.phase, "harness");
});

test("asynchronous process jobs require exactly one successful completion", async () => {
  const { executeNodeProcess } = await import("./test262-process.ts");
  const done = `function $DONE(error) { print(error ? "Test262:AsyncTestFailure:" + error.name + ": " + error.message : "Test262:AsyncTestComplete"); }`;
  function asynchronous(source: string): ExecutionJob {
    const input = job(source);
    return {
      ...input,
      plan: { ...input.plan, asynchronous: true },
      harness: [{ filename: "doneprintHandle.js", source: done }],
    };
  }
  assert.deepEqual(
    executeNodeProcess(asynchronous("Promise.resolve().then(()=>$DONE());")),
    { kind: "completed" },
  );
  assert.deepEqual(executeNodeProcess(asynchronous("Promise.resolve();")), {
    kind: "timeout",
  });
  assert.deepEqual(
    executeNodeProcess(
      asynchronous("$DONE();Promise.reject(new Error('tracked'));"),
    ),
    { kind: "completed" },
  );
  assert.deepEqual(
    executeNodeProcess(asynchronous("Promise.reject(new Error('no done'));")),
    { kind: "timeout" },
  );
  for (const source of [
    "$DONE();$DONE();",
    "$DONE(new TypeError('failed'));",
    "$DONE();throw new Error('after');",
  ]) {
    assert.equal(
      executeNodeProcess(asynchronous(source)).kind,
      "error",
      source,
    );
  }
});

test("reference adapter explicitly rejects an unavailable non-suspending agent policy", () => {
  const input = job("throw new Error('must not execute');");
  const result = executeNodeScript({
    ...input,
    plan: { ...input.plan, canSuspend: false },
  });
  assert.equal(result.kind, "unsupported");
});

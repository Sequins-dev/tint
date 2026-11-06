import assert from "node:assert/strict";
import test from "node:test";
import { parseScript, parseEvalScript } from "@tint/typescript/syntax";
import { createSourceTextView } from "@tint/source/text";
import {
  prepareManagedSurfaceEntry,
  linkManagedSurfaceModule,
} from "@tint/compiler/native";
import {
  lowerScript,
  lowerEvalScript,
  lowerDirectEvalScript,
  directEvalInFunction,
} from "../src/lowering/index.ts";
import { createEngineCodeStorage } from "../src/native/code-storage.ts";
import { createScriptEntryCompiler } from "../src/native/script-compile.ts";
import {
  createManagedScriptFixture,
  managedScriptMemoryModel,
} from "../../../tools/managed-script-fixture.ts";
const fixture = createManagedScriptFixture(),
  sample =
    "var v=40;let y=2;function f(a){nativeActive();return a+v;}nativeCount();f(y);";

test("managed tagged templates use the parsed-unit carrier and existing realm cache", () => {
  const h = host();
  const result = createScriptEntryCompiler(fixture, h.authority, {
    maxScriptCodeBytes: 262144,
  })(
    lower(
      "function tag(s){return s;}function f(){return tag`a${1}b`;}f();f();",
    ),
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(h.memory.state.reads > 0);
  assert.equal(h.state.writes, 1);
});
test("async template loops retain the shared per-entry code budget", () => {
  const oversized = host();
  const result = createScriptEntryCompiler(fixture, oversized.authority, {
    maxScriptCodeBytes: 262144,
  })(
    lower(
      "(async function(){function tag(s){return s;}const values=[];for(let i=0;i<2;i++){await 0;values.push(tag`same`);}return values[0]===values[1];})()",
    ),
  );
  assert.deepEqual(result, { ok: false, stage: "budget" });
  assert.equal(oversized.memory.state.reads, 0);
  assert.equal(oversized.state.maps, 0);
  assert.equal(oversized.state.writes, 0);
  const bounded = host();
  const compiled = createScriptEntryCompiler(fixture, bounded.authority, {
    maxScriptCodeBytes: 262144,
  })(
    lower(
      "(async function(){function tag(s){return s;}let first;for(let i=0;i<2;i++){await 0;const value=tag`same`;if(i===0)first=value;else if(value!==first)return false;}return true;})()",
    ),
  );
  assert.ok(compiled.ok, JSON.stringify(compiled));
  assert.equal(bounded.state.writes, 1);
});
// The largest annexB/language/eval-code/direct eval body (from
// func-if-decl-else-decl-*-eval-func-skip-early-err-for-of.js, line
// continuations removed). Inline result checks emitted 360960 bytes and the
// native host rejected it as unsupported at the per-entry budget.
const skipEarlyErrForOf =
  'assert.throws(ReferenceError, function() {      f;    }, "An initialized binding is not created prior to evaluation");    assert.sameValue(      typeof f,      "undefined",      "An uninitialized binding is not created prior to evaluation"    );        for (let f of [0]) {if (true) function f() {  } else function _f() {}}        assert.throws(ReferenceError, function() {      f;    }, "An initialized binding is not created following evaluation");    assert.sameValue(      typeof f,      "undefined",      "An uninitialized binding is not created following evaluation"    );';
test("function-level direct eval closures fit the native per-entry code budget", () => {
  const parsed = parseEvalScript(createSourceTextView(skipEarlyErrForOf), {
    strict: false,
    newTarget: true,
    superProperty: false,
    superCall: false,
  });
  assert.ok(parsed.ok);
  const lowered = lowerDirectEvalScript(
    parsed.value,
    skipEarlyErrForOf,
    directEvalInFunction,
    { privateEnvironment: false, fieldInitializer: false },
  );
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const h = host();
  const result = createScriptEntryCompiler(fixture, h.authority, {
    maxScriptCodeBytes: 262144,
  })(lowered.value);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(h.state.writes, 1);
  const prepared = prepareManagedSurfaceEntry({
    ...fixture,
    module: lowered.value,
    entry: "execute",
  });
  assert.ok(prepared.ok);
  // Retain headroom rather than passing at the boundary.
  assert.ok(
    prepared.value.native.code.length < 262144 * 0.95,
    "direct eval code bytes: " + prepared.value.native.code.length,
  );
});
function lower(text: string) {
  const parsed = parseScript(createSourceTextView(text));
  assert.ok(parsed.ok);
  const lowered = lowerScript(parsed.value, text);
  assert.ok(lowered.ok);
  return lowered.value;
}
function host(capacity = 4194304) {
  const state = {
      domain: 17,
      maps: 0,
      writes: 0,
      mapResult: 0x7000000,
      writeResult: 0,
    },
    bytes: Uint8Array[] = [];
  const storage = createEngineCodeStorage(
    {
      domain: () => state.domain,
      map: () => {
        state.maps++;
        return state.mapResult;
      },
      register: () => 0,
      write: (_address, _capacity, _offset, code) => {
        state.writes++;
        bytes.push(code.slice());
        return state.writeResult;
      },
    },
    capacity,
  );
  const memory = managedScriptMemoryModel(fixture.read);
  return {
    state,
    bytes,
    memory,
    authority: {
      domain: () => state.domain,
      storage,
      readWord: memory.readWord,
    },
  };
}
const module = lower(sample),
  prepared = prepareManagedSurfaceEntry({
    ...fixture,
    module,
    entry: "execute",
  });
assert.ok(prepared.ok, JSON.stringify(prepared));
const size = prepared.value.native.code.length;
test("Script compilation matches manual linking without mutating emitted inputs", () => {
  for (const text of [sample, "'\ud800';", "2;;", "throw 7;"]) {
    const module = lower(text),
      h = host(),
      manual = prepareManagedSurfaceEntry({
        ...fixture,
        module,
        entry: "execute",
      });
    assert.ok(manual.ok, JSON.stringify(manual));
    const before = manual.value.native.code.slice(),
      memory = managedScriptMemoryModel(fixture.read);
    const linked = linkManagedSurfaceModule(
      fixture.read,
      manual.value.native,
      memory.readWord,
      17,
    );
    assert.ok(linked.ok);
    const result = createScriptEntryCompiler(fixture, h.authority, {
      maxScriptCodeBytes: 262144,
    })(module);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.address, h.state.mapResult + manual.value.entryOffset);
    assert.deepEqual(h.bytes, [linked.value.code]);
    assert.deepEqual(manual.value.native.code, before);
    assert.equal(h.memory.state.reads, memory.state.reads);
    assert.equal(h.state.maps, 1);
  }
});
test("Script compiler construction validates configuration without touching storage", () => {
  for (const maxScriptCodeBytes of [0, NaN, 1.5, -1, Infinity]) {
    const h = host();
    assert.throws(
      () =>
        createScriptEntryCompiler(fixture, h.authority, { maxScriptCodeBytes }),
      RangeError,
    );
    assert.equal(h.state.maps, 0);
    assert.equal(h.memory.state.reads, 0);
  }
  const h = host();
  for (const read of [
    { ...fixture.read, domain: 0 },
    {
      ...fixture.read,
      directory: { ...fixture.read.directory, frame: "Other" },
    },
  ])
    assert.throws(
      () =>
        createScriptEntryCompiler({ ...fixture, read }, h.authority, {
          maxScriptCodeBytes: 262144,
        }),
      RangeError,
    );
});
test("code budgets reject before reads and the exact boundary publishes", () => {
  const h = host();
  assert.deepEqual(
    createScriptEntryCompiler(fixture, h.authority, {
      maxScriptCodeBytes: size - 1,
    })(module),
    { ok: false, stage: "budget" },
  );
  assert.equal(h.memory.state.reads, 0);
  assert.equal(h.state.writes, 0);
  assert.ok(
    createScriptEntryCompiler(fixture, h.authority, {
      maxScriptCodeBytes: size,
    })(module).ok,
  );
  assert.equal(h.state.writes, 1);
});
test("foreign and changing domains never publish Script code", () => {
  const foreign = host();
  foreign.state.domain = 18;
  assert.deepEqual(
    createScriptEntryCompiler(fixture, foreign.authority, {
      maxScriptCodeBytes: 262144,
    })(module),
    { ok: false, stage: "link" },
  );
  assert.equal(foreign.memory.state.reads, 0);
  assert.equal(foreign.state.writes, 0);
  const stale = host();
  assert.deepEqual(
    createScriptEntryCompiler(
      fixture,
      {
        ...stale.authority,
        storage: { ...stale.authority.storage, domain: 19 },
      },
      { maxScriptCodeBytes: 262144 },
    )(module),
    { ok: false, stage: "link" },
  );
  assert.equal(stale.memory.state.reads, 0);
  const changing = host();
  const result = createScriptEntryCompiler(
    fixture,
    {
      ...changing.authority,
      readWord: (a, l, o) => {
        const value = changing.memory.readWord(a, l, o);
        changing.state.domain = 18;
        return value;
      },
    },
    { maxScriptCodeBytes: 262144 },
  )(module);
  assert.deepEqual(result, { ok: false, stage: "link" });
  assert.equal(changing.state.writes, 0);
});
test("invalid windows and inaccessible metadata fail before publication", () => {
  for (const throwing of [false, true]) {
    const h = host();
    const compile = createScriptEntryCompiler(
      fixture,
      {
        ...h.authority,
        readWord: (a, l, o) => {
          if (throwing) throw Error("unreadable");
          return o === 0 ? 999 : h.memory.readWord(a, l, o);
        },
      },
      { maxScriptCodeBytes: 262144 },
    );
    assert.deepEqual(compile(module), { ok: false, stage: "link" });
    assert.equal(h.state.writes, 0);
  }
});
test("arena overflow and poisoned mappings remain publication failures", () => {
  const small = host(size - 1);
  assert.deepEqual(
    createScriptEntryCompiler(fixture, small.authority, {
      maxScriptCodeBytes: 262144,
    })(module),
    { ok: false, stage: "publish" },
  );
  assert.equal(small.state.maps, 0);
  const failed = host();
  failed.state.mapResult = 0;
  const compile = createScriptEntryCompiler(fixture, failed.authority, {
    maxScriptCodeBytes: 262144,
  });
  assert.deepEqual(compile(module), { ok: false, stage: "publish" });
  assert.deepEqual(compile(module), { ok: false, stage: "publish" });
  assert.equal(failed.state.maps, 1);
  assert.equal(failed.state.writes, 0);
});
test("Script compilation shares the existing permanent arena with Function code", () => {
  const h = host(),
    first = h.authority.storage.publish(new Uint8Array(40));
  assert.equal(first, h.state.mapResult);
  const compile = createScriptEntryCompiler(fixture, h.authority, {
    maxScriptCodeBytes: 262144,
  });
  const a = compile(module),
    b = compile(module);
  assert.ok(a.ok && b.ok);
  assert.equal(a.address, h.state.mapResult + 48);
  assert.equal(b.address, h.state.mapResult + Math.ceil((48 + size) / 16) * 16);
  assert.equal(h.state.maps, 1);
  assert.equal(h.state.writes, 3);
});
test("managed Script compilation links direct-eval guards through the image surface", () => {
  for (const source of [
    "eval(7);",
    'eval("1")?.y;',
    "function f(a=eval(7)){try{throw 1}catch(e){with({}){return eval(e)}}}",
    "'use strict';function s(){try{}catch(e){return eval(e)}}",
    "class D extends Object{constructor(){(()=>eval(7))();super()}}",
    "var o={m(){return eval(7)}}",
  ]) {
    const module = lower(source),
      h = host();
    assert.ok(
      module.imports.some((declaration) =>
        declaration.bindings.some(
          (binding) => binding?.imported === "callEvalCandidate",
        ),
      ),
    );
    const result = createScriptEntryCompiler(fixture, h.authority, {
      maxScriptCodeBytes: 262144,
    })(module);
    assert.ok(result.ok, JSON.stringify({ source, result }));
    assert.equal(h.state.maps, 1);
    assert.equal(h.state.writes, 1);
    assert.ok(h.memory.state.reads > 0);
  }
});

test("eval lexical entries compile through the same managed frame and compiler", () => {
  for (const source of [
    "var v=40;let local=2;v+local;",
    "'use strict';var v=40;v+2;",
    "eval(7)",
    "'use strict';eval(7)",
  ]) {
    const parsed = parseScript(createSourceTextView(source));
    assert.ok(parsed.ok);
    const lowered = lowerEvalScript(parsed.value, source);
    assert.ok(lowered.ok);
    const h = host(),
      result = createScriptEntryCompiler(fixture, h.authority, {
        maxScriptCodeBytes: 262144,
      })(lowered.value);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(h.state.maps, 1);
    assert.equal(h.state.writes, 1);
    assert.equal(fixture.read.directory.frame, "ScriptEntryFrame");
  }
});

test("direct eval entries link their checked site view and caller declaration helper", () => {
  for (const [source, flags] of [
    ["var w=v+2;w", 2],
    ["var s=1;s", 3],
    ["this;new.target", 2],
    ["eval('var z=7')", 2],
    ["super.x", 7],
    ["super[k]=v", 7],
    ["this;()=>this;super();eval('1')", 15],
    ["new.target", 39],
    ["this.#x", 71],
    ["#x in this;eval('this.#x')", 71],
  ] as const) {
    const parsed = parseEvalScript(createSourceTextView(source), {
      strict: (flags & 1) !== 0,
      newTarget: true,
      superProperty: (flags & 4) !== 0,
      superCall: (flags & 8) !== 0,
    });
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const module = lowerDirectEvalScript(parsed.value, source, flags, {
      privateEnvironment: (flags & 64) !== 0,
      fieldInitializer: (flags & 32) !== 0,
    });
    assert.ok(module.ok, JSON.stringify(module));
    const h = host();
    const result = createScriptEntryCompiler(fixture, h.authority, {
      maxScriptCodeBytes: 262144,
    })(module.value);
    assert.ok(result.ok, JSON.stringify({ source, result }));
    assert.equal(h.state.maps, 1);
    assert.equal(h.state.writes, 1);
  }
});

test("managed Script imports use their issued modules surface and reject unapproved specifiers before reads", () => {
  const h = host(),
    module = lower('import("./target");');
  const unapproved = {
    ...module,
    imports: module.imports.map((declaration) =>
      declaration.specifier !== "@tint/js-runtime/modules"
        ? declaration
        : { ...declaration, specifier: "unissued/modules" },
    ),
  };
  const compile = createScriptEntryCompiler(fixture, h.authority, {
    maxScriptCodeBytes: 262144,
  });
  assert.deepEqual(compile(unapproved), { ok: false, stage: "profile" });
  assert.equal(h.memory.state.reads, 0);
  assert.equal(h.state.maps, 0);
  assert.equal(h.state.writes, 0);
  assert.equal(compile(module).ok, true);
  assert.ok(h.memory.state.reads > 0);
  assert.equal(h.state.maps, 1);
  assert.equal(h.state.writes, 1);
});

test("managed template adaptation rejects invalid recipes before linking or publishing", () => {
  const original = lower("tag`x`;");
  const module = {
    ...original,
    statements: original.statements.map((statement) => {
      if (statement.kind !== "variable") return statement;
      return {
        ...statement,
        declarations: statement.declarations.map((declaration) => {
          if (
            declaration.kind !== undefined ||
            declaration.type?.kind !== "named" ||
            declaration.type.name !== "TemplateSite" ||
            declaration.initializer?.kind !== "object"
          )
            return declaration;
          return {
            ...declaration,
            initializer: {
              ...declaration.initializer,
              properties: declaration.initializer.properties.map((property) =>
                !("value" in property) || property.value.kind !== "array"
                  ? property
                  : { ...property, value: { ...property.value, elements: [] } },
              ),
            },
          };
        }),
      };
    }),
  };
  const h = host();
  assert.deepEqual(
    createScriptEntryCompiler(fixture, h.authority, {
      maxScriptCodeBytes: 262144,
    })(module),
    { ok: false, stage: "profile" },
  );
  assert.equal(h.memory.state.reads, 0);
  assert.equal(h.state.maps, 0);
  assert.equal(h.state.writes, 0);
});

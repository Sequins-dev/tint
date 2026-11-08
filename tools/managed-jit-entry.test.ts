import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import {
  parseScript,
  parseDynamicFunction,
  rewriteModule,
  type Expression,
} from "@tint/typescript/syntax";
import {
  lowerScript,
  lowerEvalScript,
  lowerDirectEvalScript,
  lowerDynamicFunctionImplementation,
} from "@tint/js-engine/lowering";
import {
  prepareManagedSurfaceEntry,
  declareManagedJitRuntime,
  createManagedCollectionPlanCache,
} from "@tint/compiler/native";
import type { Statement } from "@tint/typescript/syntax";
import { createManagedScriptFixture } from "./managed-script-fixture.ts";
import { managedNativeDifference } from "./managed-native-equivalence.ts";

test("managed Script assembly emits every import against the real AOT-selected frame", () => {
  const fixture = createManagedScriptFixture();
  const samples = [
    "var v=40;let y=2;function f(a){return a+v;}f(y);",
    "function f(a,b){return [a,b,function(){return a;}];}var r=f(1,2);r.length;f.call(null,...r);",
    'var g=(x)=>x*2;var arr=[1,2,3].map(g);typeof arr;arr[0]===2?"y":"n";',
  ];
  for (const text of samples) {
    const parsed = parseScript(createSourceTextView(text));
    assert.ok(parsed.ok);
    const lowered = lowerScript(parsed.value, text);
    assert.ok(lowered.ok);
    const prepared = prepareManagedSurfaceEntry({
      ...fixture,
      module: lowered.value,
      entry: "execute",
    });
    assert.ok(prepared.ok, JSON.stringify(prepared));
    assert.equal(prepared.value.native.linkage, "unresolved-managed");
    assert.equal(prepared.value.native.imports.length, 0);
    assert.ok(prepared.value.counts.records > 0);
    assert.ok(prepared.value.counts.memberOnly > 0);
    assert.ok(prepared.value.counts.functions > 0);
    assert.ok(prepared.value.entryOffset >= 0);
    if (text === samples[0]) {
      assert.deepEqual(prepared.value.counts, {
        signatures: 22,
        memberOnly: 3,
        records: 20,
        functions: 11,
      });
      assert.equal(prepared.value.native.managedImports.length, 54);
    }
    if (text === samples[2]) {
      // Distinct runtime functions with one signature type share a directory
      // signature, so their imports share a contract. Fused identifier reads no
      // longer produce such a pair here; restore the two-step reads explicitly.
      const twoStep = rewriteModule(lowered.value, {
        expression(node) {
          if (
            node.kind !== "call" ||
            node.callee.kind !== "identifier" ||
            node.callee.name !== "getIdentifierValue"
          )
            return node;
          const at = { start: node.start, end: node.end };
          const flag = node.arguments[4];
          const typeofRead = flag?.kind === "boolean" && flag.value;
          const types =
            node.typeArguments === undefined
              ? {}
              : { typeArguments: node.typeArguments };
          const resolve: Expression = {
            ...at,
            ...types,
            kind: "call",
            callee: { ...at, kind: "identifier", name: "resolveBinding" },
            arguments: node.arguments.slice(0, 3),
          };
          const read: Expression = {
            ...at,
            kind: "member",
            object: {
              ...at,
              kind: "call",
              callee: {
                ...at,
                kind: "identifier",
                name: typeofRead
                  ? "getBindingReferenceForTypeof"
                  : "getBindingReference",
              },
              arguments: [resolve],
              ...types,
            },
            property: "value",
            optional: false,
            private: false,
          };
          return read;
        },
      });
      const shared = prepareManagedSurfaceEntry({
        ...fixture,
        module: twoStep,
        entry: "execute",
      });
      assert.ok(shared.ok, JSON.stringify(shared));
      const contracts = shared.value.native.managedImports
        .filter((imported) => imported.role === "signature")
        .map((imported) => imported.contract);
      assert.ok(new Set(contracts).size < contracts.length);
    }
  }
  const tagged = "function f(x){return x;}f`x`;";
  const parsed = parseScript(createSourceTextView(tagged));
  assert.ok(parsed.ok);
  const lowered = lowerScript(parsed.value, tagged);
  assert.ok(lowered.ok);
  const rejected = prepareManagedSurfaceEntry({
    ...fixture,
    module: lowered.value,
    entry: "execute",
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok)
    assert.match(rejected.error.message, /module initialization/);
});

test("JIT Annex admission allocations use the image-owned record descriptor", () => {
  const fixture = createManagedScriptFixture(),
    source = "{function f(){return 'inner declaration';}}",
    parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok);
  const lowered = lowerScript(parsed.value, source);
  assert.ok(lowered.ok);
  const exported = fixture.read.contracts.surface.types.find(
    (type) => type.name === "AnnexGlobalFunction",
  );
  assert.ok(exported);
  assert.equal(exported.type.kind, "named");
  if (exported.type.kind !== "named") return;
  const alias = exported.type.name,
    classId = fixture.read.directory.records.findIndex(
      (record) => record.alias === alias || record.aliases.includes(alias),
    );
  assert.ok(classId >= 0);
  const prepared = prepareManagedSurfaceEntry({
    ...fixture,
    module: lowered.value,
    entry: "execute",
  });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  const contract =
    "tint.surface.v1/" +
    fixture.read.directory.name +
    "/" +
    fixture.read.directory.digest +
    "/record/" +
    classId;
  assert.ok(
    prepared.value.native.managedImports.some(
      (imported) =>
        imported.role === "record" && imported.contract === contract,
    ),
    "Annex records passed to AOT declaration setup need the issued descriptor",
  );
});
test("unannotated Annex admission records fail before publishing a private descriptor", () => {
  const fixture = createManagedScriptFixture(),
    source = "{function f(){}}",
    parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok);
  const lowered = lowerScript(parsed.value, source);
  assert.ok(lowered.ok);
  const untyped = rewriteModule(lowered.value, {
    statement(node) {
      if (node.kind !== "variable") return node;
      return {
        ...node,
        declarations: node.declarations.map((declaration) =>
          declaration.type?.kind === "named" &&
          declaration.type.name === "AnnexGlobalFunction"
            ? { ...declaration, type: undefined }
            : declaration,
        ),
      };
    },
  });
  const result = prepareManagedSurfaceEntry({
    ...fixture,
    module: untyped,
    entry: "execute",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.stage, "profile");
    assert.match(result.error.message, /surface mutability contract/);
  }
});

test("managed suspension uses exact continuation classes without callback variance", () => {
  const fixture = createManagedScriptFixture();
  for (const source of [
    "async function h(){return await 7}",
    "function*g(){yield 1;yield* [2]}",
    "async function*g(){yield await 1}",
    "var h=async()=>1",
    "async function h(){return " + "await ".repeat(100) + "7}",
    "async function*g(){yield " + "await ".repeat(15) + "1}",
  ]) {
    const parsed = parseScript(createSourceTextView(source));
    assert.ok(parsed.ok);
    const lowered = lowerScript(parsed.value, source);
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const prepared = prepareManagedSurfaceEntry({
      ...fixture,
      module: lowered.value,
      entry: "execute",
    });
    assert.ok(prepared.ok, JSON.stringify({ source, prepared }));
  }
});

test("suspending finally cleanup remains a private direct-call helper", () => {
  const fixture = createManagedScriptFixture();
  for (const source of [
    "async function f(){try{return await 7}finally{await 1}}",
    "function*g(){try{yield 1}finally{yield 2}}",
    "async function*g(){try{yield await 1}finally{await 2}}",
  ]) {
    const parsed = parseScript(createSourceTextView(source));
    assert.ok(parsed.ok);
    const lowered = lowerScript(parsed.value, source);
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const prepared = prepareManagedSurfaceEntry({
      ...fixture,
      module: lowered.value,
      entry: "execute",
    });
    assert.ok(prepared.ok, JSON.stringify({ source, prepared }));
  }
});

test("managed import calls bind the AOT helper from Script, eval and Function entries", () => {
  const fixture = createManagedScriptFixture();
  const text = 'import("./fixture.js");';
  const parsed = parseScript(createSourceTextView(text));
  assert.ok(parsed.ok);
  const dynamic = parseDynamicFunction("normal", [], text);
  assert.ok(dynamic.ok);
  for (const lowered of [
    lowerScript(parsed.value, text),
    lowerEvalScript(parsed.value, text),
    lowerDirectEvalScript(parsed.value, text, 0, {
      privateEnvironment: false,
      fieldInitializer: false,
    }),
    lowerDynamicFunctionImplementation(dynamic.value),
  ]) {
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const result = prepareManagedSurfaceEntry({
      ...fixture,
      module: lowered.value,
      entry: "execute",
    });
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(
      result.value.native.managedImports.some(
        (binding) => binding.role === "signature",
      ),
    );
  }
});

test("JIT entries prepared from runtime declarations match full provider preparation", () => {
  const fixture = createManagedScriptFixture(),
    declared = declareManagedJitRuntime(fixture.runtime);
  const samples: [string, boolean][] = [
    ["/a/", true],
    ["var x=[3,1,2];x.sort();x.length", true],
    ["var v=40;let y=2;function f(a){return a+v;}f(y);", false],
    [
      "var m=new Map([[1,2]]);var s=new Set([1]);for(const [k,v] of m)s.add(k+v);s.size",
      false,
    ],
    ["class A{#x=1;static m(){return new A().#x;}}A.m()", false],
    ["function* g(){yield 1;yield* [2,3];}[...g()].join()", false],
    ["async function f(){await 1;return 2;}f()", false],
    ["with(Math){max(1,2)}", true],
  ];
  for (const [text, direct] of samples) {
    const parsed = parseScript(createSourceTextView(text));
    assert.ok(parsed.ok);
    const lowered = direct
      ? lowerDirectEvalScript(parsed.value, text, 0, {
          privateEnvironment: false,
          fieldInitializer: false,
        })
      : lowerScript(parsed.value, text);
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const full = prepareManagedSurfaceEntry({
        ...fixture,
        module: lowered.value,
        entry: "execute",
      }),
      fast = prepareManagedSurfaceEntry({
        ...fixture,
        runtime: declared,
        module: lowered.value,
        entry: "execute",
      });
    assert.ok(full.ok && fast.ok, JSON.stringify([full, fast]).slice(0, 400));
    assert.equal(
      managedNativeDifference(full.value.native, fast.value.native),
      undefined,
      text,
    );
    assert.deepEqual(fast.value.counts, full.value.counts);
    assert.equal(fast.value.entryOffset, full.value.entryOffset);
  }
});

test("JIT preparation never consults runtime-provider bodies once declared", () => {
  const fixture = createManagedScriptFixture();
  let poisoned = 0;
  const modules = fixture.runtime.modules.map((source) => {
    const statements: Statement[] = source.module.statements.map(
      (statement) => {
        if (statement.kind !== "function" || statement.name !== "readList")
          return statement;
        poisoned++;
        return {
          ...statement,
          body: {
            start: statement.body.start,
            end: statement.body.end,
            kind: "block",
            statements: [
              {
                start: statement.body.start,
                end: statement.body.end,
                kind: "return",
                expression: {
                  start: statement.body.start,
                  end: statement.body.end,
                  kind: "identifier",
                  name: "missingProviderInternal",
                },
              },
            ],
          },
        };
      },
    );
    return { ...source, module: { ...source.module, statements } };
  });
  assert.equal(poisoned, 1);
  const runtime = { ...fixture.runtime, modules },
    text = "var x=[1];x.length",
    parsed = parseScript(createSourceTextView(text));
  assert.ok(parsed.ok);
  const lowered = lowerScript(parsed.value, text);
  assert.ok(lowered.ok);
  const full = prepareManagedSurfaceEntry({
    ...fixture,
    runtime,
    module: lowered.value,
    entry: "execute",
  });
  assert.equal(full.ok, false);
  const declared = prepareManagedSurfaceEntry({
      ...fixture,
      runtime: declareManagedJitRuntime(runtime),
      module: lowered.value,
      entry: "execute",
    }),
    clean = prepareManagedSurfaceEntry({
      ...fixture,
      runtime: declareManagedJitRuntime(fixture.runtime),
      module: lowered.value,
      entry: "execute",
    });
  assert.ok(declared.ok, JSON.stringify(declared));
  assert.deepEqual(declared, clean);
});

test("seeded collection plans reproduce cold JIT preparation and fall back when they do not validate", () => {
  const fixture = createManagedScriptFixture(),
    runtime = declareManagedJitRuntime(fixture.runtime),
    plans = createManagedCollectionPlanCache();
  const samples: [string, boolean][] = [
    ["/a/", true],
    ["var x=[3,1,2];x.sort();x.length", true],
    [
      "var m=new Map([[1,2]]);var s=new Set([1]);for(const [k,v] of m)s.add(k+v);s.size",
      false,
    ],
    ["class A{#x=1;static m(){return new A().#x;}}A.m()", false],
  ];
  function lowered(text: string, direct: boolean) {
    const parsed = parseScript(createSourceTextView(text));
    assert.ok(parsed.ok);
    const result = direct
      ? lowerDirectEvalScript(parsed.value, text, 0, {
          privateEnvironment: false,
          fieldInitializer: false,
        })
      : lowerScript(parsed.value, text);
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  }
  assert.equal(plans.get(), undefined);
  let seededHits = 0;
  for (const [text, direct] of samples) {
    const module = lowered(text, direct),
      seed = plans.get();
    const cold = prepareManagedSurfaceEntry({
        ...fixture,
        runtime,
        module,
        entry: "execute",
      }),
      warm = prepareManagedSurfaceEntry({
        ...fixture,
        runtime,
        module,
        entry: "execute",
        collectionPlans: plans,
      });
    assert.ok(cold.ok && warm.ok, text);
    assert.equal(
      managedNativeDifference(cold.value.native, warm.value.native),
      undefined,
      text,
    );
    assert.deepEqual(warm.value.counts, cold.value.counts);
    assert.ok(plans.get() !== undefined);
    // A validated seeded pass keeps the identical plan; a fallback stores anew.
    if (seed !== undefined && plans.get() === seed) seededHits++;
  }
  assert.equal(seededHits, samples.length - 1);
  // A plan whose helpers cannot cover the entry's demand is not trusted.
  const current = plans.get();
  assert.ok(current);
  const empty = createManagedCollectionPlanCache();
  empty.set({
    ...current,
    roots: [],
    listStarts: [],
    setStarts: [],
    mapStarts: [],
    sortStarts: [],
  });
  const module = lowered("var x=[1];x.length", false);
  const fallback = prepareManagedSurfaceEntry({
      ...fixture,
      runtime,
      module,
      entry: "execute",
      collectionPlans: empty,
    }),
    cold = prepareManagedSurfaceEntry({
      ...fixture,
      runtime,
      module,
      entry: "execute",
    });
  assert.ok(fallback.ok && cold.ok);
  assert.equal(
    managedNativeDifference(cold.value.native, fallback.value.native),
    undefined,
  );
  assert.notEqual(empty.get()?.roots.length, 0, "fallback stores its plan");
});

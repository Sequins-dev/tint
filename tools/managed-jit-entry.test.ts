import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import {
  parseScript,
  parseDynamicFunction,
  rewriteModule,
} from "@tint/typescript/syntax";
import {
  lowerScript,
  lowerEvalScript,
  lowerDirectEvalScript,
  lowerDynamicFunctionImplementation,
} from "@tint/js-engine/lowering";
import { prepareManagedSurfaceEntry } from "@tint/compiler/native";
import { createManagedScriptFixture } from "./managed-script-fixture.ts";

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
        signatures: 25,
        memberOnly: 3,
        records: 23,
        functions: 12,
      });
      assert.equal(prepared.value.native.managedImports.length, 61);
    }
    if (text === samples[2]) {
      const contracts = prepared.value.native.managedImports
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

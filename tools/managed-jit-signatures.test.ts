import { managedJitFixtureText as declaration } from "./managed-jit-fixture.ts";
import { managedFunctionType } from "../packages/compiler/src/native/managed-contracts.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModule } from "@tint/typescript/syntax";
import { createSourceTextView } from "@tint/source/text";
import { checkClosureModule } from "@tint/typescript/checker";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import * as compiler from "@tint/compiler/native";
import {
  prepareManagedJitProgram,
  lowerManagedJitProgram,
} from "../packages/compiler/src/native/managed-jit-program.ts";
import * as signatures from "../packages/compiler/src/native/managed-jit-signatures.ts";
function parse(text: string) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
const checked = checkClosureModule(parse(declaration));
assert.ok(checked.ok);
const surface = compiler.reifyManagedSurfaceTypes(
  checked.value,
  [
    "apply",
    "useLeft",
    "useRight",
    "keep",
    "box",
    "tag",
    "getInc",
    "getWide",
  ].map((name) => ({ name, local: name })),
  "$S",
  ["Frame", "Box", "Tag", "Left", "Right", "Inc", "Wide"].map((name) => ({
    name,
    local: name,
  })),
);
assert.ok(surface.ok);
const canonical = compiler.canonicalizeManagedSurfaceTypes(surface.value);
assert.ok(canonical.ok);
const canonicalSurface = canonical.value;
const runtime = { modules: [], runtimes: [], globals: ["undefined"] };
const facts = compiler.deriveManagedSurfacePhysicalFacts(
  canonical.value,
  runtime,
);
assert.ok(facts.ok, JSON.stringify(facts));
const directory = compiler.createManagedSurfaceDirectory(
  "typed",
  canonical.value,
  facts.value,
  "Frame",
);
assert.ok(directory.ok);
function prepare(text: string) {
  const adapted = compiler.adaptManagedSurfaceEntry(
    parse(
      'import {apply,useLeft,useRight,keep,box,tag,getInc,getWide,type Box,type Tag,type Wide} from "runtime";' +
        text,
    ),
    "execute",
    "runtime",
    canonicalSurface,
    { frame: "Frame" },
  );
  assert.ok(adapted.ok);
  assert.ok(adapted.value.view);
  const program = prepareManagedJitProgram(
    adapted.value.module,
    adapted.value.entry,
    adapted.value.view,
    canonicalSurface.declarations.map((s) => {
      assert.ok(s.kind === "type-alias" || s.kind === "interface");
      return s.name;
    }),
    runtime,
  );
  assert.ok(program.ok, JSON.stringify(program));
  const direct = compiler.managedDirectCallDeclarations(
    program.value.checked,
    program.value.entry,
  );
  assert.ok(direct.ok);
  const lowered = lowerManagedJitProgram(program.value);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  return {
    program: program.value,
    lowered: lowered.value,
    direct: direct.value,
  };
}
test("callback classes bind both exact direct-call declarations and escaping members", () => {
  assert.equal(typeof signatures.bindManagedJitSignatures, "function");
  const p = prepare(
    "export function execute(x:number):number{const inc=(v:number):number=>v+1;return apply(inc,x);}",
  );
  const result = signatures.bindManagedJitSignatures(
    p.program,
    p.lowered,
    directory.value.directory,
    p.direct,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(
    result.value.signatures.some(
      (binding) =>
        binding.witness !== undefined && binding.localFunctions?.length === 2,
    ),
  );
  const emitted = emitModule(p.lowered.module, {
    closedRoots: [p.lowered.entry],
    managedABI: {
      version: 1,
      ...(result.value.brand === undefined
        ? {}
        : { functionBrand: result.value.brand }),
      signatures: result.value.signatures,
    },
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  assert.ok(
    emitted.value.signatures.every(
      (signature) => signature.identity !== undefined,
    ),
  );
});
test("equal native ABIs retain different semantic callback identities", () => {
  assert.equal(typeof signatures.bindManagedJitSignatures, "function");
  const p = prepare(
    "export function execute(x:number):number{return useLeft((v:Box):number=>v.n)+useRight((v:Tag):number=>v.m);}",
  );
  const result = signatures.bindManagedJitSignatures(
    p.program,
    p.lowered,
    directory.value.directory,
    p.direct,
  );
  assert.ok(result.ok, JSON.stringify(result));
  const members = result.value.signatures.filter(
    (binding) =>
      binding.localFunctions?.length && binding.witness === undefined,
  );
  assert.equal(members.length, 2);
  assert.notEqual(members[0]!.contract, members[1]!.contract);
  assert.deepEqual(members[0]!.parameters, members[1]!.parameters);
  assert.equal(members[0]!.returnType, members[1]!.returnType);
});
test("classless declarations may remain private when every use is a direct call", () => {
  assert.equal(typeof signatures.bindManagedJitSignatures, "function");
  const p = prepare(
    "export function execute(x:number):number{function h(v:boolean):number{return x;}return h(true)+h(false);}",
  );
  const result = signatures.bindManagedJitSignatures(
    p.program,
    p.lowered,
    directory.value.directory,
    p.direct,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.value.privateWitnesses.length > 0);
  assert.equal(result.value.signatures.length, 0);
  assert.equal(result.value.brand, undefined);
});
for (const [label, text, message] of [
  [
    "escaping arrow",
    "export function execute(x:number):number{return keep((v:string):string=>v);}",
    "without an exact surface",
  ],
  [
    "escaping helper",
    "export function execute(x:number):number{function h(v:boolean):number{return 1;}keep(h);return h(true);}",
    "without an exact surface",
  ],
  [
    "classless execute value",
    'export function execute(x:number):string{keep(execute);return "x";}',
    "without an exact surface",
  ],
  [
    "variance",
    "export function execute(x:number):number{const f=(v:number):number=>v;const w:Wide=f;return w(x)??0;}",
    "variance crosses",
  ],
] as const)
  test("callback binder rejects " + label, () => {
    assert.equal(typeof signatures.bindManagedJitSignatures, "function");
    const p = prepare(text);
    const result = signatures.bindManagedJitSignatures(
      p.program,
      p.lowered,
      directory.value.directory,
      p.direct,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, new RegExp(message));
  });
test("callback binder rejects missing aliases and missing semantic witnesses", () => {
  assert.equal(typeof signatures.bindManagedJitSignatures, "function");
  const p = prepare(
    "export function execute(x:number):number{return apply((v:number):number=>v,x);}",
  );
  const aliases = new Map(p.program.aliasTypes);
  aliases.delete(directory.value.directory.signatures[0]!.alias);
  assert.equal(
    signatures.bindManagedJitSignatures(
      { ...p.program, aliasTypes: aliases },
      p.lowered,
      directory.value.directory,
      p.direct,
    ).ok,
    false,
  );
  const bad = {
    ...p.lowered,
    signatureTypes: new Uint32Array(p.lowered.signatureTypes!.length),
  };
  const result = signatures.bindManagedJitSignatures(
    p.program,
    bad,
    directory.value.directory,
    p.direct,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /semantic witness/);
});

test("a callback witness cannot be repointed at a constructed closure", () => {
  assert.equal(typeof signatures.bindManagedJitSignatures, "function");
  const p = prepare(
    "export function execute(x:number):number{return apply((v:number):number=>v,x);}",
  );
  const created = p.lowered.module.functions
    .flatMap((fn) => fn.blocks.flatMap((block) => block.instructions))
    .find((op) => op.kind === "function-new");
  assert.ok(created?.kind === "function-new");
  const source = p.lowered.sources[created.target];
  assert.ok(source !== undefined);
  const type = managedFunctionType(p.program.checked, source);
  assert.ok(type !== undefined);
  const original = p.lowered.entries.indexOf(source);
  assert.ok(original >= 0);
  const witnessTypes = p.lowered.signatureTypes!.slice();
  witnessTypes[type] = original + 1;
  const result = signatures.bindManagedJitSignatures(
    p.program,
    { ...p.lowered, signatureTypes: witnessTypes },
    directory.value.directory,
    p.direct,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /witness used as a closure/);
});

test("managed entry assembly emits and selects every identity before returning code", async () => {
  const entry =
    await import("../packages/compiler/src/native/managed-jit-entry.ts");
  assert.equal(typeof entry.prepareManagedSurfaceEntry, "function");
  const functions = Array.from(
    {
      length:
        canonicalSurface.entries.length + directory.value.witnesses.length,
    },
    () => () => undefined,
  );
  const exported = {
    directory: directory.value.directory,
    table: undefined,
    functions,
    records: Float64Array.from(
      directory.value.directory.records,
      (_, i) => 0x100000 + i * 1024,
    ),
    entries: new Float64Array(0),
  };
  const read = compiler.readManagedSurfaceDirectory(exported, "typed", {
    domain: () => 17,
    descriptor: () => 0x200000,
    signature: (fn) =>
      0x300000 + functions.indexOf(fn as () => undefined) * 128,
  });
  assert.ok(read.ok, JSON.stringify(read));
  const module = parse(
    'import {apply} from "runtime";export function execute(x:number):number{return apply((v:number):number=>v+1,x);}',
  );
  const request = {
    module,
    entry: "execute",
    read: read.value,
    runtime,
    specifiers: new Set(["runtime"]),
    instantiations: new Map<string, readonly string[]>(),
  };
  const prepared = entry.prepareManagedSurfaceEntry(request);
  assert.ok(prepared.ok, JSON.stringify(prepared));
  assert.equal(prepared.value.native.linkage, "unresolved-managed");
  assert.ok(prepared.value.entryOffset >= 0);
  assert.ok(prepared.value.counts.signatures > 0);
  const first = prepared.value.native.managedImports.find(
    (imported) => imported.role === "signature",
  );
  assert.ok(first);
  const missing = entry.prepareManagedSurfaceEntry({
    ...request,
    read: {
      ...read.value,
      signatures: read.value.signatures.filter(
        (binding) => binding.contract !== first.contract,
      ),
    },
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.stage, "select");
  const foreign = entry.prepareManagedSurfaceEntry({
    ...request,
    module: parse(
      "export function execute(x:number):number{return Math.sin(x);}",
    ),
    runtime: { ...runtime, globals: ["undefined", "Math"] },
  });
  assert.equal(foreign.ok, false);
  if (!foreign.ok)
    assert.match(
      foreign.error.message,
      /unsupported global|unresolved native imports/,
    );
  const frameless = entry.prepareManagedSurfaceEntry({
    ...request,
    read: {
      ...read.value,
      directory: { ...read.value.directory, frame: undefined },
    },
  });
  assert.equal(frameless.ok, false);
  if (!frameless.ok) assert.equal(frameless.error.stage, "profile");
});

test("AOT callback values cannot flow into a different signature class", () => {
  const p = prepare(
    "export function execute(x:number):number{const w:Wide=getInc();return w(x)??0;}",
  );
  const result = signatures.bindManagedJitSignatures(
    p.program,
    p.lowered,
    directory.value.directory,
    p.direct,
  );
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.match(result.error, /function flow crosses surface classes/);
});
test("narrowing an optional AOT callback preserves its exact class", () => {
  const p = prepare(
    "export function execute(x:number):number{const f:((v:number)=>number)|undefined=getInc();return f===undefined?0:f(x);}",
  );
  const result = signatures.bindManagedJitSignatures(
    p.program,
    p.lowered,
    directory.value.directory,
    p.direct,
  );
  assert.ok(result.ok, JSON.stringify(result));
});
test("function flow analysis has a bounded work budget", async () => {
  const flows =
    await import("../packages/compiler/src/native/managed-jit-function-flows.ts");
  assert.equal(typeof flows.checkManagedFunctionFlows, "function");
  const p = prepare(
    "export function execute(x:number):number{const w:Wide=getInc();return w(x)??0;}",
  );
  const result = flows.checkManagedFunctionFlows(
    p.program.checked,
    () => ({ ok: true, value: undefined }),
    () => true,
    1,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /budget exceeded/);
});

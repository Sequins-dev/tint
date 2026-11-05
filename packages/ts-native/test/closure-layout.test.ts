import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { planClosures } from "@tint/ts-native/closure/layout";
const target = {
  pointerSize: 8,
  wordSize: 8,
  allocationAlignment: 16,
  frameAlignment: 16,
  maxAlignment: 16,
} as const;
function graph(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const ast = parseModule(source.value);
  assert.ok(ast.ok);
  const bound = bindModule(ast.value);
  assert.ok(bound.ok);
  return bound.value;
}
function representations(g: ReturnType<typeof graph>) {
  return g.bindings
    .filter((b) => b.captured)
    .map((b) => ({ binding: b.id, size: 8, alignment: 8 }));
}
test("siblings and forwarding closures address the same scope cell layout", () => {
  const g = graph(
    "function f(){ let x=0; return { a:()=>++x, b:()=>x, c:()=>()=>x }; }",
  );
  const r = planClosures(g, representations(g), target, 4096);
  assert.ok(r.ok);
  assert.equal(r.value.environments.length, 1);
  const env = r.value.environments[0];
  assert.ok(env);
  assert.equal(env.lifetime, "activation");
  assert.equal(env.cells[0]?.stateOffset, 0);
  assert.equal(env.cells[0]?.valueOffset, 8);
  assert.equal(env.object.payloadOffset, 16);
  assert.equal(env.object.byteLength, 32);
  assert.equal(r.value.functions[0]?.captures.length, 0);
  for (const f of r.value.functions.slice(1)) {
    assert.equal(f.environments.length, 1);
    assert.equal(f.captures[0]?.environment, env.scope);
    assert.equal(f.captures[0]?.pointerOffset, 0);
    assert.equal(f.captures[0]?.valueOffset, 8);
  }
});
test("scope entry and iteration copying remain distinct from binding initialization", () => {
  const g = graph(
    "function f(p){ const a=()=>p; { const x=1; const b=()=>x; } for(let i=0;i<3;i++){ const c=()=>i; } for(const k=0;k<1;){ const d=()=>k; break; } return a; }",
  );
  const r = planClosures(g, representations(g), target, 4096);
  assert.ok(r.ok);
  assert.deepEqual(
    r.value.environments.map((e) => e.lifetime),
    ["activation", "block-entry", "loop-entry", "loop-entry"],
  );
  assert.equal(r.value.environments[0]?.cells[0]?.initialize, "parameter");
  assert.equal(r.value.environments[1]?.cells[0]?.initialize, "declaration");
  assert.equal(r.value.environments[1]?.cells[0]?.mutable, false);
  assert.equal(r.value.environments[2]?.iterationCopies.length, 1);
  assert.equal(r.value.environments[3]?.iterationCopies.length, 0);
});
test("mutually recursive closures share an environment established before function initialization", () => {
  const g = graph(
    "function outer(){ function a(){ return b; } function b(){ return a; } return a; }",
  );
  const r = planClosures(g, representations(g), target, 4096);
  assert.ok(r.ok);
  assert.equal(r.value.environments.length, 1);
  assert.deepEqual(
    r.value.environments[0]?.cells.map((c) => c.initialize),
    ["function", "function"],
  );
  assert.equal(
    r.value.functions[1]?.environments[0]?.scope,
    r.value.functions[2]?.environments[0]?.scope,
  );
});
test("representation validation rejects incomplete, duplicate and unneeded assignments", () => {
  const g = graph("function f(){ let x=0; return ()=>x; }");
  const reps = representations(g);
  for (const input of [
    [],
    [...reps, ...reps],
    [...reps, { binding: 0, size: 8, alignment: 8 }],
    [{ binding: 1, size: 8, alignment: 3 }],
  ]) {
    const r = planClosures(g, input, target, 4096);
    assert.ok(!r.ok);
    assert.equal("value" in r, false);
  }
  assert.ok(!planClosures(g, reps, target, 24).ok);
});
test("32-bit layout is explicit and unrelated lexical scopes have separate environment pointers", () => {
  const g = graph("function f(x){ { let y=1; return ()=>x+y; } }");
  const r = planClosures(
    g,
    representations(g),
    {
      pointerSize: 4,
      wordSize: 4,
      allocationAlignment: 8,
      frameAlignment: 8,
      maxAlignment: 8,
    },
    4096,
  );
  assert.ok(r.ok);
  assert.equal(r.value.functions[1]?.layout.size, 8);
  assert.deepEqual(
    r.value.functions[1]?.environments.map((e) => e.pointerOffset),
    [0, 4],
  );
  assert.equal(r.value.environments[0]?.object.payloadOffset, 8);
});

test("capture tables deduplicate environments and layouts snapshot representation inputs", () => {
  const g = graph("function f(a,b){ return ()=>a+b; }");
  const reps = representations(g);
  const r = planClosures(g, reps, target, 4096);
  assert.ok(r.ok);
  assert.equal(r.value.functions[1]?.environments.length, 1);
  assert.equal(r.value.functions[1]?.captures.length, 2);
  assert.deepEqual(
    r.value.environments[0]?.cells.map((c) => [c.stateOffset, c.valueOffset]),
    [
      [0, 8],
      [16, 24],
    ],
  );
  const first = reps[0];
  assert.ok(first);
  first.size = 128;
  assert.equal(r.value.environments[0]?.cells[0]?.storage.size, 8);
  const again = planClosures(g, representations(g).reverse(), target, 4096);
  assert.deepEqual(again, r);
});
test("uncaptured locals require no environment or representation", () => {
  const g = graph("function f(a){ let x=a+1; return x; }");
  const r = planClosures(g, [], target, 4096);
  assert.ok(r.ok);
  assert.deepEqual(r.value.environments, []);
  assert.equal(r.value.functions[0]?.layout.size, 0);
});

test("sparse storage representations return INVALID_REPRESENTATIONS", () => {
  const g = graph("function f(){let x=1;return ()=>x;}");
  const storage = representations(g);
  delete storage[0];
  assert.deepEqual(planClosures(g, storage, target, 4096), {
    ok: false,
    error: "INVALID_REPRESENTATIONS",
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";

function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}

function checkWithVisits(text: string) {
  const module = parse(text);
  const original = Set.prototype[Symbol.iterator];
  let visits = 0;
  Set.prototype[Symbol.iterator] = function* () {
    for (const value of original.call(this)) {
      visits++;
      yield value;
    }
    return undefined;
  };
  try {
    const result = checkClosureModule(module);
    return { result, visits };
  } finally {
    Set.prototype[Symbol.iterator] = original;
  }
}

test("independent declarations do not rescan earlier flow facts", () => {
  const count = 500;
  const { result, visits } = checkWithVisits(
    Array.from({ length: count }, (_, i) => `const v${i}:number=${i};`).join(
      "\n",
    ),
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(
    visits < count * 30,
    `${visits} Set entries visited for ${count} independent declarations`,
  );
});

test("binding reads do not visit unrelated presence facts", () => {
  const count = 512;
  const { result, visits } = checkWithVisits(
    Array.from(
      { length: count },
      (_, i) => `const v${i}:number=${i === 0 ? "0" : `v${i - 1}`};`,
    ).join("\n"),
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(visits < count * 30, `${visits} visits for ${count} binding reads`);
});

test("discriminant alternatives do not rescan unrelated bindings", () => {
  const count = 256;
  const variants = Array.from(
    { length: count },
    (_, i) =>
      `{readonly kind:'t${i}';readonly ${i === 0 ? "value:number" : "other:string"}}`,
  ).join("|");
  const declarations = Array.from(
    { length: count },
    (_, i) => `const v${i}:number=${i};`,
  ).join("\n");
  const { result, visits } = checkWithVisits(
    `type R=${variants};function f(a:R):number{${declarations}if(a.kind==='t0')return a.value;return 0;}`,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(
    visits < count * 64,
    `${visits} visits for ${count} alternatives and unrelated bindings`,
  );
});

test("writes forget only their binding's object and property narrowing", () => {
  const header =
    "type R={readonly ok:true;readonly value:number}|{readonly ok:false;readonly error:string};";
  const check = (body: string) => checkClosureModule(parse(header + body));
  const valid = check(
    "function f(a:R,b:R):number{if(!a.ok)return 0;if(!b.ok)return 0;a={ok:false,error:'x'};return b.value;}",
  );
  assert.ok(valid.ok, JSON.stringify(valid));
  for (const body of [
    "function f(a:R):number{if(!a.ok)return 0;a={ok:false,error:'x'};return a.value;}",
    "interface O{value?:number} function f(a:O):number{if(a.value===undefined)return 0;a={};return a.value;}",
  ])
    assert.equal(check(body).ok, false, body);
});

test("token lookup preserves nested refinements and branch restoration", () => {
  const header =
    "type R={readonly kind:'a';readonly ready:true;readonly value:number}|{readonly kind:'a';readonly ready:false;readonly error:string}|{readonly kind:'b';readonly ready:true;readonly other:boolean};";
  for (const [expected, body] of [
    [
      true,
      "function f(a:R,b:R):number{if(a.kind!=='a')return 0;if(!a.ready)return 0;if(b.kind!=='a')return 0;if(!b.ready)return 0;b={kind:'b',ready:true,other:true};return a.value;}",
    ],
    [
      true,
      "function f(a:R,flag:boolean):number{if(flag){if(a.kind==='a'&&a.ready)return a.value;}if(a.kind==='a'&&a.ready)return a.value;return 0;}",
    ],
    [
      false,
      "function f(a:R,flag:boolean):number{if(flag){if(a.kind==='a'&&a.ready)return a.value;}return a.value;}",
    ],
  ] as const) {
    const checked = checkClosureModule(parse(header + body));
    assert.equal(checked.ok, expected, JSON.stringify(checked));
  }
});

test("entry snapshots preserve loop, handler and unreachable definite assignment", () => {
  for (const body of [
    "function f(flag:boolean):number{let n:number;while(flag){n=1;}return n;}",
    "function f():number{let n:number;try{n=1;}catch{}return n;}",
    "function f(flag:boolean):number{let n:number;if(flag){return 0;n=1;}return n;}",
  ])
    assert.equal(checkClosureModule(parse(body)).ok, false, body);
  const valid = checkClosureModule(
    parse(
      "function f(flag:boolean):number{let n:number;if(flag)n=1;else n=2;return n;}",
    ),
  );
  assert.ok(valid.ok, JSON.stringify(valid));
});

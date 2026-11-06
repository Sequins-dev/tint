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

test("independent declarations do not rescan earlier flow facts", () => {
  const count = 500;
  const module = parse(
    Array.from({ length: count }, (_, i) => `const v${i}:number=${i};`).join(
      "\n",
    ),
  );
  const original = Set.prototype[Symbol.iterator];
  let visits = 0;
  Set.prototype[Symbol.iterator] = function* () {
    for (const value of original.call(this)) {
      visits++;
      yield value;
    }
    return undefined;
  };
  let result;
  try {
    result = checkClosureModule(module);
  } finally {
    Set.prototype[Symbol.iterator] = original;
  }
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(
    visits < count * 30,
    `${visits} Set entries visited for ${count} independent declarations`,
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

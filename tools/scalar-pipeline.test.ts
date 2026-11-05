import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkModule } from "@tint/typescript/checker";
import { lowerModule, lowerFunction } from "@tint/ts-native/scalar";
import { verify, type ModuleIR } from "@tint/ir/scalar";
function compile(text: string): ModuleIR {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.equal(source.ok, true);
  const syntax = parseModule(source.value);
  assert.equal(syntax.ok, true);
  const checked = checkModule(syntax.value);
  assert.equal(checked.ok, true);
  const lowered = lowerModule(checked.value);
  assert.equal(lowered.ok, true);
  assert.equal(verify(lowered.value).ok, true);
  return lowered.value;
}
// Test-only semantic oracle. No interpreter is shipped in any portable package.
function execute(
  module: ModuleIR,
  args: readonly (number | boolean)[],
  entry = 0,
): number | boolean | undefined {
  let budget = 100000;
  function call(
    id: number,
    args: readonly (number | boolean)[],
  ): number | boolean | undefined {
    const f = module.functions[id];
    assert.ok(f);
    const slots: (number | boolean | undefined)[] = f.slots.map(
      () => undefined,
    );
    f.parameters.forEach((p, i) => {
      slots[p] = args[i];
    });
    let block = f.entry;
    for (;;) {
      assert.ok(--budget > 0, "test execution budget");
      const b = f.blocks[block];
      assert.ok(b);
      const values = new Map<number, number | boolean>();
      const use = (id: number) => {
        const v = values.get(id);
        assert.notEqual(v, undefined);
        return v!;
      };
      for (const op of b.instructions) {
        switch (op.kind) {
          case "constant":
            values.set(op.id, op.value);
            break;
          case "load": {
            const v = slots[op.slot];
            assert.notEqual(v, undefined);
            values.set(op.id, v!);
            break;
          }
          case "store":
            slots[op.slot] = use(op.value);
            break;
          case "unary":
            values.set(
              op.id,
              op.operator === "truthy"
                ? Boolean(use(op.operand))
                : op.operator === "ceil"
                  ? Math.ceil(Number(use(op.operand)))
                  : new Function("a", `return ${op.operator}a`)(
                      use(op.operand),
                    ),
            );
            break;
          case "binary":
            values.set(
              op.id,
              new Function("a", "b", `return a ${op.operator} b`)(
                use(op.left),
                use(op.right),
              ),
            );
            break;
          case "call": {
            const result = call(op.target, op.arguments.map(use));
            if (op.id !== undefined) {
              assert.notEqual(result, undefined);
              values.set(op.id, result!);
            }
            break;
          }
        }
      }
      const t = b.terminator;
      if (t.kind === "return")
        return t.value === undefined ? undefined : use(t.value);
      if (t.kind === "throw-literal") throw t.value;
      if (t.kind === "throw")
        throw new Error("general exceptions are verified by the native gate");
      if (t.kind === "trap") throw new Error("trap in test interpreter");
      if (t.kind === "record" || t.kind === "record-cell")
        throw new Error("record memory is outside this test interpreter");
      if (t.kind === "cell")
        throw new Error(
          "environment cells are verified by the native gate, not this scalar test interpreter",
        );
      block =
        t.kind === "jump"
          ? t.target
          : use(t.condition)
            ? t.consequent
            : t.alternate;
    }
  }
  return call(entry, args);
}
test("checked source lowers to verified deterministic IR with source spans", () => {
  const text = "export function f(x:number):number { return x+2; }";
  const a = compile(text),
    b = compile(text);
  assert.deepEqual(a, b);
  assert.equal(a.functions[0]?.exported, true);
  assert.equal(execute(a, [40]), 42);
  for (const f of a.functions)
    for (const b of f.blocks)
      for (const op of b.instructions)
        assert.ok(text.slice(op.start, op.end).length > 0);
});
test("lowering preserves operand snapshots and argument evaluation order", () => {
  const binary = compile("function f(x:number):number { return x + (x=2); }");
  assert.equal(execute(binary, [5]), 7);
  const calls = compile(
    "function f(x:number):number { return g(x,x=2); } function g(a:number,b:number):number { return a*10+b; }",
  );
  assert.equal(execute(calls, [5]), 52);
  const conditional = compile(
    "function f(x:number):number { return x+(x>0 ? (x=2) : (x=3)); }",
  );
  assert.equal(execute(conditional, [5]), 7);
  assert.equal(execute(conditional, [-5]), -2);
});
test("short circuit and conditionals execute only the selected side and preserve operand values", () => {
  const a = compile(
    "function f(x:boolean):number { let y=0; x && ((y=1)>0); x || ((y=2)>0); return y; }",
  );
  assert.equal(execute(a, [true]), 1);
  assert.equal(execute(a, [false]), 2);
  const b = compile("function f(x:number):number { return x || 7; }");
  for (const x of [0, -0, NaN, 1, -2, Infinity])
    assert.equal(execute(b, [x]), x || 7);
  const c = compile("function f(x:number):number { return x && 7; }");
  for (const x of [0, -0, NaN, 1, -2, Infinity])
    assert.ok(Object.is(execute(c, [x]), x && 7));
});
test("loops, break, continue, shadowing, recursion and void calls compose", () => {
  const loop = compile(
    "function f(x:number):number { let sum=0; while(x>0){x=x-1; if(x===3) continue; if(x===1) break; {const x=2;sum=sum+x;} } return sum; }",
  );
  assert.equal(execute(loop, [6]), 6);
  assert.equal(execute(loop, [0]), 0);
  const recursive = compile(
    "function f(x:number):number { if(x<=1) return 1; return x*f(x-1); }",
  );
  assert.equal(execute(recursive, [6]), 720);
  const empty = compile(
    "function f():void { g(); } function g():void { return; }",
  );
  assert.equal(execute(empty, []), undefined);
});
test("Number behavior survives scalar lowering without integer substitution", () => {
  const ir = compile(
    "function f(x:number,y:number):number { return (x+y)*2/(x-y); }",
  );
  for (const x of [0, -0, NaN, Infinity, -Infinity, 0.1, 2 ** 40])
    for (const y of [0, -0, NaN, 1, -3.25])
      assert.ok(Object.is(execute(ir, [x, y]), ((x + y) * 2) / (x - y)));
});
test("nested control flow produces complete blocks and preserves loop-condition effects", () => {
  const source =
    "function f(x:number):number { let y=0; while((x=x-1)>0 && x<10) { if(x===2){y=y+20;}else{y=y+1;} } if(y>0) {if(x===0)return y;else return -y;}else return x; }";
  const ir = compile(source);
  function reference(x: number): number {
    let y = 0;
    while ((x = x - 1) > 0 && x < 10) {
      if (x === 2) {
        y = y + 20;
      } else {
        y = y + 1;
      }
    }
    if (y > 0) {
      if (x === 0) return y;
      else return -y;
    } else return x;
  }
  for (let x = -2; x < 15; x++) assert.equal(execute(ir, [x]), reference(x));
  const operators = [
    "+",
    "-",
    "*",
    "/",
    "%",
    "<<",
    ">>",
    ">>>",
    "&",
    "|",
    "^",
    "<",
    ">",
    "<=",
    ">=",
    "===",
    "!==",
    "==",
    "!=",
  ];
  for (const op of operators) {
    const isBoolean = ["<", ">", "<=", ">=", "===", "!==", "==", "!="].includes(
      op,
    );
    const ir = compile(
      `function f(x:number,y:number):${isBoolean ? "boolean" : "number"}{return x ${op} y;}`,
    );
    const reference = new Function("x", "y", `return x ${op} y`);
    for (const x of [0, -0, NaN, Infinity, -1, 0.5, 2 ** 40])
      assert.ok(Object.is(execute(ir, [x, 3]), reference(x, 3)));
  }
});

test("for loops preserve scope, update-on-continue and break ordering", () => {
  const ir = compile(`export function main():number {
    let total=0; let i=100;
    for(let i=0;i<6;i=i+1){if(i===2)continue;if(i===5)break;total=total+i;}
    for(;total<10;){total=total+1;}
    for(;;){break;}
    return total+i;
  }`);
  assert.equal(execute(ir, []), 110);
});

test("for headers retain lexical diagnostics and require explicit separators", () => {
  for (const body of [
    "for(let i in {}){} return 0;",
    "for(let i=0;i<1;i=i+1){} return i;",
    "let i=2; for(let i=i;i<3;i=i+1){} return 0;",
    "for(const i=0;i<2;i=i+1){} return 0;",
    "for(let i=0;i<1;i=i+1){} i=2; return 0;",
  ]) {
    const bytes = new TextEncoder().encode(`function f():number{${body}}`);
    const source = createSourceText(bytes, bytes.length);
    assert.equal(source.ok, true);
    const parsed = parseModule(source.value);
    assert.equal(parsed.ok, true);
    assert.equal(checkModule(parsed.value).ok, false, body);
  }
  for (const body of ["for(let i=0\ni<1;i=i+1){}", "for(let i,j of x){}"]) {
    const bytes = new TextEncoder().encode(`function f():void{${body}}`);
    const source = createSourceText(bytes, bytes.length);
    assert.equal(source.ok, true);
    assert.equal(parseModule(source.value).ok, false, body);
  }
});

test("nested for loops target the correct update and permit expression initializers", () => {
  const ir = compile(`function main():number {
    let i=9; let total=0;
    for(i=0;i<3;i=i+1){for(let j=0;j<4;j=j+1){if(j===1)continue;if(j===3)break;total=total+10*i+j;}}
    return total;
  }`);
  assert.equal(execute(ir, []), 66);
});

test("local updates and compound assignments preserve snapshots and result values", () => {
  const ir = compile(`function main():number {
    let x=2;let old=x++;let next=++x;let down=x--;let last=--x;
    let total=old*1000+next*100+down*10+last;
    x=5;x+=(x=3);total+=x;
    for(let i=0;i<3;i++){total+=i;}
    return total;
  }`);
  assert.equal(execute(ir, []), 2453);
});

test("update parsing respects line breaks, assignment targets and punctuation tokens", () => {
  assert.equal(
    execute(
      compile(`function main():number{let x=1;let y=2;x\n++y;return x*10+y;}`),
      [],
    ),
    13,
  );
  for (const body of [
    'let x=1; x "+=" 2;',
    "let x=1;(x+1)++;",
    "let x=1;++x++;",
  ]) {
    const bytes = new TextEncoder().encode(`function f():void{${body}}`);
    const source = createSourceText(bytes, bytes.length);
    assert.equal(source.ok, true);
    assert.equal(parseModule(source.value).ok, false, body);
  }
});

test("updates reject immutable, nonnumeric and array-element targets", () => {
  for (const text of [
    "function f():number{const x=1;return x++;}",
    "function f():number{let x=true;return ++x;}",
    "function f():number{const x=1;x+=2;return x;}",
    "function f():number{let x=1;x+=false;return x;}",
    "function f(a:Uint32Array):void{a[0]++;}",
    "function f(a:Uint32Array):void{a[0]+=1;}",
  ]) {
    const bytes = new TextEncoder().encode(text),
      source = createSourceText(bytes, bytes.length);
    assert.equal(source.ok, true);
    const parsed = parseModule(source.value);
    assert.equal(parsed.ok, true);
    assert.equal(checkModule(parsed.value).ok, false, text);
  }
});

test("floor lowers through numeric IR and preserves signed zero and exceptional values", () => {
  const ir = compile(
    "function f(n:number):number{return Math.floor(n);}function safe():number{return Number.MAX_SAFE_INTEGER;}",
  );
  for (const value of [
    0,
    -0,
    1.25,
    -1.25,
    Number.MIN_VALUE,
    -Number.MIN_VALUE,
    Infinity,
    -Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER,
  ])
    assert.ok(
      Object.is(execute(ir, [value]), Math.floor(value)),
      String(value),
    );
  assert.equal(execute(ir, [], 1), Number.MAX_SAFE_INTEGER);
});

test("do-while runs its body first and routes continue through the test", () => {
  const once = compile(
    "function run():number{let count=0;do{count++;}while(false);return count;}",
  );
  assert.equal(execute(once, []), 1);
  const control = compile(
    "function run():number{let count=0;let tests=0;do{count++;if(count<3)continue;if(count===4)break;}while((tests=tests+1)<9);return count*10+tests;}",
  );
  assert.equal(execute(control, []), 43);
  const returns = compile("function run():number{do{return 7;}while(false);}");
  assert.equal(execute(returns, []), 7);
});

test("comma expressions preserve side effects, separators and the final value", () => {
  const module = compile(
    "function ignore():void{return;}function add(a:number,b:number):number{return a+b;}function run():number{let x=0,y=3;const value=(ignore(),x=1,x=x+2,x);for(x=0,y=0;x<2;x++,y=y+2){}return add((x=4,x),y)+value;}",
  );
  assert.equal(execute(module, [], 2), 11);
  const condition = compile(
    "function run():number{let x=0;if(x=2,x===2)return (x=3,x+4);return 0;}",
  );
  assert.equal(execute(condition, []), 7);
});

test("dense scalar value and block IDs avoid growing linear lookup tables", () => {
  const source =
    "function f(x:number):number{" +
    Array.from({ length: 100 }, (_, i) => `x=x+${i};if(x<0)x=-x;`).join("") +
    "return x;}";
  const bytes = new TextEncoder().encode(source),
    text = createSourceText(bytes, bytes.length);
  assert.ok(text.ok);
  const parsed = parseModule(text.value);
  assert.ok(parsed.ok);
  const checked = checkModule(parsed.value);
  assert.ok(checked.ok);
  const get = Map.prototype.get,
    has = Set.prototype.has;
  let work = 0;
  Map.prototype.get = function (key) {
    if (typeof key === "number") work += this.size;
    return get.call(this, key);
  };
  Set.prototype.has = function (key) {
    if (typeof key === "number") work += this.size;
    return has.call(this, key);
  };
  let lowered: ReturnType<typeof lowerModule>;
  try {
    lowered = {
      ok: true,
      value: {
        functions: checked.value.functions.map((fn) =>
          lowerFunction(fn, checked.value.functions),
        ),
      },
    };
  } finally {
    Map.prototype.get = get;
    Set.prototype.has = has;
  }
  assert.ok(lowered.ok, JSON.stringify(lowered));
  assert.ok(verify(lowered.value).ok);
  assert.equal(execute(lowered.value, [0]), 4950);
  assert.ok(work < 100000, `dense-ID linked lookup work: ${work}`);
});

test("labelled exits and continues preserve outer loop destinations", () => {
  const module = compile(`function run():number {
    let total=0;
    outer: for(let i=0;i<3;i++) {
      for(let j=0;j<3;j++) {
        if(j===1) continue outer;
        total++;
      }
    }
    done: { total+=39; break done; total=0; }
    return total;
  }`);
  assert.equal(execute(module, []), 42);
});

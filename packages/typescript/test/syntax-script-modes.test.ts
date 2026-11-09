import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceText } from "@tint/source/text";
import * as api from "../src/syntax/index.ts";
function parse(text: string) {
  assert.equal(typeof api.parseScript, "function");
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return api.parseScript(source.value);
}
test("Script parsing preserves sloppy bindings and simple duplicate parameters", () => {
  for (const text of [
    "var eval=1; arguments=2;",
    "var implements=1; var yield=2;",
    "function f(a,a){return a;}",
    "function f(eval){return eval;}",
  ]) {
    assert.doesNotThrow(() => new Function(text));
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.strict, false);
  }
});
test("own and inherited directives enforce strict function and class contexts", () => {
  for (const text of [
    '"use strict"; var eval=1;',
    'function f(a,a){"use strict";}',
    'function eval(){"use strict";}',
    'function f(eval){"use strict";}',
    'function f(){"use strict";function g(eval){}}',
    "class C{m(eval){}}",
    '(eval)=>{"use strict";}',
    "(a,a)=>a",
    "function f(a,a=1){}",
  ]) {
    assert.throws(() => new Function(text), SyntaxError);
    assert.equal(parse(text).ok, false, text);
  }
});
test("directive detection follows expression boundaries and raw spelling", () => {
  for (const text of [
    '"use strict"\n+"suffix"; var eval=1;',
    '"use strict"\n.toString(); var eval=1;',
    '"use\\x20strict";var eval=1;',
    '("use strict");var eval=1;',
    "`use strict`;var eval=1;",
    ';"use strict";var eval=1;',
    '"use strict"\n[0];var eval=1;',
  ]) {
    assert.doesNotThrow(() => new Function(text));
    const result = parse(text);
    assert.ok(result.ok, text + JSON.stringify(result));
    assert.equal(result.value.strict, false);
  }
  for (const text of [
    '"other"; /*comment*/ "use strict";',
    '"use strict"\nvar x=1;',
    '"use strict"\n++x;',
  ]) {
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.strict, true);
  }
});
test("function strictness restores its enclosing Script context", () => {
  const result = parse(
    'function f(){"use strict";} function g(eval){return eval;} var eval=1;',
  );
  assert.ok(result.ok, JSON.stringify(result));
  const first = result.value.statements[0],
    second = result.value.statements[1];
  assert.equal(first?.kind, "function");
  assert.equal(second?.kind, "function");
  if (first?.kind === "function" && second?.kind === "function") {
    assert.equal(first.strict, true);
    assert.equal(second.strict, false);
  }
});

test("sloppy let identifiers remain distinct from lexical declarations", () => {
  for (const text of [
    "var let=0;let=1;let++;",
    "for(let=0;let<2;let++){}",
    "let value=1;",
    "var let;for(var let of []){}",
  ]) {
    assert.doesNotThrow(() => new Function(text));
    const result = parse(text);
    assert.ok(result.ok, text + JSON.stringify(result));
  }
  for (const text of [
    "let let;",
    "const let=1;",
    "for(let let of []){}",
    "for(const [let] of []){}",
  ]) {
    assert.throws(() => new Function(text), SyntaxError);
    assert.equal(parse(text).ok, false, text);
  }
});
test("named function expressions retain their name and own strict restrictions", () => {
  for (const text of [
    "(function self(){return self;});",
    "(function eval(eval){return eval;});",
    "(function self(self=42){return self;});",
  ]) {
    assert.doesNotThrow(() => new Function(text));
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const text of [
    '(function eval(){"use strict";});',
    '(function arguments(){"use strict";});',
    '(function yield(){"use strict";});',
    '"use strict";(function eval(){});',
  ]) {
    assert.throws(() => new Function(text), SyntaxError);
    assert.equal(parse(text).ok, false, text);
  }
});
test("delete permits values and property references but rejects strict binding references", () => {
  for (const text of [
    "delete absent;",
    "delete (((absent)));",
    "delete obj.x;",
    '"use strict";delete obj[x];',
    '"use strict";delete (0, x);',
    "delete (function(){return 42;})();",
  ]) {
    assert.doesNotThrow(() => new Function(text));
    assert.ok(parse(text).ok, text);
  }
  for (const text of [
    '"use strict";delete x;',
    '"use strict";delete (((x)));',
    'function f(){"use strict";delete x;}',
    "class C{m(){delete x;}}",
  ]) {
    assert.throws(() => new Function(text), SyntaxError);
    assert.equal(parse(text).ok, false, text);
  }
});
test("for-in declaration heads parse with loop context and reject invalid heads", () => {
  for (const text of [
    "for(var x in obj){continue;}",
    "for(let x in obj)break;",
    "for(const x in obj){}",
    "for(var x in first,second){}",
  ]) {
    assert.doesNotThrow(() => new Function(text));
    assert.ok(parse(text).ok, text);
  }
  for (const text of [
    "for(let x=1 in obj){}",
    "for(const x=1 in obj){}",
    "for(var x,y in obj){}",
  ]) {
    assert.throws(() => new Function(text), SyntaxError);
    assert.equal(parse(text).ok, false, text);
  }
});
test("for-in assignment heads accept references and reject non-target expressions", () => {
  for (const text of [
    "for(x in obj){}",
    "for(obj.x in source){}",
    "for(obj[key()] in source){}",
    "for((x) in source){}",
    "for(let in source){}",
  ]) {
    assert.doesNotThrow(() => new Function(text));
    assert.ok(parse(text).ok, text);
  }
  for (const text of [
    "for(x+y in obj){}",
    "for(x=1 in obj){}",
    "for(0 in obj){}",
    "for(obj?.x in source){}",
    '"use strict";for(eval in obj){}',
  ]) {
    assert.throws(() => new Function(text), SyntaxError);
    assert.equal(parse(text).ok, false, text);
  }
});

test("sloppy object methods still require unique formal parameters", () => {
  for (const source of [
    "({m(a,a){}});",
    "({['m'](a,a){}});",
    "let key='m';({[key](a,a){}});",
    "({m(a,a){return ()=>a;}});",
  ]) {
    assert.throws(() => new Function(source), SyntaxError);
    const result = parse(source);
    assert.ok(!result.ok, source);
    assert.equal(result.error.code, "SYNTAX_ERROR");
    assert.match(result.error.message, /duplicate parameter/);
  }
  for (const source of [
    "({m:function(a,a){return a;}});",
    "(function(a,a){return a;});",
    "({m(a){return function(b,b){return b;};}});",
  ]) {
    assert.doesNotThrow(() => new Function(source));
    assert.ok(parse(source).ok, source);
  }
});

test("super properties follow method and lexical-arrow contexts", () => {
  for (const text of [
    "({m(){return super.x;}});",
    "({get x(){return super.x;},set x(v){super.x=v;}});",
    "({m(x=super.x){return ()=>super[x];}});",
    "class C{m(x=super.x){return ()=>super.x;}static m(){return super.x;}x=super.x;}",
    "({m(){return { [super.x](){return super.y;} };}});",
    "({m(){return delete super.x;}});",
  ]) {
    assert.doesNotThrow(() => new Function(text));
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const text of [
    "super.x;",
    "()=>super.x;",
    "function f(){return super.x;}",
    "({m(){return function(){return super.x;};}});",
    "({m(){function f(x=super.x){} }});",
    "({m(){return super;}});",
    "({m(){return super?.x;}});",
    "({[super.x](){}});",
    "class C{[super.x](){}}",
    "({m(){},f:function(){return super.x;}});",
  ]) {
    assert.throws(() => new Function(text), SyntaxError);
    const result = parse(text);
    assert.equal(result.ok, false, text);
    if (!result.ok) assert.equal(result.error.code, "SYNTAX_ERROR", text);
  }
});

test("super calls are restricted to derived constructors and their lexical arrows", () => {
  for (const text of [
    "class B extends A{constructor(){super();}}",
    "class B extends A{constructor(x=super()){}}",
    "class B extends A{constructor(){(()=>super())();}}",
    "class B extends null{constructor(){return {};}}",
  ]) {
    assert.doesNotThrow(() => new Function(text));
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const text of [
    "super();",
    "class B{constructor(){super();}}",
    "class B extends A{m(){super();}}",
    "({m(){super();}});",
    "class B extends A{constructor(){function f(){super();}}}",
    "class B extends A{constructor(){return function(){super();};}}",
    "class B extends A{x=super();}",
    "class B extends A{static constructor(){super();}}",
    "class B extends A{constructor(){new super();}}",
  ]) {
    assert.throws(() => new Function(text), SyntaxError);
    const result = parse(text);
    assert.equal(result.ok, false, text);
    if (!result.ok) assert.equal(result.error.code, "SYNTAX_ERROR", text);
  }
});

test("new.target belongs to function and class element contexts and arrows inherit it", () => {
  for (const text of [
    "function f(a=new.target){return ()=>new.target;}",
    "class C{constructor(){new.target;}m(){return new.target;}x=new.target;static x=new.target;}",
    "({m(){return new.target;}});",
    "function f(){return class extends new.target{[new.target]() {}};}",
  ]) {
    const result = parse(text);
    assert.ok(result.ok, text + ": " + JSON.stringify(result));
  }
  for (const text of [
    "new.target;",
    "()=>new.target;",
    "class C extends new.target{}",
    "class C{[new.target](){}}",
    "function f(){new.other;}",
    "function f(){new.target=1;}",
    "function f(){new.\\u0074arget;}",
  ])
    assert.equal(parse(text).ok, false, text);
});

test("class static blocks establish strict local control-flow contexts", () => {
  for (const text of [
    "class C{static{}static{let x=1;var y=2;}static x=3;}",
    "class C extends B{static{this.x=super.x;this.target=new.target;}}",
    "class C{static{function f(){return 42;}(()=>{return 1;})();while(false){break;}}}",
  ]) {
    assert.doesNotThrow(() => new Function(text));
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
  for (const text of [
    "class C{static{return;}}",
    "function f(){class C{static{return;}}}",
    "while(true){class C{static{break;}}}",
    "class C extends B{static{super();}}",
    "class C{static{with({}){}}}",
  ]) {
    assert.throws(() => new Function(text), SyntaxError);
    assert.equal(parse(text).ok, false, text);
  }
});

test("static blocks reserve await without leaking that restriction into nested functions", () => {
  for (const text of [
    "class C{static{await;}}",
    "class C{static{var await;}}",
    "class C{static{class D{[await](){}}}}",
  ]) {
    const result = parse(text);
    assert.equal(result.ok, false, text);
    if (!result.ok) assert.equal(result.error.code, "SYNTAX_ERROR");
  }
  for (const text of [
    "class C{static{(()=>await);}}",
    "class C{static{(()=>{var await;});}}",
    "class C{static{function f(await){return await;}}}",
  ])
    assert.ok(parse(text).ok, text);
});

test("private class elements and member references preserve their distinct syntax", () => {
  for (const text of [
    "class C{#x=1;static #y;#m(){return this.#x;}get #v(){return this.#x;}set #v(x){this.#x=x;}m(o){return o?.#x;}}",
    "class C{#default;#\\u0078; m(){this.#x++;this.#default=1;}}",
  ]) {
    assert.doesNotThrow(() => new Function(text));
    assert.ok(parse(text).ok, text);
  }
  for (const text of [
    "class C{#constructor;}",
    "class C{#x; m(){delete this.#x;}}",
    "class C extends B{#x; m(){return super.#x;}}",
  ]) {
    assert.throws(() => new Function(text), SyntaxError);
    assert.equal(parse(text).ok, false, text);
  }
});
test("invalid JavaScript grammar reports syntax errors rather than missing features", () => {
  for (const text of [
    "class C extends () => {} {}",
    "const x = ;",
    "a b;",
    "if (x) {} else {} else {}",
    "catch(e){}",
    "var x = yield 1;",
  ]) {
    assert.throws(() => new Function(text), SyntaxError);
    const result = parse(text);
    assert.equal(result.ok, false, text);
    if (!result.ok) assert.equal(result.error.code, "SYNTAX_ERROR", text);
  }
});
test("a leading `interface` is a sloppy JavaScript identifier, never a declaration (staging/sm/misc/future-reserved-words.js)", () => {
  for (const text of [
    "interface = 'foo';",
    "interface;",
    "interface\nfoo",
    "interface++;",
    "if (1) interface = 2;",
    "interface: while (false);",
  ]) {
    assert.doesNotThrow(() => new Function(text));
    const result = parse(text);
    assert.ok(result.ok, `${text}: ${JSON.stringify(result)}`);
  }
  for (const text of ["'use strict'; interface = 1;", "interface Foo {}"]) {
    assert.throws(() => new Function(text), SyntaxError);
    assert.equal(parse(text).ok, false, text);
  }
});

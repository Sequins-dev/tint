import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule, rewriteModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { linkModules, specializeModule } from "@tint/ts-native/modules";
import { checkClosureModule } from "@tint/typescript/checker";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
test("spread operands participate in binding, capture and linking", () => {
  const module = parse(
    "export function run(items:number[], input:{x:number}):void {const copy=()=>[...items];const object=()=>({...input});}",
  );
  const bound = bindModule(module);
  assert.ok(bound.ok, JSON.stringify(bound));
  for (const name of ["items", "input"])
    assert.ok(bound.value.bindings.find((b) => b.name === name)?.captured);
  const linked = linkModules(
    [{ id: "main", module, dependencies: new Map() }],
    "main",
    [],
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  const rebound = bindModule(linked.value.module);
  assert.ok(rebound.ok, JSON.stringify(rebound));
  let spreads = 0;
  rewriteModule(linked.value.module, {
    expression(mapped, node) {
      const operands =
        node.kind === "spread"
          ? [node]
          : node.kind === "object"
            ? node.properties.filter((p) => p.kind === "spread")
            : [];
      for (const operand of operands) {
        spreads++;
        assert.ok(linked.value.origins.has(operand));
        assert.ok(
          operand.value.kind === "identifier" &&
            operand.value.name.startsWith("@"),
        );
      }
      return mapped;
    },
  });
  assert.equal(spreads, 2);
  for (const text of ["const x=[...missing];", "const x={...missing};"])
    assert.ok(!bindModule(parse(text)).ok);
});
test("spread syntax reaches explicit semantic diagnostics after specialization", () => {
  for (const expression of ["[...value]", "({...value})"]) {
    const module = parse(
      `function copy<T>(value:T):void { const result=${expression}; }function run(value:string):void {copy<string>(value);}`,
    );
    const bound = bindModule(module);
    assert.ok(bound.ok);
    const specialized = specializeModule(module, bound.value);
    assert.ok(specialized.ok, JSON.stringify(specialized));
    assert.ok(bindModule(specialized.value.module).ok);
    const checked = checkClosureModule(specialized.value.module);
    assert.ok(!checked.ok);
    assert.match(checked.error.message, /spread requires/);
  }
});

test("numeric typed-array spread checks element compatibility and infers a numeric result", () => {
  for (const source of [
    "function copy(source:Uint8Array):number[]{return [...source];}",
    "function copy(source:Float64Array):number[]{return [1,...source,2];}",
    "function copy(source:Uint16Array):number{const result=[...source];return result.length;}",
  ]) {
    const checked = checkClosureModule(parse(source));
    assert.ok(checked.ok, JSON.stringify(checked));
  }
  for (const source of [
    "function copy(source:Uint8Array):string[]{return [...source];}",
    "function copy(source:string):string[]{return [...source];}",
  ])
    assert.ok(!checkClosureModule(parse(source)).ok, source);
});

test("numeric array spread preserves inferred holes and accepts a compatible written result", () => {
  for (const source of [
    "function copy(source:number[]):number[]{return [...source];}",
    "function copy(source:number[]):number[]{return [1,...source,2];}",
    "function copy(source:number[]):(number|undefined)[]{return [...source];}",
    "function copy(source:number[]):number{const result=[...source];result.push(undefined);return result.length;}",
    "function copy():(number|undefined)[]{return [undefined,1];}",
  ])
    assert.ok(checkClosureModule(parse(source)).ok, source);
  assert.ok(
    !checkClosureModule(
      parse(
        "function copy(source:(number|undefined)[]):number[]{return [...source];}",
      ),
    ).ok,
  );
  assert.ok(
    !checkClosureModule(
      parse("function run():void{const a:number[]=[1];a.push(undefined);}"),
    ).ok,
  );
});

test("string and object array spreads retain nullable elements and reject incompatible contexts", () => {
  for (const source of [
    "function copy(source:string[]):(string|undefined)[]{return [...source];}",
    "function copy(source:string[]):number{const result=[...source];result.push(undefined);return result.length;}",
    "type Item={value:number};function copy(source:Item[]):(Item|undefined)[]{return [...source];}",
    "type Item={value:number};function copy(source:Item[]):number{const result=[...source];result.push(undefined);return result.length;}",
  ]) {
    const checked = checkClosureModule(parse(source));
    assert.ok(checked.ok, JSON.stringify(checked));
  }
  for (const source of [
    "function copy(source:string[]):string[]{return [...source];}",
    "type Item={value:number};function copy(source:Item[]):Item[]{return [...source];}",
    "function copy(source:string[]):(number|undefined)[]{return [...source];}",
  ])
    assert.ok(!checkClosureModule(parse(source)).ok, source);
});

test("fixed object spread checks overwrite order and optional presence", () => {
  for (const source of [
    "function copy(source:{x:number}):{x:number}{return {...source};}",
    "function copy(source:{x:string}):{x:number}{return {...source,x:1};}",
    "function copy(source:{x?:number}):{x:number}{return {x:1,...source};}",
    "function copy(source:{x:number}):number{const result={...source,y:2};return result.x+result.y;}",
    "function copy(source:{readonly x:number}):number{const result={...source};result.x=2;return result.x;}",
    "function copy(source:{x?:string}):{x:number}{return {...source,x:1};}",
  ]) {
    const checked = checkClosureModule(parse(source));
    assert.ok(checked.ok, JSON.stringify(checked));
  }
  for (const source of [
    "function copy(source:{x:string}):{x:number}{return {x:1,...source};}",
    "function copy(source:{x?:number}):{x:number}{return {...source};}",
    "function copy(source:{x?:string}):{x:number}{return {x:1,...source};}",
    "function copy(source:{x?:number|undefined}):{x:number}{return {x:1,...source};}",
  ])
    assert.ok(!checkClosureModule(parse(source)).ok, source);
});

test("object spread accepts an optional object context without making the result absent", () => {
  const result = checkClosureModule(
    parse(`interface Token {readonly kind:"token";value:number}
    function run(token:Token):number {
      const copy:Token|undefined={...token,value:2};
      return copy.value;
    }
    function insert(token:Token):void {const items:(Token|undefined)[]=[];items.splice(0,0,{...token,value:3});}`),
  );
  assert.ok(result.ok, JSON.stringify(result));
  const bad = checkClosureModule(
    parse(`interface Token {value:number}
    function run(token:Token):Token|undefined{return {...token,value:"wrong"};}`),
  );
  assert.equal(bad.ok, false);
});

test("spread selects a union context after ordered field overwrites", () => {
  for (const source of [
    'type Node={readonly kind:"a";value:number;readonly?:boolean}|{readonly kind:"b";label:string};function copy(node:Node):Node{if(node.kind!=="a")return node;return {...node,readonly:true};}',
    'type Node={readonly kind:"a";value:number}|{readonly kind:"b";value:number};function copy(node:{readonly kind:"a";value:number}):Node{return {...node,kind:"b"};}',
  ]) {
    const checked = checkClosureModule(parse(source));
    assert.ok(checked.ok, JSON.stringify(checked));
  }
  for (const source of [
    'type Node={readonly kind:"a";value:number}|{readonly kind:"b";value:string};function copy(node:{readonly kind:"a";value:number}):Node{return {...node,kind:"b"};}',
    "type Node={value:number;a?:number}|{value:number;b?:number};function copy(node:{value:number}):Node{return {...node};}",
  ])
    assert.equal(checkClosureModule(parse(source)).ok, false);
});

test("a finite union-valued discriminant does not disable narrowing of other variants", () => {
  const checked = checkClosureModule(
    parse(`type Node={readonly kind:"array";value:number;readonly?:boolean}|{readonly kind:"union"|"intersection";members:number[]};
 function copy(input:Node):Node{let node:Node=input;if(node.kind!=="array")return node;node={...node,readonly:true};return node;}
 function read(node:Node):number{if(node.kind==="array")return node.value;return node.members.length;}`),
  );
  assert.ok(checked.ok, JSON.stringify(checked));
  const unsafe = checkClosureModule(
    parse(
      `type Node={readonly kind:"array";value:number}|{readonly kind:"union"|"intersection";members:number[]};function f(node:Node):number{if(node.kind!=="union")return node.value;return 0;}`,
    ),
  );
  assert.equal(unsafe.ok, false);
});

test("object spread preserves every variant of a finite source union", () => {
  for (const source of [
    'type Node={readonly kind:"a";value:number;start:number}|{readonly kind:"b";label:string;start:number};function copy(node:Node):Node{return {...node,start:2};}',
    'type Node={readonly kind:"a";value:number}|{readonly kind:"b";label:string};function copy(node:Node):Node{const result={...node};return result;}',
    'type Node={readonly kind:"a";value:number}|{readonly kind:"b";value:number};function copy(node:Node):Node{return {...node,kind:"a"};}',
    "function copy(node:{x?:number}|{x:number}):{x:number}{return {x:1,...node};}",
  ]) {
    const checked = checkClosureModule(parse(source));
    assert.ok(checked.ok, JSON.stringify(checked));
  }
  for (const source of [
    'type Node={readonly kind:"a";value:number}|{readonly kind:"b";value:string};function copy(node:Node):Node{return {...node,kind:"a"};}',
    'type Node={readonly kind:"a";value:number}|{readonly kind:"b";label:string};function copy(node:Node):Node{return {...node,kind:"a"};}',
    "function copy(node:{x?:number}|{x:number}):{x:number}{return {...node};}",
    "function copy(node:{x:number}|undefined):{x:number}{return {...node};}",
  ])
    assert.equal(checkClosureModule(parse(source)).ok, false, source);
});

test("object spread contextualizes equivalent array fields across union variants", () => {
  const checked = checkClosureModule(
    parse(`
    type Node = {kind:"a"; items:readonly number[]}|{kind:"b";items:readonly number[]};
    export function copy(node:Node):Node {return {...node,items:[]};}
  `),
  );
  assert.ok(checked.ok, JSON.stringify(checked));
  const rejected = checkClosureModule(
    parse(`
    type Node = {kind:"a"; items:number[]}|{kind:"b";items:string[]};
    export function copy(node:Node):Node {return {...node,items:[1]};}
  `),
  );
  assert.equal(rejected.ok, false);
});

test("Set iteration retains object identity contracts in the source checker", () => {
  const checked = checkClosureModule(
    parse(`
    interface Item {value:number}
    export function total(items:Set<Item>):number {
      let result=0;
      for(const item of items) result+=item.value;
      return result;
    }
  `),
  );
  assert.ok(checked.ok, JSON.stringify(checked));
});

test("default collection parameters retain their declared contracts", () => {
  for (const declaration of [
    "export function size(value:Set<number>=new Set<number>()):number{return value.size;}",
    "export function size(value:Map<string,number>=new Map<string,number>()):number{return value.size;}",
  ]) {
    const checked = checkClosureModule(parse(declaration));
    assert.ok(checked.ok, JSON.stringify(checked));
  }
});

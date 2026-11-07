import { emitDarwinModule } from "./aarch64-executable.ts";
import { buildAArch64Executable } from "./aarch64-executable.ts";
import { numericFixtures } from "./numeric-fixtures.ts";
// Native semantic fixtures. Host APIs and the tiny foreign entry/write adapter are test-only.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule, checkModule } from "@tint/typescript/checker";
import { lowerModule } from "@tint/ts-native/scalar";
import { lowerModuleEntries } from "@tint/ts-native/closure/lowering";

import { optimizeModule } from "@tint/ir/optimization";
import {
  writeInstruction,
  relativeAddress,
  patchBranch,
  type Instruction,
} from "@tint/codegen/aarch64/isa";
assert.equal(
  process.platform,
  "darwin",
  "native scalar verification requires macOS",
);
assert.equal(
  process.arch,
  "arm64",
  "native scalar verification requires arm64",
);
interface Fixture {
  contextual?: boolean;
  arrayLength?: number;
  name: string;
  text: string;
  expected: number | boolean;
}
const fixtures: Fixture[] = [];
function expression(name: string, expr: string, expected: number | boolean) {
  fixtures.push({
    name,
    text: `export function main():${typeof expected}{return ${expr};}`,
    expected,
  });
}
expression("constant", "42", 42);
expression("fraction", "0.1+0.2", 0.1 + 0.2);
expression("negative-zero", "-0", -0);
expression("infinity", "1/0", Infinity);
expression("nan", "0/0", NaN);
expression("subnormal", "5e-324*2", Number.MIN_VALUE * 2);
expression("rounding", "9007199254740992+1", 2 ** 53);
for (const [label, source, x] of [
  ["nan", "(0/0)", NaN],
  ["negative-zero", "(-0)", -0],
  ["fraction", "0.5", 0.5],
  ["infinity", "(1/0)", Infinity],
] as const) {
  for (const op of [
    "+",
    "-",
    "*",
    "/",
    "<",
    "<=",
    ">",
    ">=",
    "===",
    "!==",
  ] as const) {
    const expected = new Function("x", `return x ${op} 0`)(x) as
      number | boolean;
    expression(
      `${label}-${op.replaceAll(/[^a-z]/g, (c) => c.charCodeAt(0).toString(16))}`,
      `${source} ${op} 0`,
      expected,
    );
  }
  expression(label + "-truth", `!${source}`, !x);
  expression(label + "-and", `${source} && 7`, x && 7);
  expression(label + "-or", `${source} || 7`, x || 7);
}
fixtures.push(
  {
    name: "snapshots",
    text: "export function main():number { let x=5; return x+(x=2); }",
    expected: 7,
  },
  {
    name: "call-order",
    text: "export function main():number {let x=5;return g(x,x=2);} function g(a:number,b:number):number{return a*10+b;}",
    expected: 52,
  },
  {
    name: "factorial",
    text: "export function main():number{return f(6);} function f(x:number):number{if(x<=1)return 1;return x*f(x-1);}",
    expected: 720,
  },
  {
    name: "loop",
    text: "export function main():number{let x=6;let sum=0;while(x>0){x=x-1;if(x===3)continue;if(x===1)break;sum=sum+2;}return sum;}",
    expected: 6,
  },
  {
    name: "short-circuit",
    text: "export function main():number{let x=0;false && ((x=1)>0);true || ((x=2)>0);return x;}",
    expected: 0,
  },
  {
    name: "nested-loop",
    text: "export function main():number{let x=0;let n=0;while(x<3){x=x+1;let y=0;while(y<3){y=y+1;if(y===2)break;n=n+1;}}return n;}",
    expected: 3,
  },
  {
    name: "void",
    text: "export function main():number{g();return 7;}function g():void{return;}",
    expected: 7,
  },
  {
    name: "boolean-call",
    text: "export function main():boolean{return f(true,false)===false;}function f(a:boolean,b:boolean):boolean{return a&&b;}",
    expected: true,
  },
  {
    name: "conditional",
    text: "export function main():number{let x=5;return x+(x>0?(x=2):(x=3));}",
    expected: 7,
  },
);
const types = [
  "boolean",
  "number",
  "boolean",
  "number",
  "boolean",
  "number",
  "boolean",
  "number",
  "boolean",
  "number",
  "boolean",
  "number",
  "number",
  "number",
  "number",
  "number",
];
const params = types.map((t, i) => `a${i}:${t}`).join(","),
  args = types
    .map((t, i) =>
      t === "boolean" ? (i % 4 === 0 ? "true" : "false") : String(i + 1),
    )
    .join(",");
const checks = types
  .map(
    (t, i) =>
      `a${i}===${t === "boolean" ? (i % 4 === 0 ? "true" : "false") : String(i + 1)}`,
  )
  .join("&&");
fixtures.push({
  name: "mixed-overflow",
  text: `export function main():boolean{return f(${args});}function f(${params}):boolean{return ${checks};}`,
  expected: true,
});
fixtures.push({
  name: "for-control",
  text: `export function main():number {
  let total=0; let i=100;
  for(let i=0;i<6;i=i+1){if(i===2)continue;if(i===5)break;total=total+i;}
  for(;total<10;){total=total+1;}
  for(;;){break;}
  return total+i;
}`,
  expected: 110,
});
fixtures.push({
  name: "for-nested",
  text: `export function main():number {
  let i=9;let total=0;
  for(i=0;i<3;i=i+1){for(let j=0;j<4;j=j+1){if(j===1)continue;if(j===3)break;total=total+10*i+j;}}
  return total;
}`,
  expected: 66,
});
for (const [name, body, expected] of [
  ["basic", "a[0]=4294967297;return (a[0] ?? 7)+a.length;", 4],
  [
    "convert",
    "a[0]=-1;a[1]=3.9;a[2]=1/0;return (a[0]??0)+(a[1]??0)+(a[2]??0);",
    4294967298,
  ],
  [
    "invalid",
    "a[-1]=99;a[3]=99;a[0.5]=99;a[0/0]=99;a[4294967296]=99;return (a[-1]??7)+(a[3]??7)+(a[0.5]??7)+(a[0/0]??7)+(a[1/0]??7)+(a[4294967296]??7)+(a[-0]??7);",
    53,
  ],
  ["lazy", "let x=a[0]??(a[1]=99);return x+(a[1]??0);", 33],
  ["fallback", "let x=a[3]??(a[1]=99);return x+(a[1]??0);", 198],
  ["order", "a[(a[0]=1)]=(a[0]=2);return (a[0]??0)*10+(a[1]??0);", 22],
  ["result", "let x=(a[0]=-1.5);return x+(a[0]??0);", 4294967293.5],
  [
    "loop",
    "for(let i=0;i<a.length;i=i+1){a[i]=(a[i]??0)+1;}return (a[0]??0)+(a[1]??0)+(a[2]??0);",
    69,
  ],
] as const) {
  assert.equal(
    new Function("a", body)(new Uint32Array([11, 22, 33])),
    expected,
    name,
  );
  fixtures.push({
    name: "u32-" + name,
    text: `export function main(a:Uint32Array):number{${body}}`,
    expected,
    arrayLength: 3,
  });
}
for (const index of [
  "-0",
  "-1",
  "0.5",
  "0/0",
  "1/0",
  "-1/0",
  "4294967295",
  "4294967296",
  "9223372036854775808",
  "-9223372036854775808",
  "1e100",
]) {
  const body = `let i=${index};a[i]=99;return (a[i]??7)+(a[0]??0)+(a[1]??0)+(a[2]??0);`;
  fixtures.push({
    name: "u32-index-boundary-" + index.replaceAll("/", "div"),
    text: `export function main(a:Uint32Array):number{${body}}`,
    expected: new Function("a", body)(new Uint32Array([11, 22, 33])),
    arrayLength: 3,
  });
}
fixtures.push({
  name: "u32-empty",
  text: `export function main(a:Uint32Array):number{a[0]=4;return (a[0]??7)+a.length;}`,
  expected: 7,
  arrayLength: 0,
});
fixtures.push({
  name: "u32-calls",
  text: `export function main(a:Uint32Array):number {return f(a,a,a,a,a);}
function f(a:Uint32Array,b:Uint32Array,c:Uint32Array,d:Uint32Array,e:Uint32Array):number {e[1]=77;let alias=identity(a);return (alias[1]??0)+(b===e?1:0);}
function identity(a:Uint32Array):Uint32Array{return a;}`,
  expected: 78,
  arrayLength: 3,
});
for (const [name, body, expected] of [
  [
    "snapshots",
    "let x=2;let old=x++;let next=++x;let down=x--;let last=--x;let total=old*1000+next*100+down*10+last;x=5;x+=(x=3);total+=x;for(let i=0;i<3;i++){total+=i;}return total;",
    2453,
  ],
  ["right-associative", "let x=2;let y=3;x+=y*=4;return x*100+y;", 1412],
  ["negative-zero", "let x=-0;return x++;", -0],
  [
    "loop",
    "let total=0;for(let i=5;i>0;i--){if(i===3)continue;total+=i;}return total;",
    12,
  ],
  ["arithmetic", "let x=23;x-=3;x*=2;x/=4;x%=6;return x;", 4],
  ["bitwise", "let x=-1;x>>>=1;x&=255;x^=15;x|=1;x<<=2;x>>=1;return x;", 482],
] as const) {
  assert.equal(new Function(body)(), expected, name);
  fixtures.push({
    name: "update-" + name,
    text: `export function main():number{${body}}`,
    expected,
  });
}
for (const [label, source, value] of [
  ["zero", "0", 0],
  ["negative-zero", "-0", -0],
  ["nan", "0/0", NaN],
  ["infinity", "1/0", Infinity],
  ["negative-infinity", "-1/0", -Infinity],
  ["fraction", "1.2", 1.2],
  ["negative-fraction", "-1.2", -1.2],
  ["small-negative", "-0.2", -0.2],
  ["subnormal", "5e-324", Number.MIN_VALUE],
  ["negative-subnormal", "-5e-324", -Number.MIN_VALUE],
  ["large", "4503599627370495.5", 4503599627370495.5],
  ["integer", "9007199254740992", 9007199254740992],
] as const) {
  expression("builtin-ceil-" + label, `Math.ceil(${source})`, Math.ceil(value));
  expression(
    "builtin-integer-" + label,
    `Number.isInteger(${source})`,
    Number.isInteger(value),
  );
}
expression("builtin-integer-boolean", "Number.isInteger(true)", false);
for (const [name, body] of [
  ["all", "let b=a.fill(-1);return (b===a?1:0)+(a[0]??0)+(a[2]??0);"],
  ["range", "a.fill(7.9,-2,1/0);return (a[0]??0)+(a[1]??0)+(a[2]??0);"],
  ["reverse", "a.fill(9,2,1);return (a[0]??0)+(a[1]??0)+(a[2]??0);"],
  ["nan", "a.fill(0/0,0/0,2.9);return (a[0]??0)+(a[1]??0)+(a[2]??0);"],
  ["infinities", "a.fill(7,-1/0,1/0);return (a[0]??0)+(a[1]??0)+(a[2]??0);"],
  ["negative-end", "a.fill(8,-99,-1);return (a[0]??0)+(a[1]??0)+(a[2]??0);"],
  [
    "order",
    "a.fill((a[0]=5),(a[1]=1),(a[2]=2));return (a[0]??0)+(a[1]??0)+(a[2]??0);",
  ],
  ["nonnumber", "return Number.isInteger(a)?1:0;"],
] as const)
  fixtures.push({
    name: "builtin-fill-" + name,
    text: `export function main(a:Uint32Array):number{${body}}`,
    expected: new Function("a", body)(new Uint32Array([11, 22, 33])),
    arrayLength: 3,
  });
fixtures.push({
  name: "builtin-fill-empty",
  text: `export function main(a:Uint32Array):number{return a.fill(8).length;}`,
  expected: 0,
  arrayLength: 0,
});
for (const [name, body, expected] of [
  ["fallback", "let x:number|undefined=undefined;return x??7;", 7],
  ["promotion", "let x:number|undefined=2;x=3;return x??7;", 3],
  ["present-zero", "let x:number|undefined=-0;return x??7;", -0],
  ["present-nan", "let x:number|undefined=0/0;return x??7;", NaN],
  ["present-infinity", "let x:number|undefined=1/0;return x??7;", Infinity],
  [
    "conditional",
    "let x:number|undefined=true?undefined:2;return (x??3)+((false?undefined:5)??9);",
    8,
  ],
  [
    "equal",
    "let x:number|undefined=undefined;let y:number|undefined=0;return (x===undefined?1:0)+(y===0?2:0)+(x!==y?4:0)+(x==undefined?8:0);",
    15,
  ],
  ["nan-equal", "let x:number|undefined=0/0;return x===x?1:0;", 0],
  [
    "truth",
    "let x:number|undefined=undefined;let y:number|undefined=3;return (!x?1:0)+(y?2:0)+((x||y)??0);",
    6,
  ],
  [
    "integer",
    "let x:number|undefined=undefined;let y:number|undefined=4;return (Number.isInteger(x)?1:0)+(Number.isInteger(y)?2:0);",
    2,
  ],
  [
    "dead-fallback",
    "let x:number|undefined=2;let y=1;let z=x??(y=9);return z+y;",
    3,
  ],
] as const)
  fixtures.push({
    name: "optional-" + name,
    text: `export function main():number{${body}}`,
    expected,
  });
for (const [name, text, expected] of [
  [
    "order",
    "export function main():number{return f()+f(4,0,0)+f(undefined); } function f(a:number=1,b:number=(a+=2),c:number=a+b):number{return a*100+b*10+c;}",
    1072,
  ],
  [
    "required-tail",
    "export function main():number{return f(undefined,4);}function f(a:number=3,b:number):number{return a+b;}",
    7,
  ],
  [
    "nullable",
    "export function main():number{return f();}function f(a:number|undefined=undefined):number{return a??7;}",
    7,
  ],
  [
    "lazy",
    "export function main():number{return f(5);}function fail():number{return fail();}function f(a:number=fail()):number{return a;}",
    5,
  ],
  [
    "recursion",
    "export function main():number{return f();}function f(n:number=3,x:number=2):number{if(n===0)return x;return f(n-1);}",
    2,
  ],
  [
    "stack",
    "export function main():number{return f()+f(10);}function f(a:number=1,b:number=a+1,c:number=b+1,d:number=c+1,e:number=d+1,g:number=e+1):number{return a+b+c+d+e+g;}",
    96,
  ],
  [
    "zero",
    "export function main():number{return f(0)+f(undefined);}function f(a:number=7):number{return a;}",
    7,
  ],
  [
    "nan",
    "export function main():number{return f(0/0);}function f(a:number=7):number{return a;}",
    NaN,
  ],
  [
    "negative-zero",
    "export function main():number{return f(-0);}function f(a:number=7):number{return a;}",
    -0,
  ],
] as const)
  for (const contextual of [false, true])
    fixtures.push({
      name: "default-" + name + (contextual ? "-contextual" : "-scalar"),
      text,
      expected,
      contextual,
    });
fixtures.push({
  name: "optional-large-frame",
  text: `export function main():number{${Array.from({ length: 600 }, (_, i) => `const n${i}=${i};`).join("")}return f(n599);}function f(x?:number):number{return x??7;}`,
  expected: 599,
});
fixtures.push({
  name: "optional-omitted-stack",
  text: `export function main():number{return f()+f(1,2)+f(1,2,3,4,5);}
 function f(a?:number,b?:number,c?:number,d?:number,e?:number):number{return (a??10)+(b??20)+(c??30)+(d??40)+(e??50);}`,
  expected: 288,
});
fixtures.push({
  name: "optional-omitted-recursion",
  text: `export function main():number{return f(4)+f(4,3);}
 function f(n:number,x?:number):number{if(n===0)return x??7;return f(n-1,x);}`,
  expected: 10,
});
fixtures.push({
  name: "optional-stack",
  text: `export function main():number{return f(undefined,1,2,3,4);}
function f(a:number|undefined,b:number|undefined,c:number|undefined,d:number|undefined,e:number|undefined):number {return (a??9)+(b??9)+(c??9)+(d??9)+(e??9);}`,
  expected: 19,
});
fixtures.push({
  name: "optional-copy",
  text: `export function main():number{let x:number|undefined=5;return (change(x)??0)+(x??0);}
function change(x:number|undefined):number|undefined{x=7;return x;}`,
  expected: 12,
});
fixtures.push({
  name: "optional-recursion",
  text: `export function main():number{return bounce(5,undefined)??13;}
function bounce(n:number,x:number|undefined):number|undefined{if(n===0)return x;return bounce(n-1,x);}`,
  expected: 13,
});
fixtures.push({
  name: "optional-read",
  text: `export function main(a:Uint32Array):number{let x=a[99];let y=a[0];return (echo(x)??7)+(echo(y)??7);}
function echo(x:number|undefined):number|undefined{return x;}`,
  expected: 18,
  arrayLength: 3,
});
for (const [name, body, expected] of [
  ["early", "if(x===undefined)return 7;return x+1;", 11],
  ["reversed", "if(undefined!==x)return x+1;return 7;", 11],
  ["ternary", "return x!==undefined?x+1:7;", 11],
  ["and", "return x!==undefined&&x>2?1:0;", 1],
  ["or", "return x===undefined||x>2?1:0;", 2],
  ["negated", "if(!(x===undefined))return x+1;return 7;", 11],
  ["join", "if(x===undefined)x=3;return x+1;", 8],
  ["update", "if(x===undefined)return 0;let old=x++;return old*10+x;", 34],
  ["compound", "if(x===undefined)return 0;x+=(x=undefined)??2;return x;", 5],
  ["truth", "if(x)return x+1;return 0;", 4],
  [
    "while",
    "while(x!==undefined){let y=x+1;x=undefined;return y;}return 0;",
    4,
  ],
  ["for", "for(;x!==undefined;x=undefined){return x+1;}return 0;", 4],
  ["dead-nullish", "if(x===undefined)return 0;x??(x=undefined);return x+1;", 4],
] as const)
  fixtures.push({
    name: "narrow-" + name,
    text: `export function main():number{return f(undefined)+f(3);}
function f(x:number|undefined):number{${body}}`,
    expected,
  });
fixtures.push({
  name: "narrow-snapshot",
  text: `export function main():number{let x:number|undefined=3;return add(x,(x=undefined)??2);}
function add(x:number,y:number):number{return x+y;}`,
  expected: 5,
});
for (const [name, body] of [
  ["sum", "let n=0;for(const x of a){n+=x;}return n;"],
  ["continue", "let n=0;for(const x of a){if(x===22)continue;n+=x;}return n;"],
  ["break", "let n=0;for(const x of a){if(x===22)break;n+=x;}return n;"],
  ["mutable", "let n=0;for(let x of a){x+=1;n+=x;}return n;"],
  [
    "nested",
    "let n=0;for(const x of a){for(const y of a){if(y===22)continue;n+=x+y;if(n>100)break;}}return n;",
  ],
  ["mutation", "let n=0;for(const x of a){n+=x;a[1]=7;}return n;"],
  ["shadow", "let x=4,n=0;for(const x of a){n+=x;}return n+x;"],
  ["return", "for(const x of a){if(x===22)return x;}return -1;"],
] as const) {
  for (const length of [0, 3])
    fixtures.push({
      name: "for-of-" + name + "-" + length,
      text: `export function main(a:Uint32Array):number{${body}}`,
      expected: new Function("a", body)(
        new Uint32Array([11, 22, 33].slice(0, length)),
      ),
      arrayLength: length,
    });
}
fixtures.push({
  name: "for-of-evaluate-once",
  text: `
export function main(a:Uint32Array):number{let total=0;for(const x of source(a)){total+=x;}return total;}
function source(a:Uint32Array):Uint32Array{a[0]=(a[0]??0)+1;return a;}`,
  expected: 67,
  arrayLength: 3,
});
fixtures.push({
  name: "for-of-uint16",
  text: `export function main(a:Uint16Array):number{let total=0;for(const x of a){total+=x;}return total;}`,
  expected: [
    ...new Uint16Array(new Uint32Array([11, 22, 33]).buffer, 0, 3),
  ].reduce((a, b) => a + b, 0),
  arrayLength: 3,
});
for (const expression of [
  "(x ^ 4294967295) >>> 3",
  "~(x << 31)",
  "(x >>> 0) & -1",
  "(x | 0) ^ 4294967297",
  "x ^ (1/0)",
  "x | (0/0)",
  "x & 1e100",
]) {
  const inputs = [
    "0",
    "-0",
    "-1",
    "0.5",
    "-0.5",
    "4294967295",
    "4294967296",
    "-2147483648",
    "9223372036854775808",
    "1e100",
    "0/0",
    "1/0",
    "-1/0",
  ];
  const checks = inputs.map((input) => {
    const expected = new Function("x", "return " + expression)(
      new Function("return " + input)(),
    );
    return `operation(${input})===${expected}`;
  });
  fixtures.push({
    name: "word-chain-" + fixtures.length,
    text: `export function main():boolean{return ${checks.join("&&")};}function operation(x:number):number{return ${expression};}`,
    expected: true,
  });
}
const numeric = numericFixtures();
fixtures.push(...numeric.fixtures);
// Word facts must preserve modulo semantics, including non-finite inputs, when
// values pass through locals and when a later store replaces a proven word.
for (const [label, source, input] of [
  ["negative", "-1", -1],
  ["unsigned", "4294967295", 4294967295],
  ["large", "1099511627781", 1099511627781],
  ["fraction", "-3.75", -3.75],
  ["nan", "0/0", NaN],
  ["infinity", "1/0", Infinity],
  ["negative-zero", "-0", -0],
] as const) {
  fixtures.push({
    name: "word-slot-" + label,
    text: `export function main():number{return convert(${source});}
function convert(x:number):number {
  let y=x^4294967295;let z=y;let first=z>>>3;
  z=x;let second=~z;
  for(let i=0;i<2;i++){z=i===0?x:4294967295;second^=z;}
  return first+second;
}`,
    expected: ((input ^ 4294967295) >>> 3) + (~input ^ input ^ 4294967295),
  });
}
fixtures.push(
  {
    name: "ir-ssa-diamond",
    text: "export function main():number{return choose(true)+choose(false);} function choose(flag:boolean):number{let x=0;if(flag)x=7;else x=7;return x+1;}",
    expected: 16,
  },
  {
    name: "ir-ssa-loop-swap",
    text: "export function main():number{let x=1;let y=2;let n=0;while(n<5){const t=x;x=y;y=t;n++;}return x*10+y;}",
    expected: 21,
  },
  {
    name: "ir-lazy-operands",
    text: "export function main():number{let count=0;const a=0&&(count++);const b=1||(count++);const c=true?(count+=3):(count+=100);return count+a+b+c;}",
    expected: 7,
  },
  {
    name: "ir-indexed-reference-order",
    arrayLength: 2,
    text: "export function main(a:Uint32Array):number{let i=0;a[i++]=++i;return (a[0]??0)*10+i;}",
    expected: 22,
  },
);
const selected =
  process.env.TINT_NATIVE_FILTER === undefined
    ? fixtures
    : fixtures.filter((f) =>
        f.name.includes(process.env.TINT_NATIVE_FILTER ?? ""),
      );
assert.ok(selected.length > 0, "fixture filter matched nothing");
console.log(
  `${selected.length} selected fixtures; full numeric corpus covers ${numeric.cases} input/operator cases.`,
);
const directory = mkdtempSync(join(tmpdir(), "tint-scalar-native-"));
try {
  const chunks: { code: Uint8Array; importOffset: number }[] = [];
  for (const fixture of selected) {
    const input = new TextEncoder().encode(fixture.text),
      source = createSourceText(input, input.length);
    assert.equal(source.ok, true);
    const parsed = parseModule(source.value);
    assert.equal(parsed.ok, true, fixture.name);
    const checked = checkModule(parsed.value);
    assert.equal(checked.ok, true, JSON.stringify(checked));
    const lowered = lowerModule(checked.value);
    assert.equal(lowered.ok, true, JSON.stringify(lowered));
    let ir = lowered.value;
    let contextualEntry: number | undefined;
    if (fixture.contextual) {
      const contextual = checkClosureModule(parsed.value);
      assert.ok(contextual.ok, JSON.stringify(contextual));
      const entries = lowerModuleEntries(
        contextual.value,
        contextual.value.bindings.functions
          .filter((f) => f.parent === undefined)
          .map((f) => f.id),
        {
          pointerSize: 8,
          wordSize: 8,
          allocationAlignment: 16,
          frameAlignment: 16,
          maxAlignment: 16,
        },
        4096,
      );
      assert.ok(entries.ok, JSON.stringify(entries));
      ir = entries.value.module;
      contextualEntry = entries.value.entries[0];
      assert.notEqual(contextualEntry, undefined);
    }
    if (process.env.TINT_OPTIMIZATION === "basic")
      ir = optimizeModule(ir).module;
    const native = emitDarwinModule(ir);
    assert.equal(native.ok, true, JSON.stringify(native));
    assert.deepEqual(emitDarwinModule(ir), native);
    const main = native.value.functions.find((f) =>
      fixture.contextual ? f.id === contextualEntry : f.name === "main",
    );
    assert.ok(main);
    const wrapper: Instruction[] = [];
    const wrapperBytes = fixture.arrayLength === undefined ? 48 : 144;
    const canaryBranches: number[] = [];
    const emit = (i: Instruction) => {
      wrapper.push(i);
    };
    emit({
      op: "stp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: -16,
      mode: "pre",
    });
    emit({
      op: "add-imm",
      width: 64,
      rd: 29,
      rn: "sp",
      immediate: 0,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "sp",
      rn: "sp",
      immediate: wrapperBytes,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "mrs-fpcr", rt: 9 });
    emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 32 });
    emit({ op: "msr-fpcr", rt: "zr" });
    for (const offset of [0, 8, 16, 24])
      emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
    for (const rd of [0, 1, 2])
      emit({ op: "movz", width: 64, rd, immediate: 0, shift: 0 });
    emit({
      op: "add-imm",
      width: 64,
      rd: 3,
      rn: "sp",
      immediate: 0,
      shift: 0,
      setFlags: false,
    });
    if (fixture.arrayLength !== undefined) {
      emit({
        op: "add-imm",
        width: 64,
        rd: 4,
        rn: "sp",
        immediate: 48,
        shift: 0,
        setFlags: false,
      });
      if (fixture.arrayLength === 0)
        emit({ op: "movz", width: 64, rd: 9, immediate: 0, shift: 0 });
      else
        emit({
          op: "add-imm",
          width: 64,
          rd: 9,
          rn: "sp",
          immediate: 80,
          shift: 0,
          setFlags: false,
        });
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 72 });
      emit({
        op: "movz",
        width: 32,
        rd: 9,
        immediate: fixture.arrayLength,
        shift: 0,
      });
      emit({ op: "str", width: 32, rt: 9, rn: "sp", offset: 64 });
      for (const [offset, immediate] of [
        [40, 1234],
        [80, 11],
        [84, 22],
        [88, 33],
        [92, 1234],
      ]) {
        emit({ op: "movz", width: 32, rd: 9, immediate: immediate!, shift: 0 });
        emit({ op: "str", width: 32, rt: 9, rn: "sp", offset: offset! });
      }
    }
    if (fixture.arrayLength !== undefined) {
      const param = checked.value.functions[0]?.parameters[0];
      const marker =
        param === "Uint8Array" ? 2 : param === "Uint16Array" ? 3 : 4;
      emit({ op: "movz", width: 64, rd: 9, immediate: marker, shift: 0 });
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 48 });
      emit({ op: "movz", width: 64, rd: 9, immediate: 1, shift: 0 });
      emit({ op: "str", width: 64, rt: 9, rn: "sp", offset: 56 });
      for (let offset = 96; offset < 136; offset += 8)
        emit({ op: "str", width: 64, rt: "zr", rn: "sp", offset });
      emit({
        op: "add-imm",
        width: 64,
        rd: 0,
        rn: "sp",
        immediate: 96,
        shift: 0,
        setFlags: false,
      });
    }
    const call = wrapper.length * 4;
    emit({ op: "bl", displacement: 0 });
    if (fixture.arrayLength !== undefined)
      for (const offset of [40, 92]) {
        emit({ op: "ldr", width: 32, rt: 9, rn: "sp", offset });
        emit({
          op: "sub-imm",
          width: 32,
          rd: "zr",
          rn: 9,
          immediate: 1234,
          shift: 0,
          setFlags: true,
        });
        canaryBranches.push(wrapper.length * 4);
        emit({ op: "b.cond", condition: "ne", displacement: 0 });
      }
    emit({
      op: "sub-imm",
      width: 32,
      rd: "zr",
      rn: 0,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    const badState = wrapper.length * 4;
    emit({ op: "b.cond", condition: "ne", displacement: 0 });
    emit({ op: "ldr", width: 32, rt: 9, rn: "sp", offset: 0 });
    emit({
      op: "sub-imm",
      width: 32,
      rd: "zr",
      rn: 9,
      immediate: 1,
      shift: 0,
      setFlags: true,
    });
    const badHeader = wrapper.length * 4;
    emit({ op: "b.cond", condition: "ne", displacement: 0 });
    emit({ op: "movz", width: 32, rd: 0, immediate: 1, shift: 0 });
    emit({
      op: "add-imm",
      width: 64,
      rd: 1,
      rn: "sp",
      immediate: 16,
      shift: 0,
      setFlags: false,
    });
    emit({ op: "movz", width: 64, rd: 2, immediate: 8, shift: 0 });
    const importOffset = wrapper.length * 4;
    const importAddress = relativeAddress(16, 17, 0);
    assert.ok(importAddress.ok);
    importAddress.value.forEach(emit);
    emit({ op: "ldr", width: 64, rt: 16, rn: 16, offset: 0 });
    emit({ op: "blr", rn: 16 });
    emit({
      op: "sub-imm",
      width: 64,
      rd: "zr",
      rn: 0,
      immediate: 8,
      shift: 0,
      setFlags: true,
    });
    emit({ op: "cset", rd: 0, condition: "ne" });
    const done = wrapper.length * 4;
    emit({ op: "b", displacement: 0 });
    const failure = wrapper.length * 4;
    emit({ op: "movz", width: 32, rd: 0, immediate: 1, shift: 0 });
    const epilogue = wrapper.length * 4;
    emit({ op: "ldr", width: 64, rt: 9, rn: "sp", offset: 32 });
    emit({ op: "msr-fpcr", rt: 9 });
    emit({
      op: "add-imm",
      width: 64,
      rd: "sp",
      rn: "sp",
      immediate: wrapperBytes,
      shift: 0,
      setFlags: false,
    });
    emit({
      op: "ldp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: 16,
      mode: "post",
    });
    emit({ op: "ret", rn: 30 });
    const code = new Uint8Array(wrapper.length * 4 + native.value.code.length);
    wrapper.forEach((i, j) =>
      assert.equal(writeInstruction(code, j * 4, i).ok, true),
    );
    code.set(native.value.code, wrapper.length * 4);
    assert.equal(
      patchBranch(code, {
        offset: call,
        targetOffset: wrapper.length * 4 + main.offset,
        branch: { op: "bl" },
      }).ok,
      true,
    );
    for (const offset of [badState, badHeader, ...canaryBranches])
      assert.equal(
        patchBranch(code, {
          offset,
          targetOffset: failure,
          branch: { op: "b.cond", condition: "ne" },
        }).ok,
        true,
      );
    assert.equal(
      patchBranch(code, {
        offset: done,
        targetOffset: epilogue,
        branch: { op: "b" },
      }).ok,
      true,
    );
    chunks.push({ code, importOffset });
  }
  // One process runs all independent wrappers. Each wrapper restores its stack
  // and FP environment and writes exactly one result, retaining per-fixture
  // assertions while avoiding hundreds of debugger launch handshakes.
  const driver: Instruction[] = [
    {
      op: "stp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: -16,
      mode: "pre",
    },
  ];
  const calls: number[] = [],
    failures: number[] = [];
  for (const chunk of chunks) {
    calls.push(driver.length * 4);
    driver.push({ op: "bl", displacement: 0 });
    driver.push({
      op: "sub-imm",
      width: 32,
      rd: "zr",
      rn: 0,
      immediate: 0,
      shift: 0,
      setFlags: true,
    });
    failures.push(driver.length * 4);
    driver.push({ op: "b.cond", condition: "ne", displacement: 0 });
  }
  const finish = driver.length * 4;
  driver.push(
    {
      op: "ldp",
      width: 64,
      rt: 29,
      rt2: 30,
      rn: "sp",
      offset: 16,
      mode: "post",
    },
    { op: "ret", rn: 30 },
  );
  const starts: number[] = [];
  let length = Math.ceil((driver.length * 4) / 16) * 16;
  for (const chunk of chunks) {
    starts.push(length);
    length = Math.ceil((length + chunk.code.length) / 16) * 16;
  }
  const code = new Uint8Array(length);
  driver.forEach((op, i) => assert.ok(writeInstruction(code, i * 4, op).ok));
  for (let i = 0; i < chunks.length; i++) {
    code.set(chunks[i]!.code, starts[i]!);
    assert.ok(
      patchBranch(code, {
        offset: calls[i]!,
        targetOffset: starts[i]!,
        branch: { op: "bl" },
      }).ok,
    );
    assert.ok(
      patchBranch(code, {
        offset: failures[i]!,
        targetOffset: finish,
        branch: { op: "b.cond", condition: "ne" },
      }).ok,
    );
  }
  const image = buildAArch64Executable({
    code,
    entryOffset: 0,
    imports: ["_write"],
    addressFixups: chunks.map((chunk, i) => ({
      offset: starts[i]! + chunk.importOffset,
      rd: 16,
      scratch: 17,
      target: { kind: "import" as const, name: "_write" },
    })),
    identifier: "tint.scalar.batch",
    minimumOS: { major: 26, minor: 6, patch: 2 },
    sdk: { major: 26, minor: 6, patch: 0 },
    maxByteLength: 67108864,
  });
  assert.ok(image.ok, JSON.stringify(image));
  const path = join(directory, "fixtures");
  writeFileSync(path, image.value.bytes, { mode: 0o755 });
  const signature = spawnSync(
    "/usr/bin/codesign",
    ["--verify", "--strict", path],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(signature.status, 0, signature.stderr);
  assert.deepEqual(new Uint8Array(readFileSync(path)), image.value.bytes);
  for (let run = 0; run < 2; run++) {
    const captured = join(directory, "result.bin");
    const debug = process.env.TINT_NATIVE_LLDB === "1";
    const result = debug
      ? spawnSync(
          "/usr/bin/lldb",
          [
            "--batch",
            "-o",
            `process launch --stop-at-entry -i /dev/null -o ${captured} -e ${captured}.stderr`,
            "-o",
            "script assert lldb.process.GetState() == lldb.eStateStopped",
            "-o",
            "continue",
            "-o",
            "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 0",
            "-o",
            "process status",
            path,
          ],
          { timeout: 90000 },
        )
      : spawnSync(path, [], { timeout: 10000 });
    assert.equal(result.error, undefined, "batch launch");
    assert.equal(result.signal, null, "batch signal");
    assert.equal(
      result.status,
      0,
      `batch runner: ${result.stdout.toString()}${result.stderr.toString()}`,
    );
    if (debug) assert.match(result.stdout.toString(), /exited with status = 0/);
    const stdout = debug ? readFileSync(captured) : result.stdout;
    assert.equal(
      stdout.length,
      selected.length * 8,
      `batch stopped after ${stdout.length / 8} results`,
    );
    selected.forEach((fixture, index) => {
      const offset = index * 8;
      if (typeof fixture.expected === "boolean")
        assert.equal(
          stdout.readBigUInt64LE(offset),
          fixture.expected ? 1n : 0n,
          fixture.name,
        );
      else
        assert.ok(
          Object.is(stdout.readDoubleLE(offset), fixture.expected),
          `${fixture.name}: received ${stdout.readDoubleLE(offset)}, expected ${fixture.expected}`,
        );
    });
  }
  console.log(
    `${selected.length} source-to-native fixtures signed internally and executed twice; exact scalar results match JavaScript.`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}

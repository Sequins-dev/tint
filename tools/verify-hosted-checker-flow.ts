import { verifyHostedFixture } from "./hosted-fixture.ts";

const header =
  "type R={readonly ok:true;readonly value:number}|{readonly ok:false;readonly error:string};";
const cases = [
  [
    true,
    header +
      "function f(a:R,b:R):number{if(!a.ok)return 0;if(!b.ok)return 0;a={ok:false,error:'x'};return b.value;}",
  ],
  [
    false,
    header +
      "function f(a:R):number{if(!a.ok)return 0;a={ok:false,error:'x'};return a.value;}",
  ],
  [
    true,
    header +
      "function f(a:R,flag:boolean):number{if(!a.ok)return 0;if(flag){a={ok:false,error:'x'};return 0;}return a.value;}",
  ],
  [
    false,
    "interface O{value?:number}function f(a:O):number{if(a.value===undefined)return 0;a={};return a.value;}",
  ],
  [
    false,
    "function f(flag:boolean):number{let n:number;while(flag){n=1;}return n;}",
  ],
  [false, "function f():number{let n:number;try{n=1;}catch{}return n;}"],
  [
    false,
    "function f(flag:boolean):number{let n:number;if(flag){return 0;n=1;}return n;}",
  ],
  [
    true,
    "function f(flag:boolean):number{let n:number;if(flag)n=1;else n=2;return n;}",
  ],
  [
    true,
    Array.from({ length: 500 }, (_, i) => `const v${i}:number=${i};`).join(
      "\n",
    ),
  ],
  [
    true,
    Array.from(
      { length: 512 },
      (_, i) => `const v${i}:number=${i === 0 ? "0" : `v${i - 1}`};`,
    ).join("\n"),
  ],
  [
    true,
    "type W=" +
      Array.from(
        { length: 64 },
        (_, i) =>
          `{readonly kind:'t${i}';readonly ${i === 0 ? "value:number" : "other:string"}}`,
      ).join("|") +
      ";function f(a:W):number{" +
      Array.from({ length: 64 }, (_, i) => `const v${i}:number=${i};`).join(
        "\n",
      ) +
      "if(a.kind==='t0')return a.value;return 0;}",
  ],
  [
    true,
    header +
      "function f(a:R,b:R,flag:boolean):number{if(flag){if(a.ok)return a.value;}if(!a.ok)return 0;if(!b.ok)return 0;b={ok:false,error:'x'};return a.value;}",
  ],
  [
    false,
    header +
      "function f(a:R,flag:boolean):number{if(flag){if(a.ok)return a.value;}return a.value;}",
  ],
  [
    true,
    "function touch():number{return 0;} function run():number{" +
      Array.from(
        { length: 200 },
        (_, i) => `const v${i}:number|undefined=touch();`,
      ).join("") +
      "return v199;}",
  ],
  [
    true,
    "function touch():number{return 0;} function run():number{" +
      Array.from(
        { length: 200 },
        (_, i) => `const v${i}=touch();if(v${i}<0)return 0;`,
      ).join("") +
      "return v199;}",
  ],
  [
    false,
    "function run():number{let value:number|undefined=0;function touch():void{}function reset():void{value=undefined;}touch();value=1;reset();return value+1;}",
  ],
  [
    false,
    "function touch():void{}function run(value:{readonly x:number|undefined}):number{touch();if(value.x===undefined)return 0;touch();return value.x+1;}",
  ],
] as const;

verifyHostedFixture(
  `import {createSourceTextView} from "source";
import {parseModule} from "syntax";
import {checkClosureModule} from "checker";
export function run():number {
${cases
  .map(
    ([expected, source], i) => `{
 const parsed=parseModule(createSourceTextView(${JSON.stringify(source)}));
 if(!parsed.ok)return ${i * 2 + 1};
 const checked=checkClosureModule(parsed.value);
 if(checked.ok!==${expected})return ${i * 2 + 2};
}`,
  )
  .join("\n")}
 return 42;
}`,
  "checker-flow",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
  ],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 268435456,
    allocationCapacity: 8388608,
    rootCapacity: 16384,
    stackBytes: 16777216,
  },
);

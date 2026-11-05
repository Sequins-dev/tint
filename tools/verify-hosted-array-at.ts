import { verifyHostedFixture } from "./hosted-fixture.ts";
const indices = [
  undefined,
  0,
  -0,
  1,
  -1,
  2,
  -2,
  3,
  -3,
  4,
  -4,
  0.9,
  -0.9,
  1.9,
  -1.9,
  NaN,
  Infinity,
  -Infinity,
];
let checks = "";
for (const index of indices) {
  const expression =
    index === undefined
      ? "undefined"
      : Number.isNaN(index)
        ? "NaN"
        : String(index);
  const expected = [10, 20, 30].at(index ?? 0);
  for (const name of ["list", "bytes", "wide", "words", "floats"]) {
    checks += `if(${name}.at(${expression})!==${expected === undefined ? "undefined" : expected})return 1;\n`;
  }
}
verifyHostedFixture(
  `
function grow(values:number[]):number{values.push(42);return -1;}
function absent():number[]|undefined{return undefined;}
function count(state:{n:number}):number{state.n++;return 0;}
export function run():number{
 const list=[10,20,30];
 const bytes=new Uint8Array(3),wide=new Uint16Array(3),words=new Uint32Array(3),floats=new Float64Array(3);
 for(let i=0;i<3;i++){const n=(i+1)*10;bytes[i]=n;wide[i]=n;words[i]=n;floats[i]=n;}
 ${checks}
 if(list.at()!==10||bytes.at()!==10)return 2;
 const empty:number[]=[];if(empty.at(-1)!==undefined||new Uint8Array(0).at(0)!==undefined)return 3;
 const readonly:readonly number[]=list;if(readonly.at(-1)!==30)return 4;
 const strings:string[]=["a","😀"];if(strings.at(-1)!=="😀"||strings.at(5)!==undefined)return 5;
 const item={n:42},objects=[item];if(objects.at(-1)!==item||objects.at(0)?.n!==42)return 6;
 const optional:(number|undefined)[]=[1,undefined];if(optional.at(-1)!==undefined)return 7;
 const state={n:0};if(absent()?.at(count(state))!==undefined||state.n!==0)return 8;
 if(list.at(grow(list))!==42)return 9;
 floats[0]=NaN;floats[2]=-0;
 const last=floats.at(-1);if(last===undefined||1/last!==-Infinity||!Number.isNaN(floats.at(0)))return 10;
 return 42;
}`,
  "array-at",
);

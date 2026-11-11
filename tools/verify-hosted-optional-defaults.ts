import { verifyHostedFixture } from "./hosted-fixture.ts";

// Numeric `x ?? constant` compiles to a branch-free select. Checked natively
// against the host engine's results for the same source: present NaN and -0
// stay as they are, absent reads take -0, NaN and fractional fallbacks, and
// chains of defaults in one expression and inside loops keep their order.
const body = `
function defaults(values:number[],words:Uint32Array,i:number):number[]{
 return [
  values[i]??5, values[i]??-0, values[i]??NaN, values[i]??0.25,
  words[i]??9, (words[i]??1)+(words[i+1]??2)*(values[i]??3),
 ];
}
function sum(words:Uint32Array,n:number):number{
 let total=0;
 for(let i=0;i<n;i++) total=(total+(words[i]??100)+(words[i+2]??1000))>>>0;
 return total;
}
function encode(x:number):number{
 return x!==x?-1000:x===0&&1/x<0?-2000:x;
}
`;
const host = new Function(
  body.replace(/:number\[\]|:number|:Uint32Array|:void/g, "") +
    "return {defaults,sum,encode};",
)() as {
  defaults: (values: number[], words: Uint32Array, i: number) => number[];
  sum: (words: Uint32Array, n: number) => number;
  encode: (x: number) => number;
};
const values = [1.5, NaN, -0, 4];
const words = [7, 0xffffffff, 3];
const hostWords = Uint32Array.from(words);
const expected: number[] = [];
for (let i = 0; i < 6; i++)
  for (const x of host.defaults(values, hostWords, i))
    expected.push(host.encode(x));
expected.push(host.sum(hostWords, 5));
verifyHostedFixture(
  `${body}
const values:number[]=[1.5,NaN,-0,4];
const words:number[]=[${words.join(",")}];
const expected:number[]=[${expected.join(",")}];
export function run():number {
 const typed=new Uint32Array(words.length);
 for(let i=0;i<words.length;i++) typed[i]=words[i]??0;
 const got:number[]=[];
 for(let i=0;i<6;i++){
  const row=defaults(values,typed,i);
  for(let j=0;j<row.length;j++){const x=row[j];if(x!==undefined)got.push(encode(x));}
 }
 got.push(sum(typed,5));
 if(got.length!==expected.length)return 2;
 for(let i=0;i<got.length;i++){
  const want=expected[i],have=got[i];
  if(want===undefined||have===undefined)return 3;
  if(have!==want)return 10+i;
 }
 return 42;
}`,
  "optional-defaults",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 524288,
    allocationCapacity: 32768,
    rootCapacity: 4096,
    stackBytes: 1048576,
  },
);

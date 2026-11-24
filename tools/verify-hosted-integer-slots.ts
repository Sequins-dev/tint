import { verifyHostedFixture } from "./hosted-fixture.ts";

// Integer slots, present-guarded `??` unwraps, induction counters across
// joins and immediate shift counts, checked natively against the host
// engine's ECMAScript results for the same source.
const body = `
function shifts(x:number):number[]{
 return [x<<0,x<<1,x<<31,x<<32,x<<33,x>>0,x>>1,x>>31,x>>32,x>>33,
  x>>>0,x>>>1,x>>>31,x>>>32,x>>>33,(x<<7)|(x>>>25),(x>>>3)^(x<<29)];
}
function rotate(value:number,bits:number):number{return (value>>>bits)|(value<<(32-bits));}
function mix(words:Uint32Array,rounds:number):number[]{
 let a=words[0]??0,b=words[1]??0,c=words[2]??0,d=words[3]??0;
 for(let i=0;i<rounds;i++){
  const s=rotate(a,6)^rotate(b,11)^(c>>>3);
  const t=((d+s+(words[i%4]??0))>>>0);
  if((t&1)===0) d=c; else d=(c^t)>>>0;
  c=b;b=a;a=(t+(b&c))>>>0;
 }
 return [a,b,c,d];
}
function counted(words:Uint32Array):number{
 let sum=0,last=0;
 for(let i=0;i<words.length;i++){
  const w=words[i]??7;
  if(w>100) last=i; else sum=(sum+w)>>>0;
  sum=(sum^(last<<3))>>>0;
 }
 return sum*1000+last;
}
function negativeZero(n:number):number[]{
 let z=-0;
 for(let i=0;i<n;i++) z=z*1;
 let w=0;
 for(let i=-0;i<n;i++) w=1/i;
 return [1/z,w];
}
`;
const host = new Function(
  body.replace(/:number\[\]|:number|:Uint32Array/g, "") +
    "return {shifts,mix,counted,negativeZero};",
)() as {
  shifts: (x: number) => number[];
  mix: (words: Uint32Array, rounds: number) => number[];
  counted: (words: Uint32Array) => number;
  negativeZero: (n: number) => number[];
};
const inputs = [0, 1, -1, 5, 2147483647, -2147483648, 4294967295, 123456789];
const words = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 3, 250, 9, 101];
const literal = (value: number): string =>
  value === Infinity
    ? "Infinity"
    : value === -Infinity
      ? "-Infinity"
      : String(value);
const expected = [
  ...inputs.flatMap((x) => host.shifts(x)),
  ...host.mix(Uint32Array.from(words), 64),
  host.counted(Uint32Array.from(words)),
  ...host.negativeZero(3),
];
verifyHostedFixture(
  `${body}
const inputs:number[]=[${inputs.join(",")}];
const words:number[]=[${words.join(",")}];
const expected:number[]=[${expected.map(literal).join(",")}];
function append(got:number[],values:number[]):void{
 for(let i=0;i<values.length;i++){const value=values[i];if(value!==undefined)got.push(value);}
}
export function run():number {
 const got:number[]=[];
 for(let i=0;i<inputs.length;i++){
  const x=inputs[i];
  if(x===undefined)return 1;
  append(got,shifts(x));
 }
 const array=new Uint32Array(words.length);
 for(let i=0;i<words.length;i++) array[i]=words[i]??0;
 append(got,mix(array,64));
 got.push(counted(array));
 append(got,negativeZero(3));
 if(got.length!==expected.length)return 2;
 for(let i=0;i<got.length;i++){
  const want=expected[i],have=got[i];
  if(want===undefined||have===undefined)return 3;
  if(have!==want)return 10+i;
 }
 return 42;
}`,
  "integer-slots",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 524288,
    allocationCapacity: 32768,
    rootCapacity: 4096,
    stackBytes: 1048576,
  },
);

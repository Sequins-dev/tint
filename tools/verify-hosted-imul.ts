import { verifyHostedFixture } from "./hosted-fixture.ts";

// Math.imul lowers to one 32-bit multiply of the ToInt32 operands. Checked
// natively against the host engine for integer extremes, negatives,
// fractions, values beyond 2^53, NaN and infinities, in both operand orders,
// plus a hash loop that feeds products back into imul.
const inputs = [
  0,
  -0,
  1,
  -1,
  2,
  0.5,
  -1.5,
  3.99,
  65535,
  65536,
  0x7fffffff,
  -0x80000000,
  0x80000000,
  0xffffffff,
  0x100000001,
  0x85ebca6b,
  0xc2b2ae35,
  2 ** 53,
  -(2 ** 53) - 2,
  1e21,
  NaN,
  Infinity,
  -Infinity,
];
const literal = (value: number): string =>
  Number.isNaN(value)
    ? "NaN"
    : value === Infinity
      ? "Infinity"
      : value === -Infinity
        ? "-Infinity"
        : Object.is(value, -0)
          ? "-0"
          : String(value);
const expected: number[] = [];
for (const a of inputs) for (const b of inputs) expected.push(Math.imul(a, b));
let hash = 2166136261;
for (let i = 0; i < 1000; i++) hash = Math.imul(hash ^ i, 16777619) >>> 0;
expected.push(hash);
verifyHostedFixture(
  `const inputs:number[]=[${inputs.map(literal).join(",")}];
const expected:number[]=[${expected.join(",")}];
export function run():number {
 let k=0;
 for(let i=0;i<inputs.length;i++)
  for(let j=0;j<inputs.length;j++){
   const a=inputs[i],b=inputs[j],want=expected[k++];
   if(a===undefined||b===undefined||want===undefined)return 2;
   if(Math.imul(a,b)!==want)return 10+(k%200);
  }
 let hash=2166136261;
 for(let i=0;i<1000;i++) hash=Math.imul(hash^i,16777619)>>>0;
 return hash===expected[k]?42:3;
}`,
  "imul",
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

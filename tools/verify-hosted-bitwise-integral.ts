import { verifyHostedFixture } from "./hosted-fixture.ts";

// Bitwise operators and String.fromCharCode on operands without a proven
// word representation truncate inline (fcvtzs, whose low bits are ToUint32's
// and ToUint16's below 2^63 in magnitude, fractional or not) and fall back to
// the ToUint32 helper from 2^62 up, which covers saturation, infinities and
// exactly 2^63. Expected results come from the host engine's ECMAScript
// semantics.
const inputs = [
  0,
  -0,
  1,
  -1,
  0.5,
  -0.5,
  1.5,
  -1.5,
  2147483647,
  2147483648,
  -2147483648,
  -2147483649,
  4294967295,
  4294967296,
  4294967297,
  4294967295.5,
  9007199254740991,
  -9007199254740991,
  9007199254740992,
  2 ** 53 + 2,
  2 ** 62 - 1024,
  2 ** 62,
  2 ** 62 + 2048,
  -(2 ** 62) + 1024,
  -(2 ** 62),
  -(2 ** 62) - 2048,
  2 ** 63 - 1024,
  2 ** 63,
  -(2 ** 63),
  2 ** 63 + 2 ** 11,
  2 ** 64,
  -(2 ** 64),
  1e21,
  -1e21,
  123456789012,
  -123456789012,
  4294967296.75,
  -4294967296.75,
  2 ** 52 + 0.5,
  -(2 ** 52) - 0.5,
  65.99,
  -65.99,
  65601.5,
  5e-324,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
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
const expected = inputs.flatMap((x) => [
  x | 0,
  x >>> 0,
  x & 0xffff,
  ~x,
  x ^ 7,
  x << 1,
  x >> 1,
  x ^ 0,
  0 | x,
  x | -0,
  x & -1,
  String.fromCharCode(x).charCodeAt(0),
]);
verifyHostedFixture(
  `const inputs:number[]=[${inputs.map(literal).join(",")}];
const expected:number[]=[${expected.map(literal).join(",")}];
function results(x:number):number[]{return [x|0,x>>>0,x&0xffff,~x,x^7,x<<1,x>>1,x^0,0|x,x|-0,x&-1,String.fromCharCode(x).charCodeAt(0)];}
export function run():number {
 for(let i=0;i<inputs.length;i++){
  const x=inputs[i];
  if(x===undefined)return 1;
  const got=results(x);
  for(let j=0;j<12;j++){
   const want=expected[i*12+j],have=got[j];
   if(want===undefined||have===undefined)return 2;
   if(have!==want)return 10+i;
  }
 }
 return 42;
}`,
  "bitwise-integral",
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

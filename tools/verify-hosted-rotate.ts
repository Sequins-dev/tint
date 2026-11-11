import { verifyHostedFixture } from "./hosted-fixture.ts";

// `(x >>> n) | (x << (32 - n))` lowers to one ROR when both shifts are used
// only by the `|`. Checked natively against the host for rotation amounts
// 0..31 (including counts written as 32 - n that wrap modulo 32), both
// operand orders, sources that are negative, fractional, beyond 2^32 or NaN,
// and a shift that keeps another use (which must not fuse).
const sources = [
  0,
  1,
  -1,
  0x80000000,
  0x7fffffff,
  0x12345678,
  0xdeadbeef,
  -123456.75,
  4294967296 + 5,
  1e10,
  NaN,
];
const amounts = [0, 1, 7, 13, 16, 25, 31];
const literal = (value: number): string =>
  Number.isNaN(value) ? "NaN" : String(value);
function reference(): number {
  let hash = 0;
  for (const x of sources)
    for (const n of amounts) {
      const right = (x >>> n) | (x << (32 - n)),
        left = (x << (32 - n)) | (x >>> n);
      hash = (Math.imul(hash, 31) + right) | 0;
      hash = (hash ^ left) | 0;
      const shared = x >>> n;
      hash = (hash + (shared | (x << (32 - n))) + shared) | 0;
    }
  return hash;
}
verifyHostedFixture(
  `const sources:number[]=[${sources.map(literal).join(",")}];
function rotate(value:number, bits:number):number { return (value >>> bits) | (value << (32 - bits)); }
function rotateLeft(value:number, bits:number):number { return (value << (32 - bits)) | (value >>> bits); }
export function run():number {
 let hash=0;
 for(let i=0;i<sources.length;i++){
  const x=sources[i];
  if(x===undefined) return 2;
  hash=(Math.imul(hash,31)+rotate(x,0))|0; hash=(hash^rotateLeft(x,0))|0;
  { const shared=x>>>0; hash=(hash+(shared|(x<<32))+shared)|0; }
  hash=(Math.imul(hash,31)+rotate(x,1))|0; hash=(hash^rotateLeft(x,1))|0;
  { const shared=x>>>1; hash=(hash+(shared|(x<<31))+shared)|0; }
  hash=(Math.imul(hash,31)+rotate(x,7))|0; hash=(hash^rotateLeft(x,7))|0;
  { const shared=x>>>7; hash=(hash+(shared|(x<<25))+shared)|0; }
  hash=(Math.imul(hash,31)+rotate(x,13))|0; hash=(hash^rotateLeft(x,13))|0;
  { const shared=x>>>13; hash=(hash+(shared|(x<<19))+shared)|0; }
  hash=(Math.imul(hash,31)+rotate(x,16))|0; hash=(hash^rotateLeft(x,16))|0;
  { const shared=x>>>16; hash=(hash+(shared|(x<<16))+shared)|0; }
  hash=(Math.imul(hash,31)+rotate(x,25))|0; hash=(hash^rotateLeft(x,25))|0;
  { const shared=x>>>25; hash=(hash+(shared|(x<<7))+shared)|0; }
  hash=(Math.imul(hash,31)+rotate(x,31))|0; hash=(hash^rotateLeft(x,31))|0;
  { const shared=x>>>31; hash=(hash+(shared|(x<<1))+shared)|0; }
 }
 return hash===${reference()}?42:3;
}`,
  "rotate",
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

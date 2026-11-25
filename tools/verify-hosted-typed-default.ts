import { verifyHostedFixture } from "./hosted-fixture.ts";

// `typedArray[i] ?? 0` fuses the read and its default: an absent element
// (out of range, negative, fractional or NaN index) yields +0 and a present
// one its exact value, including -0 and NaN in Float64Array. Checked natively
// against the host for every element type, feeding both integer (bitwise)
// and double consumers, plus a non-zero default that must stay unfused.
const indexes = [0, 1, 2, 3, 4, -1, 1.5, NaN, 100, 4294967295];
const reference = (() => {
  const bytes = new Uint8Array(4),
    halves = new Uint16Array(4),
    words = new Uint32Array(4),
    doubles = new Float64Array(4);
  for (let i = 0; i < 4; i++) {
    bytes[i] = 250 + i;
    halves[i] = 65530 + i;
    words[i] = 4294967290 + i;
  }
  doubles[0] = -0;
  doubles[1] = NaN;
  doubles[2] = 2.5;
  doubles[3] = -1e300;
  let integer = 0,
    real = 0,
    zeros = 0,
    nans = 0,
    other = 0;
  for (const index of indexes) {
    integer = (integer + (bytes[index] ?? 0)) | 0;
    integer = (integer ^ (halves[index] ?? 0)) | 0;
    integer = (integer + ((words[index] ?? 0) >>> 3)) | 0;
    real += (bytes[index] ?? 0) * 0.5 + (words[index] ?? 0) / 7;
    const d = doubles[index] ?? 0;
    if (d !== d) nans++;
    else if (d === 0 && 1 / d < 0) zeros++;
    else real += d === -1e300 ? 1 : d;
    const e = doubles[index] ?? 9;
    if (e === e) other += e === -1e300 ? 1 : e;
  }
  return { integer, real, zeros, nans, other };
})();
verifyHostedFixture(
  `const indexes:number[]=[${indexes.map((i) => (Number.isNaN(i) ? "NaN" : String(i))).join(",")}];
export function run():number {
 const bytes=new Uint8Array(4), halves=new Uint16Array(4), words=new Uint32Array(4), doubles=new Float64Array(4);
 for(let i=0;i<4;i++){ bytes[i]=250+i; halves[i]=65530+i; words[i]=4294967290+i; }
 doubles[0]=-0; doubles[1]=NaN; doubles[2]=2.5; doubles[3]=-1e300;
 let integer=0, real=0, zeros=0, nans=0, other=0;
 for(let k=0;k<indexes.length;k++){
  const index=indexes[k];
  if(index===undefined) return 2;
  integer=(integer+(bytes[index]??0))|0;
  integer=(integer^(halves[index]??0))|0;
  integer=(integer+((words[index]??0)>>>3))|0;
  real+=(bytes[index]??0)*0.5+(words[index]??0)/7;
  const d=doubles[index]??0;
  if(d!==d) nans++;
  else if(d===0&&1/d<0) zeros++;
  else real+=d===-1e300?1:d;
  const e=doubles[index]??9;
  if(e===e) other+=e===-1e300?1:e;
 }
 if(integer!==${reference.integer}) return 3;
 if(real!==${reference.real}) return 4;
 if(zeros!==${reference.zeros}) return 5;
 if(nans!==${reference.nans}) return 6;
 if(other!==${reference.other}) return 7;
 return 42;
}`,
  "typed-default",
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

import { verifyHostedFixture } from "./hosted-fixture.ts";

// Exact-integer storage reaching comparisons and typed-array accesses, and
// optional numbers compared with undefined. Integer slots and +/- results
// whose uses are comparisons or element indexes/values are held as int64:
// comparisons must order negatives and mixed double operands correctly,
// element accesses must reject negative and out-of-range int64 indexes, and
// Float64Array writes must store the converted double. Equality with
// undefined observes only presence, in values and in fused branches.
const expected = (() => {
  const words = new Uint32Array(8),
    doubles = new Float64Array(8);
  let total = 0;
  for (let i = -3; i < 11; i++) {
    const j = i & 15;
    if (i < 0) total = (total + 1) | 0;
    if (i <= -1) total = (total + 2) | 0;
    if (i > 7) total = (total + 4) | 0;
    if (i >= 8) total = (total + 8) | 0;
    if (i === j) total = (total + 16) | 0;
    if (i !== j) total = (total + 32) | 0;
    if (i < 2.5) total = (total + 64) | 0;
    words[i] = j;
    doubles[i] = j - 4;
    const read = words[i];
    if (read !== undefined) total = (total + read) | 0;
    const back = doubles[i];
    if (back !== undefined) total = (total + back * 3) | 0;
  }
  return total;
})();
verifyHostedFixture(
  `function optional(index:number):number|undefined {
 return index % 3 === 0 ? undefined : index;
}
function absent():number|undefined { return undefined; }
export function run():number {
 const words=new Uint32Array(8), doubles=new Float64Array(8);
 let total=0;
 for(let i=-3;i<11;i++){
  const j=i&15;
  if(i<0)total=(total+1)|0;
  if(i<=-1)total=(total+2)|0;
  if(i>7)total=(total+4)|0;
  if(i>=8)total=(total+8)|0;
  if(i===j)total=(total+16)|0;
  if(i!==j)total=(total+32)|0;
  if(i<2.5)total=(total+64)|0;
  words[i]=j;
  doubles[i]=j-4;
  const read=words[i];
  if(read!==undefined)total=(total+read)|0;
  const back=doubles[i];
  if(back!==undefined)total=(total+back*3)|0;
 }
 if(total!==${expected})return 2;
 let present=0, missing=0;
 for(let i=0;i<9;i++){
  const value=optional(i);
  const isMissing=value===undefined, isPresent=value!==undefined;
  if(isMissing===isPresent)return 3;
  if(value===undefined)missing++;
  if(undefined!==value)present++;
 }
 if(missing!==3||present!==6)return 4;
 const none=absent();
 if(none!==undefined)return 5;
 if(!(undefined===undefined))return 6;
 return 42;
}`,
  "integer-uses",
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

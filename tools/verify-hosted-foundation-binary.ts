import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {fromParts,fromSafeInteger,toSafeInteger,add,subtract} from "word";
import {writeWord64,readWord64,writeSigned,readSigned,encodeFloat64,decodeFloat64,writeFloat,readFloat,roundFloat} from "bytes";
import {sha256} from "hash";
export function run():number {
 const left=fromParts(0xffffffff,0),one=fromParts(1,0),high=fromParts(0,1),maximum=fromParts(0xffffffff,0xffffffff);
 if(!left.ok||!one.ok||!high.ok||!maximum.ok)return 1;
 const sum=add(left.value,one.value),difference=subtract(high.value,one.value);
 if(!sum.ok||sum.value.lo!==0||sum.value.hi!==1||!difference.ok||difference.value.lo!==0xffffffff||difference.value.hi!==0)return 2;
 const overflow=add(maximum.value,one.value),underflow=subtract(one.value,high.value);
 if(overflow.ok||overflow.error!=="OVERFLOW"||underflow.ok||underflow.error!=="UNDERFLOW")return 3;
 const exact=fromSafeInteger(Number.MAX_SAFE_INTEGER);if(!exact.ok)return 4;
 const scalar=toSafeInteger(exact.value);if(!scalar.ok||scalar.value!==Number.MAX_SAFE_INTEGER)return 5;
 const bytes=new Uint8Array(16);
 if(!writeWord64(bytes,0,exact.value,"little").ok)return 6;
 const decoded=readWord64(bytes,0,"little");if(!decoded.ok||decoded.value.lo!==exact.value.lo||decoded.value.hi!==exact.value.hi)return 7;
 if(!writeSigned(bytes,8,2,-2,"big").ok||bytes[8]!==255||bytes[9]!==254)return 8;
 const signed=readSigned(bytes,8,2,"big");if(!signed.ok||signed.value!==-2)return 9;
 const invalid=writeSigned(bytes,15,2,-2,"big");if(invalid.ok||invalid.error!=="OUT_OF_BOUNDS"||bytes[15]!==0)return 10;
 const values:readonly number[]=[0,-0,1.5,5e-324,1/0,-1/0,0/0];
 for(const value of values){if(value===undefined)throw "VALUE";const result=decodeFloat64(encodeFloat64(value));if(!result.ok)return 11;if(Number.isNaN(value)){if(!Number.isNaN(result.value))return 12;}else if(result.value!==value||(value===0&&1/result.value!==1/value))return 13;}
 if(roundFloat(1+1/16777216,4)!==1||roundFloat(1+1/2048,2)!==1)return 14;
 if(!writeFloat(bytes,0,8,-0,"big").ok)return 15;
 const negativeZero=readFloat(bytes,0,8,"big");if(!negativeZero.ok||1/negativeZero.value!==-1/0)return 16;
 const input=new Uint8Array(3);input[0]=97;input[1]=98;input[2]=99;
 const digest=sha256(input),expected:readonly number[]=[186,120,22,191,143,1,207,234,65,65,64,222,93,174,34,35,176,3,97,163,150,23,122,156,180,16,255,97,242,0,21,173];
 if(digest.length!==expected.length)return 17;for(let i=0;i<expected.length;i++){if(digest[i]!==expected[i])return 18;}
 return 42;
}`,
  "foundation-binary",
  [
    ["word", "packages/foundation/src/binary/word64.ts"],
    ["bytes", "packages/foundation/src/binary/bytes.ts"],
    ["hash", "packages/foundation/src/binary/sha256.ts"],
  ],
  [],
  [],
  [],
  { managedBytes: 16777216, allocationCapacity: 1048576 },
);

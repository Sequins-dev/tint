import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {parseInteger,divideToNumber,multiply,add,power,fromNumber,negate,type Integer} from "integer";
function integer(text:string):Integer {const value=parseInteger(text,10);if(value===undefined)throw "PARSE";return value;}
function exp(base:number,n:number):Integer {const b=fromNumber(base),e=fromNumber(n);if(b===undefined||e===undefined)throw "EXP";const value=power(b,e,128);if(value===undefined)throw "POWER";return value;}
export function run():number {
 const one=integer("1"),three=integer("3"),two=integer("2"),zero=integer("0");
 if(divideToNumber(integer("9007199254740993"),three)!==3002399751580331)return 1;
 const scale=exp(2,53);
 if(divideToNumber(add(scale,one),scale)!==1||divideToNumber(add(scale,three),scale)!==1.0000000000000004)return 2;
 const huge=exp(10,400);if(divideToNumber(huge,add(huge,one))!==1||divideToNumber(huge,multiply(huge,three))!==1/3)return 3;
 const tiny=exp(2,1074);
 if(divideToNumber(one,tiny)!==5e-324||divideToNumber(one,multiply(tiny,two))!==0||divideToNumber(three,multiply(tiny,two))!==1e-323)return 4;
 const negative=divideToNumber(negate(one),multiply(tiny,integer("4")));if(negative===undefined||1/negative!==-Infinity)return 5;
 if(divideToNumber(one,zero)!==undefined||divideToNumber(exp(2,1024),one)!==Infinity)return 6;
 return 42;
 }`,
  "integer-ratio",
  [["integer", "packages/foundation/src/numeric/big-integer.ts"]],
  [],
  [],
  [],
  { managedBytes: 16777216, allocationCapacity: 1048576 },
);

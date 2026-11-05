import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {canonicalNumericIndex} from "index";
export function run():number {
 const negativeZero=canonicalNumericIndex("-0");
 if(negativeZero===undefined||1/negativeZero!==-Infinity)return 1;
 const nan=canonicalNumericIndex("NaN");
 if(nan===undefined||nan===nan)return 2;
 if(canonicalNumericIndex("Infinity")!==Infinity||canonicalNumericIndex("1e+21")!==1e21)return 3;
 for(const key of ["", "+0", "01", "1.0", "1e0", "1e21", "9007199254740993"]){
  if(key===undefined)return 4;
  if(canonicalNumericIndex(key)!==undefined)return 5;
 }
 if(canonicalNumericIndex("1e-7")!==1e-7)return 6;
 return 42;
}`,
  "integer-index",
  [["index", "packages/js-runtime/src/objects/integer-index.ts"]],
);

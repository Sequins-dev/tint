import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import {decimalFromString,decimalFromNumber,decimalToString,roundDecimal,formatDecimalFraction,formatDecimalPrecision} from "numeric";
export function run():number {
 const value=decimalFromNumber(1.005);
 const rounded=roundDecimal(value,-2,1,"halfExpand");
 if(rounded===undefined||decimalToString(rounded)!=="1.01")return 1;
 const tie=decimalFromString("2.25");if(tie===undefined)return 2;
 const even=roundDecimal(tie,-1,5,"halfEven");if(even===undefined||decimalToString(even)!=="2")return 3;
 const tiny=decimalFromString("-1e-900000");if(tiny===undefined)return 4;
 const floor=roundDecimal(tiny,-2,25,"floor");const zero=roundDecimal(tiny,-2,25,"halfExpand");
 if(floor===undefined||zero===undefined||decimalToString(floor)!=="-0.25"||decimalToString(zero)!=="-0")return 5;
 const huge=decimalFromString("1e900000");if(huge===undefined)return 6;
 const unchanged=roundDecimal(huge,0,25,"halfEven");if(unchanged===undefined||decimalToString(unchanged)!=="1e+900000")return 7;
 const exact=decimalFromString("9007199254740993");if(exact===undefined||decimalToString(exact)!=="9007199254740993")return 8;
 const boundary=decimalFromString("1e9007199254740991");if(boundary===undefined||boundary.exponent!==9007199254740991)return 9;
 if(decimalFromString("99e9007199254740991")!==undefined)return 10;
 const fixed=formatDecimalFraction(value,2,2,1,"halfExpand");
 const precision=formatDecimalPrecision(decimalFromNumber(9.99),1,2,"halfExpand");
 const padded=formatDecimalPrecision(decimalFromNumber(0.001),3,3,"halfExpand");
 if(fixed===undefined||fixed.text!=="1.01"||precision===undefined||precision.text!=="10"||precision.roundingMagnitude!==0||padded===undefined||padded.text!=="0.00100")return 11;
 return 42;
}`,
  "decimal-quantities",
  [["numeric", "packages/foundation/src/numeric/number-text/index.ts"]],
);

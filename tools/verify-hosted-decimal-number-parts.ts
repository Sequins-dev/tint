import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `import {decodeNumberingDigits,partitionDecimalNumber,type DecimalNumberPart} from "parts";
import {decimalFromNumber} from "numeric";
import {createNumberFormatProfile,numberFormatLocaleData} from "profile";
function text(parts:readonly DecimalNumberPart[]):string {let value="";for(const part of parts){if(part===undefined)throw "part";value+=part.value;}return value;}
export function run():number {
 const digits=decodeNumberingDigits("𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡");if(digits===undefined)return 1;
 const symbols={decimal:"٫",group:"٬",plusSign:"+",minusSign:"\u061c-",nan:"NaN",infinity:"∞"};
 const grouping={primaryGrouping:3,secondaryGrouping:3,minimumGroupingDigits:1};
 const parts=partitionDecimalNumber(decimalFromNumber(-1234.5),"1234.50",symbols,digits,grouping,"auto","auto");
 if(text(parts)!=="\u061c-𝟙٬𝟚𝟛𝟜٫𝟝𝟘"||parts[0]?.type!=="literal"||parts[1]?.type!=="minusSign")return 2;
 if(text(partitionDecimalNumber(decimalFromNumber(-0),"0",symbols,digits,grouping,false,"negative"))!=="𝟘")return 3;
 if(text(partitionDecimalNumber(decimalFromNumber(NaN),"",symbols,digits,grouping,false,"always"))!=="+NaN")return 4;
 const indian={primaryGrouping:3,secondaryGrouping:2,minimumGroupingDigits:2};
 if(text(partitionDecimalNumber(decimalFromNumber(1),"1111111",symbols,digits,indian,"auto","never"))!=="𝟙𝟙٬𝟙𝟙٬𝟙𝟙𝟙")return 5;
 const ar=createNumberFormatProfile("ar-EG");if(ar===undefined)return 6;
 const arabic=decodeNumberingDigits(ar.digits);if(arabic===undefined)return 7;
 if(text(partitionDecimalNumber(decimalFromNumber(-1234.5),"1234.5",ar.symbols,arabic,ar,"auto","auto"))!=="\u061c-١٬٢٣٤٫٥")return 8;
 const available=numberFormatLocaleData("en");if(available===undefined||available.numberingSystems.length!==78)return 9;
 return 42;
}`,
  "decimal-number-parts",
  [
    ["parts", "packages/js-runtime/src/objects/decimal-number-parts.ts"],
    ["numeric", "packages/foundation/src/numeric/number-text/index.ts"],
    ["profile", "packages/js-runtime/src/objects/number-format-profile.ts"],
  ],
);

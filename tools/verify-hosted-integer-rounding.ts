import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {roundInteger,roundIntegerAsIfPositive,parseRoundingMode,type RoundingMode} from "round";
import {fromNumber,parseInteger,formatInteger,toNumber} from "integers";
function reference(n:number,inc:number,mode:RoundingMode,positive:boolean):number {
 const lower=Math.floor(n/inc)*inc,upper=Math.ceil(n/inc)*inc;
 if(lower===upper)return lower;
 if(mode==="ceil")return upper;
 if(mode==="floor")return lower;
 if(mode==="expand")return positive||n>0?upper:lower;
 if(mode==="trunc")return positive||n>0?lower:upper;
 if(n-lower<upper-n)return lower;
 if(n-lower>upper-n)return upper;
 if(mode==="halfCeil")return upper;
 if(mode==="halfFloor")return lower;
 if(mode==="halfExpand")return positive||n>0?upper:lower;
 if(mode==="halfTrunc")return positive||n>0?lower:upper;
 return (lower/inc)%2===0?lower:upper;
}
export function run():number {
 for(const name of ["ceil","floor","expand","trunc","halfCeil","halfFloor","halfExpand","halfTrunc","halfEven"]) {
  if(name===undefined)return 1;
  const mode=parseRoundingMode(name);
  if(mode===undefined)return 2;
  for(let n=-24;n<=24;n++)for(let inc=1;inc<=7;inc++) {
   const value=fromNumber(n),increment=fromNumber(inc);
   if(value===undefined||increment===undefined)return 3;
   const signed=roundInteger(value,increment,mode),positive=roundIntegerAsIfPositive(value,increment,mode);
   if(signed===undefined||positive===undefined)return 4;
   if(toNumber(signed)!==reference(n,inc,mode,false)||toNumber(positive)!==reference(n,inc,mode,true))return 5;
  }
 }
 const value=parseInteger("-16069380442589902755419620923411626025222029937827928353013765",10),increment=fromNumber(10);
 if(value===undefined||increment===undefined)return 6;
 const signed=roundInteger(value,increment,"halfExpand"),positive=roundIntegerAsIfPositive(value,increment,"halfExpand");
 if(signed===undefined||positive===undefined)return 7;
 if(formatInteger(signed,10)!=="-16069380442589902755419620923411626025222029937827928353013770"||formatInteger(positive,10)!=="-16069380442589902755419620923411626025222029937827928353013760")return 8;
 return 42;
}`,
  "integer-rounding",
  [
    ["round", "packages/foundation/src/numeric/integer-rounding.ts"],
    ["integers", "packages/foundation/src/numeric/big-integer.ts"],
  ],
);

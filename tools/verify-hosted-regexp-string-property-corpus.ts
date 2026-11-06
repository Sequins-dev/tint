import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {compileRegExp,executeRegExp} from "engine";
import {stringPropertyNames,stringPropertyValues} from "data";
export function run():number {
 const slash=String.fromCharCode(92),all:string[]=[];
 for(let i=0;i<stringPropertyNames.length;i++) {
  const name=stringPropertyNames[i],values=stringPropertyValues[i];if(name===undefined||values===undefined)return 1;
  const compiled=compileRegExp("^"+slash+"p{"+name+"}+$","v");if(!compiled.ok)return 2;
  if(executeRegExp(compiled.value,values.join("")).kind!=="match")return 3;
  const input=values.join("");
  const reverse=compileRegExp("(?<=^"+slash+"p{"+name+"}+)$","v");
  if(!reverse.ok||executeRegExp(reverse.value,input,input.length,true).kind!=="match")return 6;
  for(const value of values){if(value===undefined)return 5;all.push(value);}
 }
 const compiled=compileRegExp("^"+slash+"p{RGI_Emoji}+$","v");
 if(!compiled.ok||executeRegExp(compiled.value,all.join("")).kind!=="match")return 4;
 const folded=compileRegExp("^"+slash+"p{Basic_Emoji}$","vi");
 if(!folded.ok||executeRegExp(folded.value,"ⓜ️").kind!=="match")return 7;
 return 42;
}`,
  "regexp-string-property-corpus",
  [
    ["engine", "packages/foundation/src/regexp/engine/index.ts"],
    ["data", "packages/foundation/src/regexp/engine/string-property-data.ts"],
  ],
  [],
  [],
  [],
  { managedBytes: 268435456, allocationCapacity: 8388608 },
);

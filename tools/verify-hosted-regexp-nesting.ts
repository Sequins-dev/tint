import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {compileRegExp,executeRegExp} from "engine";
import {parseRegExp} from "syntax";
export function run():number {
 const openings:string[]=["(","(?:"];
 const depths:number[]=[200,511];
 for(let depthIndex=0;depthIndex<depths.length;depthIndex++){
 const depth=depths[depthIndex];if(depth===undefined)return 6;
 for(let index=0;index<openings.length;index++){
  const opening=openings[index];if(opening===undefined)return 5;
  const program=compileRegExp(opening.repeat(depth)+"hello"+")".repeat(depth),"");
  if(!program.ok)return 1;
  const result=executeRegExp(program.value,"hello");
  if(result.kind!=="match"||result.match.start!==0||result.match.end!==5)return 2;
  if(result.match.captures.length!==(opening==="("?depth+1:1))return 3;
  for(const capture of result.match.captures)
   if(capture===undefined||capture.start!==0||capture.end!==5)return 4;
 }
 }
 const set=compileRegExp("[".repeat(511)+"x"+"]".repeat(511),"v");
 if(!set.ok||executeRegExp(set.value,"x").kind!=="match")return 7;
 const mixed=compileRegExp("(".repeat(200)+"[x]"+")".repeat(200),"v");
 if(!mixed.ok||executeRegExp(mixed.value,"x").kind!=="match")return 8;
 const deep=parseRegExp("(".repeat(4096)+"x"+")".repeat(4096),"");
 if(!deep.ok||deep.value.captures!==4096)return 9;
 const deepSet=parseRegExp("[".repeat(4096)+"x"+"]".repeat(4096),"v");
 if(!deepSet.ok)return 10;
 const malformed=parseRegExp("(".repeat(4096)+"x"+")".repeat(4095),"");
 if(malformed.ok||malformed.error.kind!=="syntax")return 11;
 return 42;
}`,
  "regexp-nesting",
  [
    ["engine", "packages/foundation/src/regexp/engine/index.ts"],
    ["syntax", "packages/foundation/src/regexp/syntax/index.ts"],
  ],
  [],
  [],
  [],
  {
    managedBytes: 268435456,
    allocationCapacity: 8388608,
    rootCapacity: 16384,
    stackBytes: 16777216,
  },
);

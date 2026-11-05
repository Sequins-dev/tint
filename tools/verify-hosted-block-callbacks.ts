import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
export function run():number{
 const a=[1,2,3];const mapped=a.map(v=>{if(v>1)return v+1;});
 if(mapped[0]!==undefined||mapped[1]!==3||mapped[2]!==4||mapped.indexOf(undefined)!==0)return 1;
 const bare=a.map(v=>{if(v===2)return;return v;});if(bare[0]!==1||bare[1]!==undefined||bare[2]!==3)return 2;
 if(!a.some(v=>{return v===2;})||a.findLastIndex(v=>{return v===2;})!==1)return 3;
 const strings=a.map(v=>{if(v>1)return "yes";});if(strings[0]!==undefined||strings[1]!=="yes")return 4;
 const objects=a.map(v=>{if(v>1)return {value:v};});if(objects[0]!==undefined||objects[1]?.value!==2)return 5;
 const flags=a.map(v=>{if(v>1)return false;});if(flags[0]!==undefined||flags[1]!==false)return 6;
 const nested=a.map(v=>{const result=a.some(inner=>{return inner===v;});return result;});if(nested[2]!==true)return 7;
 let caught=0;try{a.some(v=>{throw 19;});}catch(e){if(e===19)caught=1;}if(caught!==1)return 8;
 return 42;
}`,
  "block-callbacks",
);

import { verifyHostedFixture } from "./hosted-fixture.ts";
// Managed heap exhaustion throws through compiled code instead of trapping, so
// an embedded compilation of a huge Script entry fails gracefully. The filled
// list becomes garbage once its frame unwinds; later allocation succeeds.
verifyHostedFixture(
  `
function fill():number{
 const kept:string[]=[];
 for(let i=0;i<100000000;i++)kept.push("item-"+String(i));
 return kept.length;
}
function exhausted(error:unknown):boolean{return error==="MANAGED_HEAP_EXHAUSTED";}
export function run():number{
 let caught=0;
 try{fill();return 1;}catch(error){if(exhausted(error))caught++;}
 try{const huge="x".repeat(16777216);return huge.length===0?2:3;}catch(error){if(exhausted(error))caught++;}
 if(caught!==2)return 4;
 const after:string[]=[];
 for(let i=0;i<1000;i++)after.push("again-"+String(i));
 if(after.join("|").length!==${Array.from({ length: 1000 }, (_, i) => "again-" + i).join("|").length})return 5;
 return 42;
}`,
  "heap-exhaustion",
);

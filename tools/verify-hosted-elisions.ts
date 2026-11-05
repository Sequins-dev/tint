import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
export function run():number{
 const a=[,1,,undefined,];if(a.length!==4||a.indexOf(undefined)!==3||!a.includes(undefined))return 1;
 let seen=0;a.forEach(()=>{seen++;});if(seen!==2)return 2;
 const holes=[,,];if(holes.length!==2||holes.indexOf(undefined)!==-1)return 3;
 let visited=0;holes.find(v=>{visited++;return false;});if(visited!==2)return 4;
 const copied=[...a];if(copied.length!==4||copied.indexOf(undefined)!==0)return 5;
 const mixed=[,...a,,2,,];if(mixed.length!==8||mixed[6]!==2||mixed.indexOf(undefined)!==1)return 6;
 const strings=[,"a",,];if(strings.length!==3||strings.join("-")!=="-a-")return 7;
 const flags=[,false,,true];if(flags.indexOf(false)!==1||flags[0]!==undefined)return 8;
 const objects=[,{value:3},];if(objects[1]?.value!==3||objects.length!==2)return 9;
 let order=0;function value(n:number):number{order=order*10+n;return n;}
 const effects=[,value(1),,...[value(2)],,value(3),];if(order!==123||effects.length!==6||effects[5]!==3)return 10;
 const trailing=[1,];if(trailing.length!==1)return 11;
 const mapped=a.map(v=>v);if(mapped.indexOf(undefined)!==3)return 12;
 return 42;
}`,
  "elisions",
);

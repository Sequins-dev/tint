import { verifyHostedFixture } from "./hosted-fixture.ts";

verifyHostedFixture(
  `
debugger;
function increment(value:number):number {
 debugger;
 try { if(value>0)debugger; return value+1; }
 finally { debugger; }
}
export function run():number {
 let value=40;
 while(value<42){debugger;value=increment(value);}
 debugger;
 return value;
}
`,
  "debugger",
  [],
);

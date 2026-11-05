import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.PlainDate(-271821,5,19),b=new Temporal.PlainDate(-271821,5,18);const d=a.until(b,{largestUnit:"year",roundingIncrement:2,roundingMode:"expand"});if(d.years!==0||d.months!==0||d.days!==-2)throw 1;`,
    String.raw`const a=new Temporal.PlainDate(2022,1,1),b=new Temporal.PlainDate(2022,1,31);const d=a.until(b,{largestUnit:"month",roundingIncrement:32,roundingMode:"expand"});if(d.months!==1||d.days!==0)throw 1;const r=a.since(b,{largestUnit:"month",roundingIncrement:32,roundingMode:"floor"});if(r.months!==-1||r.days!==0)throw 2;`,
    String.raw`const a=new Temporal.PlainDate(2021,1,1),b=new Temporal.PlainDate(2021,2,4);const d=a.until(b,{largestUnit:"month",roundingIncrement:2,roundingMode:"trunc"});if(d.months!==1||d.days!==2)throw 1;const e=a.since(b,{largestUnit:"month",roundingIncrement:2,roundingMode:"floor"});if(e.months!==-1||e.days!==-4)throw 2;`,
  ],
  { nodeReference: false },
);

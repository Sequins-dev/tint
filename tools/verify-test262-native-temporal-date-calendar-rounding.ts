import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.PlainDate(2019,1,1),b=new Temporal.PlainDate(2019,2,15);if(a.until(b,{smallestUnit:"month",roundingMode:"halfExpand"}).months!==2||b.until(a,{smallestUnit:"month",roundingMode:"halfExpand"}).months!==-1)throw 1;`,
    String.raw`const a=new Temporal.PlainDate(2022,1,1),b=new Temporal.PlainDate(2023,12,25);const d=a.until(b,{largestUnit:"year",smallestUnit:"month",roundingMode:"expand"});if(d.years!==2||d.months!==0)throw 1;`,
    String.raw`const a=new Temporal.PlainDate(2019,1,1),b=new Temporal.PlainDate(2020,7,2);if(a.until(b,{smallestUnit:"year",roundingMode:"halfEven"}).years!==2||a.until(b,{smallestUnit:"year",roundingMode:"halfTrunc"}).years!==1||a.since(b,{smallestUnit:"year",roundingMode:"halfFloor"}).years!==-2)throw 1;`,
    String.raw`const a=new Temporal.PlainDate(1970,1,1),b=new Temporal.PlainDate(1971,1,1);let ok=false;try{a.until(b,{smallestUnit:"month",roundingIncrement:100000000});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 1;const d=new Temporal.PlainDate(2021,1,31).until("2021-02-28",{smallestUnit:"month",roundingMode:"trunc"});if(d.months!==1||d.days!==0)throw 2;`,
  ],
  { nodeReference: false },
);

import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.PlainDateTime(1970,1,1),b=new Temporal.PlainDateTime(1971,12,31,23,59,59,999,999,999);const d=a.until(b,{largestUnit:"year",smallestUnit:"microsecond",roundingMode:"expand"});if(d.years!==2||d.months!==0||d.days!==0||d.hours!==0||d.nanoseconds!==0)throw 1;`,
    String.raw`const a=new Temporal.PlainDateTime(2021,1,31),b=new Temporal.PlainDateTime(2021,2,27,23,59,59,999,999,999);const d=a.until(b,{largestUnit:"month",smallestUnit:"microsecond",roundingMode:"expand"});if(d.months!==1||d.days!==0||d.nanoseconds!==0)throw 1;const n=a.since(b,{largestUnit:"month",smallestUnit:"microsecond",roundingMode:"floor"});if(n.months!==-1||n.days!==0)throw 2;`,
  ],
  { nodeReference: false },
);

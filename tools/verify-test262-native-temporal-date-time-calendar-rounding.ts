import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.PlainDateTime(2020,1,1,12),b=new Temporal.PlainDateTime(2020,7,2,12,0,0,0,0,1);if(a.until(b,{smallestUnit:"year",roundingMode:"halfEven"}).years!==1||a.since(b,{smallestUnit:"year",roundingMode:"ceil"}).years!==0)throw 1;`,
    String.raw`const a=new Temporal.PlainDateTime(2019,1,1,12),b=new Temporal.PlainDateTime(2019,2,15,12);if(a.until(b,{smallestUnit:"month",roundingMode:"halfExpand"}).months!==2||a.until(b,{smallestUnit:"month",roundingMode:"halfTrunc"}).months!==1)throw 1;`,
    String.raw`const a=new Temporal.PlainDateTime(2019,1,1,23),b=new Temporal.PlainDateTime(2019,1,5,1);if(a.until(b,{smallestUnit:"week",roundingMode:"halfExpand"}).weeks!==0||a.until(b,{smallestUnit:"week",roundingMode:"ceil"}).weeks!==1)throw 1;`,
  ],
  { nodeReference: false },
);

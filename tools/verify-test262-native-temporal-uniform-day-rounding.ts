import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.PlainDate(2000,5,2),b=new Temporal.PlainDate(2000,5,7);if(a.until(b,{roundingIncrement:2.5,roundingMode:"trunc"}).days!==4||a.until(b,{roundingIncrement:1000000000.5,roundingMode:"expand"}).days!==1000000000)throw 1;`,
    String.raw`const a=new Temporal.PlainDateTime(2000,5,2),b=new Temporal.PlainDateTime(2000,5,7);if(a.until(b,{smallestUnit:"day",roundingIncrement:1000000000,roundingMode:"expand"}).days!==1000000000||a.since(b,{smallestUnit:"day",roundingIncrement:1000000000,roundingMode:"floor"}).days!==-1000000000)throw 1;`,
    String.raw`const a=new Temporal.PlainDate(1970,1,1),b=new Temporal.PlainDate(1971,1,1);let ok=false;try{a.until(b,{smallestUnit:"month",roundingIncrement:100000000});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 1;`,
  ],
  { nodeReference: false },
);

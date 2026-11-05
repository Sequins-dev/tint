import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Temporal.PlainDateTime(2020,2,29,23,59,59,999,999,999);if(d.round("second").toString()!=="2020-03-01T00:00:00"||d.round("day").toString()!=="2020-03-01T00:00:00"||new Temporal.PlainDateTime(2020,1,1,12).round({smallestUnit:"day",roundingMode:"halfEven"}).day!==1)throw 1;class D extends Temporal.PlainDateTime{}const sub=new D(2020,1,1);if(sub.round("nanosecond")===sub||sub.round("nanosecond") instanceof D)throw 2;`,
    String.raw`let log="",ok=false;try{new Temporal.PlainDateTime(2020,1,1).round({get roundingIncrement(){log+="i;";return 2;},get roundingMode(){log+="m;";return "ceil";},get smallestUnit(){log+="u;";return "days";}});}catch(e){ok=e instanceof RangeError;}if(!ok||log!=="i;m;u;")throw 1;for(const d of [new Temporal.PlainDateTime(-271821,4,19,0,0,0,1),new Temporal.PlainDateTime(275760,9,13,23,59,59,999)]){ok=false;try{d.round({smallestUnit:"day",roundingMode:d.year<0?"floor":"ceil"});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;}`,
  ],
  { nodeReference: false },
);

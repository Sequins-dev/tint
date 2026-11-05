import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.PlainDateTime(2020,1,1,23),b=new Temporal.PlainDateTime(2020,1,3,1);const d=a.until(b);if(d.days!==1||d.hours!==2||d.minutes!==0)throw 1;if(a.until(b,{largestUnit:"hour"}).hours!==26||a.since(b).days!==-1||a.since(b).hours!==-2)throw 2;`,
    String.raw`const a=new Temporal.PlainDateTime(2021,1,31,23),b=new Temporal.PlainDateTime(2021,3,1,1);const d=a.until(b,{largestUnit:"month"});if(d.months!==0||d.days!==28||d.hours!==2)throw 1;const r=b.until(a,{largestUnit:"month"});if(r.months!==-1||r.days!==0||r.hours!==-2)throw 2;`,
    String.raw`const a=new Temporal.PlainDateTime(2020,1,1),b=new Temporal.PlainDateTime(2020,1,1,0,0,0,0,0,1);if(a.until(b).nanoseconds!==1||a.since(b,{largestUnit:"nanosecond"}).nanoseconds!==-1)throw 1;const max=new Temporal.PlainDateTime(275760,9,13,23),end=new Temporal.PlainDateTime(275760,9,13,23,0,0,0,0,1);if(max.until(end).nanoseconds!==1)throw 2;`,
    String.raw`const a=new Temporal.PlainDateTime(2020,1,1);let log="",ok=false;try{a.until("2020-01-02",{get largestUnit(){log+="l";return "month";},get roundingIncrement(){log+="i";return 1;},get roundingMode(){log+="m";return "trunc";},get smallestUnit(){log+="s";return "year";}});}catch(e){ok=e instanceof RangeError;}if(!ok||log!=="lims")throw 1;class D extends Temporal.PlainDateTime{}if(!(new D(2020,1,1).until(a) instanceof Temporal.Duration))throw 2;`,
  ],
  { nodeReference: false },
);

import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.PlainDate(2020,1,1),b=new Temporal.PlainDate(2021,1,1);if(a.until(b).days!==366||a.until(b,{largestUnit:"year"}).years!==1||b.since(a).days!==366)throw 1;const x=new Temporal.PlainDate(2021,1,31),y=new Temporal.PlainDate(2021,2,28),z=new Temporal.PlainDate(2021,3,31);if(x.until(y,{largestUnit:"month"}).months!==0||x.until(y,{largestUnit:"month"}).days!==28||z.until(y,{largestUnit:"month"}).months!==-1||y.since(z,{largestUnit:"month"}).days!==-3)throw 2;`,
    String.raw`const a=new Temporal.PlainDate(1970,1,1);let log="",ok=false;try{a.until("1970-01-02",{get largestUnit(){log+="l";return "hour";},get roundingIncrement(){log+="i";return 1;},get roundingMode(){log+="m";return "trunc";},get smallestUnit(){log+="s";return "day";}});}catch(e){ok=e instanceof RangeError;}if(!ok||log!=="lims")throw 1;let touched=false;ok=false;try{a.until("invalid",{get largestUnit(){touched=true;return "day";}});}catch(e){ok=e instanceof RangeError;}if(!ok||touched)throw 2;`,
    String.raw`const a=new Temporal.PlainDate(1970,1,1);if(a.until("1970-01-11",{smallestUnit:"week",roundingMode:"halfExpand"}).weeks!==1||a.until("1970-01-11",{smallestUnit:"week",roundingIncrement:2,roundingMode:"halfExpand"}).weeks!==2||a.since("1970-01-11",{smallestUnit:"week",roundingMode:"floor"}).weeks!==-2)throw 1;if(a.until("1970-01-06",{roundingIncrement:2}).days!==4)throw 2;`,
    String.raw`class D extends Temporal.PlainDate{}const a=new D(1970,1,1);if(!(a.until(a,{smallestUnit:"year",roundingIncrement:3}) instanceof Temporal.Duration)||a.until(a,{smallestUnit:"year"}).sign!==0)throw 1;const start=new Temporal.PlainDate(275760,9,12),end=new Temporal.PlainDate(275760,9,13);let ok=false;try{start.until(end,{smallestUnit:"week",roundingMode:"ceil"});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;`,
  ],
  { nodeReference: false },
);

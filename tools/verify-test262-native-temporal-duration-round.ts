import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`let log="";const d=new Temporal.Duration(0,0,0,0,1,59,31),r=d.round({get largestUnit(){log+="l";return "auto";},get relativeTo(){log+="r";return undefined;},get roundingIncrement(){log+="i";return 1;},get roundingMode(){log+="m";return "halfExpand";},get smallestUnit(){log+="s";return "minute";}});if(log!=="lrims"||r.hours!==2||r.minutes!==0||r===d)throw 1;if(d.round("hours").hours!==2||d.round({largestUnit:"auto"}).seconds!==31)throw 2;`,
    String.raw`const d=new Temporal.Duration(0,1,0,14,12),r=d.round({largestUnit:"month",smallestUnit:"day",relativeTo:"2020-01-01"});if(r.months!==1||r.days!==15||r.hours!==0)throw 1;const c=new Temporal.Duration(0,1,0,28,12).round({largestUnit:"month",smallestUnit:"day",relativeTo:"2020-01-01"});if(c.months!==2||c.days!==0)throw 2;`,
    String.raw`const d=new Temporal.Duration(0,0,0,1);for(const [relativeTo,hours] of [["2024-03-09T12:00[America/New_York]",23],["2024-11-02T12:00[America/New_York]",25]]){const o={largestUnit:"hour",smallestUnit:"hour",relativeTo};if(d.round(o).hours!==hours||d.total({unit:"hour",relativeTo})!==hours)throw 1;const z=Temporal.ZonedDateTime.from(relativeTo);if(d.round({...o,relativeTo:z}).hours!==hours||Temporal.Duration.compare(d,{hours:24},{relativeTo:z})!==(hours===23?-1:1))throw 2;}`,
    String.raw`let count=0;for(const options of [undefined,null,true,1,"auto","",{}, {smallestUnit:"minute",roundingIncrement:7},{largestUnit:"month",smallestUnit:"day",roundingIncrement:2,relativeTo:"2020-01-01"}]){try{new Temporal.Duration().round(options);}catch(e){if(e instanceof TypeError||e instanceof RangeError)count++;}}if(count!==9)throw count;`,
  ],
  { nodeReference: false },
);

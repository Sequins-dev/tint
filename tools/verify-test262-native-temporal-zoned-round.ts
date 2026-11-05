import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=Temporal.ZonedDateTime.from("1969-12-31T23:59:59.999999999[+05:30]");const b=a.round("second");if(b.year!==1970||b.month!==1||b.day!==1||b.hour!==0||b.second!==0||b.timeZoneId!=="+05:30")throw 1;const c=Temporal.ZonedDateTime.from("1970-01-01T12:00[+05:30]");if(c.round("day").day!==2||c.round({smallestUnit:"day",roundingMode:"halfEven"}).day!==1)throw 2;`,
    String.raw`const upper=new Temporal.ZonedDateTime(8640000000000000000000n,"UTC");const clone=upper.round("nanosecond");if(clone===upper||!clone.equals(upper))throw 1;for(const mode of ["floor","ceil","halfExpand"]){let ok=false;try{upper.round({smallestUnit:"day",roundingMode:mode});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;}const lower=new Temporal.ZonedDateTime(-8640000000000000000000n,"-01:00");let ok=false;try{lower.round("second");}catch(e){ok=e instanceof RangeError;}if(!ok)throw 3;`,
    String.raw`class Z extends Temporal.ZonedDateTime{}const a=new Z(1n,"UTC");let log="";const b=a.round({get roundingIncrement(){log+="i";return 1;},get roundingMode(){log+="m";return "trunc";},get smallestUnit(){log+="u";return "second";}});if(log!=="imu"||b instanceof Z||b.epochNanoseconds!==0n)throw 1;for(const value of [undefined,null,{},"year",{smallestUnit:"day",roundingIncrement:2},{smallestUnit:"hour",roundingIncrement:24}]){let ok=false;try{a.round(value);}catch(e){ok=e instanceof RangeError||e instanceof TypeError;}if(!ok)throw 2;}`,
  ],
  { nodeReference: false },
);

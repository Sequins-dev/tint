import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=Temporal.ZonedDateTime.from("2020-02-29T12:34:56.987654321[+05:30]");const b=a.with({year:2021});if(b.year!==2021||b.month!==2||b.day!==28||b.hour!==12||b.nanosecond!==321||b.timeZoneId!=="+05:30")throw 1;const c=a.with({monthCode:"M03",minute:1});if(c.month!==3||c.day!==29||c.minute!==1||c.millisecond!==987)throw 2;let ok=false;try{a.with({year:2021},{overflow:"reject"});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 3;`,
    String.raw`const a=new Temporal.ZonedDateTime(0n,"UTC");if(a.with({offset:"+01:00"}).epochNanoseconds!==0n||a.with({offset:"+01:00"},{offset:"use"}).epochNanoseconds!==-3600000000000n)throw 1;let ok=false;try{a.with({offset:"+01:00"},{offset:"reject"});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;for(const value of [{},{extra:1},{year:undefined},a,{timeZone:"UTC"},{calendar:"iso8601"}]){ok=false;try{a.with(value);}catch(e){ok=e instanceof TypeError;}if(!ok)throw 3;}`,
    String.raw`const a=new Temporal.ZonedDateTime(0n,"UTC");let log="";const b=a.with({get calendar(){log+="c";},get timeZone(){log+="z";},get day(){log+="d";return 1;},get offset(){log+="o";return "+00:00";},get second(){log+="s";return 2;},get year(){log+="y";return 1970;}},{get disambiguation(){log+="D";return "compatible";},get offset(){log+="O";return "prefer";},get overflow(){log+="F";return "reject";}});if(log!=="czdosyDOF"||b.second!==2)throw 1;class Z extends Temporal.ZonedDateTime{}if(new Z(0n,"UTC").with({hour:1}) instanceof Z)throw 2;`,
  ],
  { nodeReference: false },
);

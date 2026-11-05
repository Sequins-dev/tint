import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Temporal.ZonedDateTime(-1n,"-01:30");if(d.toInstant().toString()!=="1969-12-31T23:59:59.999999999Z"||d.toPlainDate().toString()!=="1969-12-31"||d.toPlainTime().toString()!=="22:29:59.999999999"||d.toPlainDateTime().toString()!=="1969-12-31T22:29:59.999999999")throw 1;const copy=d.withCalendar("2000-01-01[u-ca=iso8601]");if(copy===d||copy.timeZoneId!=="-01:30"||copy.epochNanoseconds!==-1n)throw 2;`,
    String.raw`class Z extends Temporal.ZonedDateTime{}const z=new Z(1n,"UTC");for(const name of ["constructor","year","month","day","hour","calendar","timeZoneId","epochNanoseconds"])Object.defineProperty(z,name,{get(){throw 1;}});if(z.toInstant().epochNanoseconds!==1n||z.toPlainDateTime().nanosecond!==1||z.withCalendar("iso8601") instanceof Z)throw 2;for(const name of ["toInstant","toPlainDate","toPlainTime","toPlainDateTime","withCalendar"]){let touched=false,ok=false;try{Temporal.ZonedDateTime.prototype[name].call({}, {get calendar(){touched=true;return "iso8601";}});}catch(e){ok=e instanceof TypeError;}if(!ok||touched)throw 3;}`,
  ],
  { nodeReference: false },
);

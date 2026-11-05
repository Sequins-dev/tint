import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const i=new Temporal.Instant(0n);for(const [input,expected] of [["UTC","UTC"],["+0146","+01:46"],["2021-08-19T17:30:45-12:12[+01:46]","+01:46"],["T17:30-01:46","-01:46"],["2021-08[UTC]","UTC"],["--08-19[UTC]","UTC"]]){const z=i.toZonedDateTimeISO(input);if(z.timeZoneId!==expected||z.epochNanoseconds!==0n||z.calendarId!=="iso8601")throw 1;}const z=i.toZonedDateTimeISO("+01:46");if(z.hour!==1||z.minute!==46||i.toString({timeZone:"2021-08-19T17:30Z[+01:46]"})!=="1970-01-01T01:46:00+01:46")throw 2;`,
    String.raw`const i=new Temporal.Instant(0n);const zone=new Temporal.ZonedDateTime(0n,"-01:30");Object.defineProperty(zone,"timeZoneId",{get(){throw 1;}});if(i.toZonedDateTimeISO(zone).timeZoneId!=="-01:30"||i.toString({timeZone:zone})!=="1969-12-31T22:30:00-01:30")throw 2;for(const value of [undefined,null,1,{},new Proxy(zone,{})]){let ok=false;try{i.toZonedDateTimeISO(value);}catch(e){ok=e instanceof TypeError;}if(!ok)throw 3;}for(const value of ["Z","2021-08-19","2021-08-19T17:30-00:00:00"]){let ok=false;try{i.toZonedDateTimeISO(value);}catch(e){ok=e instanceof RangeError;}if(!ok)throw 4;}`,
  ],
  { nodeReference: false },
);

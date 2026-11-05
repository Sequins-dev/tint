import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const id=Temporal.Now.timeZoneId();if(typeof id!=="string"||id.length===0)throw 1;const start=Temporal.Now.instant();const z=Temporal.Now.zonedDateTimeISO();const end=Temporal.Now.instant();if(z.timeZoneId!==id||z.epochNanoseconds<start.epochNanoseconds||z.epochNanoseconds>end.epochNanoseconds||z.calendarId!=="iso8601")throw 2;for(const name of ["plainDateISO","plainTimeISO","plainDateTimeISO"]){const v=Temporal.Now[name]();if(Object.prototype.toString.call(v).indexOf("Temporal.Plain")<0)throw 3;}if(Temporal.Now.timeZoneId.call(null)!==id)throw 4;`,
    String.raw`for(const name of ["plainDateTimeISO","plainDateISO","plainTimeISO","zonedDateTimeISO"]){const a=Temporal.Now[name]("America/New_York"),b=Temporal.Now[name]("+05:30");if(a===b)throw 1;for(const value of [null,{},1,true,0n]){let caught=false;try{Temporal.Now[name](value);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;}}`,
  ],
  { nodeReference: false },
);

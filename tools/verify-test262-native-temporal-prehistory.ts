import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`for(const name of ["America/Cambridge_Bay","Antarctica/Rothera"]){const min=new Temporal.ZonedDateTime(-8640000000000000000000n,name);if(min.offsetNanoseconds!==0)throw 1;const next=min.getTimeZoneTransition("next");if(next!==null&&next.epochNanoseconds<=min.epochNanoseconds)throw 2;const max=new Temporal.ZonedDateTime(8640000000000000000000n,name),prev=max.getTimeZoneTransition("previous");if(prev!==null&&prev.epochNanoseconds>=max.epochNanoseconds)throw 3;if(min.getTimeZoneTransition("previous")!==null||max.getTimeZoneTransition("next")!==null)throw 4;}`,
    String.raw`const value=-8640000000000000,d=new Date(value);if(d.getTimezoneOffset()!==0)throw 1;const copy=new Date(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours(),d.getMinutes(),d.getSeconds(),d.getMilliseconds());if(copy.getTime()!==value||Date.parse(d.toString())!==value)throw 2;`,
  ],
  { nodeReference: false },
);

import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const t=new Temporal.PlainTime(12.9,34.8,56.7,987.6,654.5,321.4);if(t.hour!==12||t.minute!==34||t.second!==56||t.millisecond!==987||t.microsecond!==654||t.nanosecond!==321||t.toString()!=="12:34:56.987654321"||t.toJSON()!==t.toString())throw 1;if(new Temporal.PlainTime().toString()!=="00:00:00"||"calendarId" in t||"year" in t)throw 2;for(const args of [[24],[0,60],[0,0,60],[0,0,0,1000],[0,0,0,0,1000],[0,0,0,0,0,-1]]){let ok=false;try{new Temporal.PlainTime(...args);}catch(e){ok=e instanceof RangeError;}if(!ok)throw 3;}`,
    String.raw`class T extends Temporal.PlainTime{}const t=new T(12);if(!(t instanceof T)||t.toString()!=="12:00:00")throw 1;const getter=Object.getOwnPropertyDescriptor(Temporal.PlainTime.prototype,"hour").get;for(const o of [new Proxy(t,{}),Object.create(t),new Temporal.PlainDateTime(2000,1,1,12)]){let ok=false;try{getter.call(o);}catch(e){ok=e instanceof TypeError;}if(!ok)throw 2;}const d=new Temporal.PlainDateTime(2020,2,29,12,34,56,987,654,321),z=new Temporal.ZonedDateTime(1000000000987654321n,"UTC");if(d.millisecond!==987||d.microsecond!==654||d.nanosecond!==321||z.hour!==1||z.microsecond!==654||z.nanosecond!==321)throw 3;`,
  ],
  { nodeReference: false },
);

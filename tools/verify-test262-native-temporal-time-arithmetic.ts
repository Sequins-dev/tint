import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const midnight=new Temporal.PlainTime();if(midnight.subtract({nanoseconds:1}).toString()!=="23:59:59.999999999"||midnight.add("PT25H").hour!==1||new Temporal.PlainTime(12).add("PT1.03125H").toString()!=="13:01:52.5")throw 1;for(const duration of ["P1Y","P1M","P1W","P1D"]){if(new Temporal.PlainTime(12,34).add(duration).toString()!=="12:34:00")throw 2;}const huge=midnight.add({nanoseconds:9007199254740992,microseconds:1});if(huge.toString()!=="05:59:59.254741992")throw 3;`,
    String.raw`const t=new Temporal.PlainTime(12);let touched=false,ok=false;try{Temporal.PlainTime.prototype.add.call({}, {get seconds(){touched=true;return 1;}});}catch(e){ok=e instanceof TypeError;}if(!ok||touched)throw 1;for(const value of [{hours:1,seconds:-1},{seconds:0.5},"P4294967296Y"]){ok=false;try{t.add(value);}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;}class T extends Temporal.PlainTime{}if(new T(12).add({hours:1}) instanceof T)throw 3;const i=Temporal.Instant.from("1969-12-31T23:59:59.999999999Z"),z=new Temporal.ZonedDateTime(-1n,"-01:30");if(i.epochMilliseconds!==-1||i.toString()!=="1969-12-31T23:59:59.999999999Z"||z.toPlainTime().toString()!=="22:29:59.999999999")throw 4;`,
  ],
  { nodeReference: false },
);

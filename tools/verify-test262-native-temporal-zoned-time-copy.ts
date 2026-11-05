import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.ZonedDateTime(217175010123456789n,"+05:30");const b=a.withPlainTime("12:34:56.987654321");if(b.year!==a.year||b.month!==a.month||b.day!==a.day||b.hour!==12||b.minute!==34||b.second!==56||b.millisecond!==987||b.microsecond!==654||b.nanosecond!==321||b.timeZoneId!==a.timeZoneId)throw 1;const c=a.startOfDay();if(c.hour!==0||c.minute!==0||c.second!==0||c.nanosecond!==0||!c.equals(a.withPlainTime())||c===a)throw 2;`,
    String.raw`class Z extends Temporal.ZonedDateTime{get year(){throw 1;}get timeZoneId(){throw 2;}}const a=new Z(0n,"UTC");if(a.startOfDay() instanceof Z||a.withPlainTime({hour:24,second:80}).hour!==23||a.withPlainTime({hour:24,second:80}).second!==59)throw 3;for(const f of [Temporal.ZonedDateTime.prototype.startOfDay,Temporal.ZonedDateTime.prototype.withPlainTime]){let ok=false;try{f.call({});}catch(e){ok=e instanceof TypeError;}if(!ok)throw 4;}`,
    String.raw`const a=new Temporal.ZonedDateTime(-8640000000000000000000n,"-01:00");for(const f of [()=>a.startOfDay(),()=>a.withPlainTime("00:00")]){let ok=false;try{f();}catch(e){ok=e instanceof RangeError;}if(!ok)throw 1;}const b=new Temporal.ZonedDateTime(0n,"UTC");for(const value of [null,1,true,{},"invalid"]){let ok=false;try{b.withPlainTime(value);}catch(e){ok=e instanceof TypeError||e instanceof RangeError;}if(!ok)throw 2;}`,
  ],
  { nodeReference: false },
);

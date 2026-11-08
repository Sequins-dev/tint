import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases(
  [
    String.raw`for(const C of [Temporal.Duration,Temporal.Instant,Temporal.PlainDate,Temporal.PlainDateTime,Temporal.PlainMonthDay,Temporal.PlainTime,Temporal.PlainYearMonth,Temporal.ZonedDateTime]){const d=Object.getOwnPropertyDescriptor(C.prototype,"toLocaleString");if(!d||!d.writable||d.enumerable||!d.configurable||typeof d.value!=="function"||d.value.name!=="toLocaleString"||d.value.length!==0)throw 1;let bad=false;try{new d.value();}catch(e){bad=e instanceof TypeError;}if(!bad)throw 2;}`,
    String.raw`const date=new Temporal.PlainDate(2024,2,29),zoned=new Temporal.ZonedDateTime(0n,"UTC");for(const C of [Temporal.PlainDate,Temporal.ZonedDateTime]){const f=C.prototype.toLocaleString;for(const value of [undefined,null,true,"",1,Symbol(),1n,{},C,C.prototype,new Temporal.PlainDateTime(2024,2,29),C===Temporal.PlainDate?zoned:date]){let bad=false;try{f.call(value);}catch(e){bad=e instanceof TypeError;}if(!bad)throw 1;}}`,
    String.raw`const poison=new Proxy({},{get(){throw 1;}});for(const pair of [[new Temporal.PlainDate(2024,2,29),"2024-02-29"],[new Temporal.PlainDate(0,2,29),"0000-02-29"],[new Temporal.ZonedDateTime(0n,"UTC"),"1970-01-01T00:00:00+00:00[UTC]"],[new Temporal.ZonedDateTime(0n,"+01:00"),"1970-01-01T01:00:00+01:00[+01:00]"]]){const value=pair[0];value.toString=function(){throw 2;};if(value.toLocaleString(poison,poison)!==pair[1])throw 3;}`,
  ],
  { nodeReference: false },
);

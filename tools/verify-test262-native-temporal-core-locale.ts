import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases(
  [
    String.raw`for(const C of [Temporal.Duration,Temporal.Instant,Temporal.PlainDate,Temporal.PlainDateTime,Temporal.PlainMonthDay,Temporal.PlainTime,Temporal.PlainYearMonth,Temporal.ZonedDateTime]){const d=Object.getOwnPropertyDescriptor(C.prototype,"toLocaleString");if(!d||!d.writable||d.enumerable||!d.configurable||typeof d.value!=="function"||d.value.name!=="toLocaleString"||d.value.length!==0)throw 1;let bad=false;try{new d.value();}catch(e){bad=e instanceof TypeError;}if(!bad)throw 2;}`,
    String.raw`const date=new Temporal.PlainDate(2024,2,29),zoned=new Temporal.ZonedDateTime(0n,"UTC");for(const C of [Temporal.PlainDate,Temporal.ZonedDateTime]){const f=C.prototype.toLocaleString;for(const value of [undefined,null,true,"",1,Symbol(),1n,{},C,C.prototype,new Temporal.PlainDateTime(2024,2,29),C===Temporal.PlainDate?zoned:date]){let bad=false;try{f.call(value);}catch(e){bad=e instanceof TypeError;}if(!bad)throw 1;}}`,
    String.raw`const poison=new Proxy({},{get(){throw 1;}});for(const value of [new Temporal.PlainDate(2024,2,29),new Temporal.ZonedDateTime(0n,"UTC")]){value.toString=function(){throw 2;};let seen=false;try{value.toLocaleString(poison);}catch(e){seen=e===1;}if(!seen)throw 3;}`,
    String.raw`const date=new Temporal.PlainDate(2024,2,29);if(date.toLocaleString("en")!==new Intl.DateTimeFormat("en").format(date))throw 1;const zoned=new Temporal.ZonedDateTime(0n,"UTC"),text=zoned.toLocaleString("en");if(typeof text!=="string"||!text.includes("1970")||!text.includes("UTC"))throw 2;`,
  ],
  { nodeReference: false },
);

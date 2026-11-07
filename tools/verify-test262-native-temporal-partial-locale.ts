import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases(
  [
    String.raw`for(const C of [Temporal.PlainYearMonth,Temporal.PlainMonthDay]){const d=Object.getOwnPropertyDescriptor(C.prototype,"toLocaleString");if(!d||!d.writable||d.enumerable||!d.configurable||typeof d.value!=="function"||d.value.name!=="toLocaleString"||d.value.length!==0)throw 1;let bad=false;try{new d.value();}catch(e){bad=e instanceof TypeError;}if(!bad)throw 2;}`,
    String.raw`for(const C of [Temporal.PlainYearMonth,Temporal.PlainMonthDay]){const f=C.prototype.toLocaleString;for(const value of [undefined,null,true,"",1,Symbol(),1n,{},C,C.prototype]){let bad=false;try{f.call(value);}catch(e){bad=e instanceof TypeError;}if(!bad)throw 1;}}`,
    String.raw`const poison=new Proxy({},{get(){throw 1;}});for(const pair of [[new Temporal.PlainYearMonth(2024,2),"2024-02"],[new Temporal.PlainMonthDay(2,29),"02-29"]]){const value=pair[0];value.toString=function(){throw 2;};if(value.toLocaleString(poison,poison)!==pair[1])throw 3;}`,
  ],
  { nodeReference: false },
);

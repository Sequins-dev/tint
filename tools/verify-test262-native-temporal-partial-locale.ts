import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases(
  [
    String.raw`for(const C of [Temporal.PlainYearMonth,Temporal.PlainMonthDay]){const d=Object.getOwnPropertyDescriptor(C.prototype,"toLocaleString");if(!d||!d.writable||d.enumerable||!d.configurable||typeof d.value!=="function"||d.value.name!=="toLocaleString"||d.value.length!==0)throw 1;let bad=false;try{new d.value();}catch(e){bad=e instanceof TypeError;}if(!bad)throw 2;}`,
    String.raw`for(const C of [Temporal.PlainYearMonth,Temporal.PlainMonthDay]){const f=C.prototype.toLocaleString;for(const value of [undefined,null,true,"",1,Symbol(),1n,{},C,C.prototype]){let bad=false;try{f.call(value);}catch(e){bad=e instanceof TypeError;}if(!bad)throw 1;}}`,
    String.raw`const poison=new Proxy({},{get(){throw 1;}});for(const value of [new Temporal.PlainYearMonth(2024,2),new Temporal.PlainMonthDay(2,29)]){value.toString=function(){throw 2;};let seen=false;try{value.toLocaleString(poison);}catch(e){seen=e===1;}if(!seen)throw 3;}`,
    String.raw`const f=new Intl.DateTimeFormat("en-u-ca-iso8601");for(const value of [new Temporal.PlainYearMonth(2024,2),new Temporal.PlainMonthDay(2,29)])if(value.toLocaleString("en-u-ca-iso8601")!==new Intl.DateTimeFormat("en-u-ca-iso8601").format(value))throw 1;`,
  ],
  { nodeReference: false },
);

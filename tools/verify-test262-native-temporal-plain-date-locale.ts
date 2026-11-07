import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases(
  [
    String.raw`const d=Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype,"toLocaleString");if(!d||!d.writable||d.enumerable||!d.configurable||typeof d.value!=="function"||d.value.name!=="toLocaleString"||d.value.length!==0)throw 1;let bad=false;try{new d.value();}catch(e){bad=e instanceof TypeError;}if(!bad)throw 2;`,
    String.raw`const f=Temporal.PlainDate.prototype.toLocaleString;for(const value of [undefined,null,true,"",1,Symbol(),1n,{},Temporal.PlainDate,Temporal.PlainDate.prototype,new Temporal.PlainDateTime(2024,2,29)]){let bad=false;try{f.call(value);}catch(e){bad=e instanceof TypeError;}if(!bad)throw 1;}`,
    String.raw`const poison=new Proxy({},{get(){throw 1;}});for(const pair of [[new Temporal.PlainDate(2024,2,29),"2024-02-29"],[new Temporal.PlainDate(0,2,29),"0000-02-29"]]){const value=pair[0];value.toString=function(){throw 2;};if(value.toLocaleString(poison,poison)!==pair[1])throw 3;}`,
  ],
  { nodeReference: false },
);

import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const ids=Intl.supportedValuesOf("timeZone");if(!Array.isArray(ids)||ids.length<340||!ids.includes("UTC")||ids.includes("US/Eastern"))throw 1;for(let i=1;i<ids.length;i++)if(ids[i-1]>=ids[i])throw 2;if(Intl.supportedValuesOf("timeZone")===ids)throw 3;ids[0]="mutated";if(Intl.supportedValuesOf("timeZone")[0]==="mutated")throw 4;let log="";Intl.supportedValuesOf({toString(){log+="s";return "timeZone";}});if(log!=="s")throw 5;`,
    String.raw`for(const key of ["unknown",undefined,null,1,true,"timezone"]){let caught=false;try{Intl.supportedValuesOf(key);}catch(e){caught=e instanceof RangeError;}if(!caught)throw 1;}let symbol=false;try{Intl.supportedValuesOf(Symbol());}catch(e){symbol=e instanceof TypeError;}if(!symbol)throw 2;if(Object.prototype.toString.call(Intl)!=="[object Intl]"||Intl.supportedValuesOf.length!==1)throw 3;`,
  ],
  { nodeReference: false },
);

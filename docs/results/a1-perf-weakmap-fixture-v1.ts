// Native fixture: staging/sm/regress deep WeakMap chain (gc stubbed; G adds the runtime $262.gc).
import { verifyNativeScriptCases } from "../../tools/native-script-fixture.ts";
const chain = (n: number) => `var $262={gc:function(){}};function TestGC2(m){var head=new Object;for(var key=head,i=0;i<${n};i++,key=m.get(key))m.set(key,new Object);$262.gc();var c=0;for(key=head;key!=undefined;key=m.get(key))c++;if(c!==${n + 1})throw new Error(String(c));}TestGC2(new WeakMap);`;
verifyNativeScriptCases([chain(5000), chain(10000), chain(20000), chain(99999)], { nodeReference: true });

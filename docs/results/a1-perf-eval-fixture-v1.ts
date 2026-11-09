// usage: TINT_DEBUG_SYMBOLS=1 TINT_BUILD_ONLY=1 node build-eval-fixture.ts : eval/Function-preparation-heavy native Script cases
import { verifyNativeScriptCases } from "../../tools/native-script-fixture.ts";
verifyNativeScriptCases([
  'var s=0;for(var i=0;i<24;i++){s+=eval("var v"+i+"="+i+"; v"+i+"*2+(function(a){return a+1})(v"+i+")");}if(s!==852)throw new Error(String(s));',
  'var t=0;for(var i=0;i<24;i++){t+=Function("a","b","return a*"+i+"+b")(2,1);}if(t!==576)throw new Error(String(t));',
], { nodeReference: true });

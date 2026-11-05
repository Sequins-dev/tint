import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `delete Symbol.prototype[Symbol.toStringTag];const primitive=Symbol("x");if(Object.prototype.toString.call(primitive)!=="[object Object]"||Object.prototype.toString.call(Object(primitive))!=="[object Object]")throw 1;`,
  `for(const tag of [undefined,null,42,{},Symbol()]){Object.defineProperty(Symbol.prototype,Symbol.toStringTag,{value:tag,configurable:true});if(Object.prototype.toString.call(Symbol())!=="[object Object]")throw 1;}Object.defineProperty(Symbol.prototype,Symbol.toStringTag,{value:"custom"});if(Object.prototype.toString.call(Symbol())!=="[object custom]")throw 2;`,
  `delete BigInt.prototype[Symbol.toStringTag];if(Object.prototype.toString.call(1n)!=="[object Object]"||Object.prototype.toString.call(Object(1n))!=="[object Object]")throw 1;for(const [prototype,value,tag] of [[Number.prototype,1,"Number"],[Boolean.prototype,true,"Boolean"],[String.prototype,"x","String"]]){Object.defineProperty(prototype,Symbol.toStringTag,{value:undefined,configurable:true});if(Object.prototype.toString.call(value)!=="[object "+tag+"]")throw 2;}`,
]);

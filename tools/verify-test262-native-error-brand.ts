import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`for(const C of [Error,TypeError,RangeError,SyntaxError,ReferenceError,EvalError,URIError]){const e=new C();if(!Error.isError(e))throw 1;Object.setPrototypeOf(e,null);if(!Error.isError(e))throw 2;}class E extends Error{}if(!Error.isError(new E())||!Error.isError(new AggregateError([])))throw 3;`,
    String.raw`for(const value of [null,undefined,true,1,1n,"Error",Symbol(),{},[],Error.prototype,Object.create(Error.prototype),{[Symbol.toStringTag]:"Error"}])if(Error.isError(value))throw 1;const marker={};const p=new Proxy(new Error(),{get(){throw marker;},getPrototypeOf(){throw marker;}});if(Error.isError(p))throw 2;const r=Proxy.revocable(new Error(),{});r.revoke();if(Error.isError(r.proxy))throw 3;`,
    String.raw`const d=Object.getOwnPropertyDescriptor(Error,"isError");if(d.enumerable||!d.writable||!d.configurable||Error.isError.name!=="isError"||Error.isError.length!==1)throw 1;let caught=false;try{new Error.isError();}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;`,
  ],
  { nodeReference: false },
);

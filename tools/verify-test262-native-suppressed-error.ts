import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const error={},suppressed={};let log="";const message={toString(){log+="m";return "cleanup failed";}};const result=new SuppressedError(error,suppressed,message,{get cause(){throw 1;}});if(log!=="m"||result.error!==error||result.suppressed!==suppressed||result.message!=="cleanup failed"||Object.getOwnPropertyNames(result).slice(Object.getOwnPropertyNames(result).indexOf("message"),Object.getOwnPropertyNames(result).indexOf("message")+3).join(",")!=="message,error,suppressed"||"cause" in result||!(result instanceof Error)||!Error.isError(result))throw 2;for(const name of ["message","error","suppressed"]){const d=Object.getOwnPropertyDescriptor(result,name);if(d.enumerable||!d.writable||!d.configurable)throw 3;}`,
    String.raw`const value=SuppressedError(19,42);if(value.error!==19||value.suppressed!==42||Object.hasOwn(value,"message")||Object.getPrototypeOf(value)!==SuppressedError.prototype||Object.getPrototypeOf(SuppressedError)!==Error)throw 1;class Derived extends SuppressedError{}const derived=new Derived(19,42,"nested");if(!(derived instanceof Derived)||!Error.isError(derived)||derived.message!=="nested")throw 2;let caught=false;try{new SuppressedError(19,42,Symbol());}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;`,
  ],
  { nodeReference: true },
);

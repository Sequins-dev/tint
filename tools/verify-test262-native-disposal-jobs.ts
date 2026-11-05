import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases(
  [
    String.raw`let done=false;async function f(){{await using x=null;}done=true;}const result=f();Promise.resolve().then(()=>{if(!done)throw 1;return result;}).then(()=>print("Test262:AsyncTestComplete"),error=>print("Test262:AsyncTestFailure:Error:"+String(error)));`,
    String.raw`let log="";async function f(){{await using x={[Symbol.asyncDispose](){log+="d";}};}log+="f";}const result=f();if(log!=="d")throw 1;Promise.resolve().then(()=>{if(log!=="df")throw 2;return result;}).then(()=>print("Test262:AsyncTestComplete"),error=>print("Test262:AsyncTestFailure:Error:"+String(error)));`,
  ],
  { nodeReference: false, asynchronous: true },
);

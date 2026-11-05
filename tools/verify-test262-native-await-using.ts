import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases(
  [
    String.raw`let log="";async function f(){await using a={[Symbol.asyncDispose]:async function(){log+="a";await 0;log+="A";}};using b={[Symbol.dispose](){log+="b";}};await using c={[Symbol.asyncDispose]:async function(){log+="c";await 0;log+="C";}};log+="x";return 42;}f().then(value=>{if(value!==42||log!=="xcCbaA")throw 1;}).then(()=>print("Test262:AsyncTestComplete"),error=>print("Test262:AsyncTestFailure:Error:"+String(error)));`,
    String.raw`async function f(){await using a={[Symbol.asyncDispose]:async function(){throw 19;}};using b={[Symbol.dispose](){throw 42;}};throw 9;}f().then(()=>{throw 1;},e=>{if(!(e instanceof SuppressedError)||e.error!==19||!(e.suppressed instanceof SuppressedError)||e.suppressed.error!==42||e.suppressed.suppressed!==9)throw 2;}).then(()=>print("Test262:AsyncTestComplete"),error=>print("Test262:AsyncTestFailure:Error:"+String(error)));`,
    String.raw`let log="";async function f(){await using a={get [Symbol.asyncDispose](){log+="a";return null;},get [Symbol.dispose](){log+="s";return function(){log+="d";return {get then(){throw 1;}};};}};log+="x";}f().then(()=>{if(log!=="asxd")throw 2;}).then(()=>print("Test262:AsyncTestComplete"),error=>print("Test262:AsyncTestFailure:Error:"+String(error)));`,
    String.raw`let log="";async function f(){await using x=null;log+="b";}const p=f();log+="o";p.then(()=>{if(log!=="bo")throw 1;}).then(()=>print("Test262:AsyncTestComplete"),error=>print("Test262:AsyncTestFailure:Error:"+String(error)));`,
    String.raw`let log="";async function f(){using a={[Symbol.dispose](){log+="a";}};await using b=null;log+="b";}const p=f();log+="o";p.then(()=>{if(log!=="boa")throw 1;}).then(()=>print("Test262:AsyncTestComplete"),error=>print("Test262:AsyncTestFailure:Error:"+String(error)));`,
    String.raw`let log="";async function f(){for(await using x of [{[Symbol.asyncDispose]:async function(){log+="a";await 0;log+="A";}},{[Symbol.asyncDispose]:async function(){log+="b";}}]){log+="x";continue;}if(log!=="xaAxb")throw 1;}f().then(()=>print("Test262:AsyncTestComplete"),error=>print("Test262:AsyncTestFailure:Error:"+String(error)));`,
    String.raw`let log="";async function f(){outer:{log+="b";break outer;await using x=null;}log+="e";}const p=f();if(log!=="be")throw 1;p.then(()=>print("Test262:AsyncTestComplete"),error=>print("Test262:AsyncTestFailure:Error:"+String(error)));`,
    String.raw`let log="";async function f(){try{await using x={[Symbol.asyncDispose](){log+="d";throw 19;}};}catch(e){if(e!==19)throw 1;log+="c";}}const p=f();if(log!=="dc")throw 2;p.then(()=>print("Test262:AsyncTestComplete"),error=>print("Test262:AsyncTestFailure:Error:"+String(error)));`,
  ],
  { nodeReference: false, asynchronous: true },
);

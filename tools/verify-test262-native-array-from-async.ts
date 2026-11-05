import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`Array.fromAsync([Promise.resolve(19),23],async(v,i)=>v+i).then(a=>{if(a.length!==2||a[0]!==19||a[1]!==24)throw 1;}).then(()=>print("Test262:AsyncTestComplete"),e=>print("Test262:AsyncTestFailure:"+(e&&e.name?e.name:"Test262Error")+":"+String(e)));`,
    String.raw`const value=Promise.resolve(19);let i=0;const source={[Symbol.asyncIterator](){return this;},next(){return Promise.resolve(i++===0?{done:false,value}:{done:true});}};Array.fromAsync(source).then(a=>{if(a.length!==1||a[0]!==value)throw 1;}).then(()=>print("Test262:AsyncTestComplete"),e=>print("Test262:AsyncTestFailure:"+(e&&e.name?e.name:"Test262Error")+":"+String(e)));`,
    String.raw`let log="";const source={get length(){log+="L";return 2;},get 0(){log+="0";return Promise.resolve(19);},get 1(){log+="1";return 23;}};Array.fromAsync(source,(v,i)=>{log+="M";return Promise.resolve(v+i);}).then(a=>{if(a[0]!==19||a[1]!==24||log!=="L0M1M")throw 1;}).then(()=>print("Test262:AsyncTestComplete"),e=>print("Test262:AsyncTestFailure:"+(e&&e.name?e.name:"Test262Error")+":"+String(e)));`,
    String.raw`const marker={};let closed=false;const source={[Symbol.asyncIterator](){return this;},next(){return Promise.resolve({done:false,value:19});},return(){closed=true;return Promise.resolve({done:true});}};Array.fromAsync(source,()=>Promise.reject(marker)).then(()=>{throw 1;},e=>{if(e!==marker||!closed)throw 2;}).then(()=>print("Test262:AsyncTestComplete"),e=>print("Test262:AsyncTestFailure:"+(e&&e.name?e.name:"Test262Error")+":"+String(e)));`,
    String.raw`const marker={};let closed=false;const source={[Symbol.asyncIterator](){return this;},next(){throw marker;},return(){closed=true;return {done:true};}};Array.fromAsync(source).then(()=>{throw 1;},e=>{if(e!==marker||closed)throw 2;}).then(()=>print("Test262:AsyncTestComplete"),e=>print("Test262:AsyncTestFailure:"+(e&&e.name?e.name:"Test262Error")+":"+String(e)));`,
  ],
  { asynchronous: true, nodeReference: false },
);

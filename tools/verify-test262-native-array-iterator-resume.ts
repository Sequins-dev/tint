import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases([
  `const error={};let reads=0;const source={get 0(){reads++;throw error;},1:42,length:2};const iterator=Array.prototype.values.call(source);let caught;try{iterator.next();}catch(e){caught=e;}const result=iterator.next();if(caught!==error||reads!==1||result.done||result.value!==42||!iterator.next().done)throw 1;`,
  `let reads=0;const source={get length(){if(reads++===0)throw 1;return 1;},0:42};const iterator=Array.prototype.values.call(source);try{iterator.next();}catch{}const result=iterator.next();if(result.done||result.value!==42||reads!==2)throw 1;`,
  `let iterator,inside=false,inner;const source={get length(){if(!inside){inside=true;inner=iterator.next();}return 1;},0:42};iterator=Array.prototype.values.call(source);const outer=iterator.next();if(inner.done||outer.done||inner.value!==42||outer.value!==42||!iterator.next().done)throw 1;`,
  `const buffer=new ArrayBuffer(2,{maxByteLength:4}),view=new Uint8Array(buffer,0,2);view[0]=19;view[1]=42;const iterator=view.values();if(iterator.next().value!==19)throw 1;buffer.resize(0);let caught=false;try{iterator.next();}catch(e){caught=e instanceof TypeError;}buffer.resize(2);view[1]=42;const result=iterator.next();if(!caught||result.done||result.value!==42)throw 2;`,
]);

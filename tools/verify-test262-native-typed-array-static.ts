import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const a=Uint8Array.of(19,279);if(a.length!==2||a[0]!==19||a[1]!==23)throw 1;const b=BigInt64Array.of(-1n,19n);if(b[0]!==-1n||b[1]!==19n)throw 2;const c=Uint16Array.from("12");if(c[0]!==1||c[1]!==2)throw 3;`,
  `const receiver={},calls=[];const a=Uint8Array.from([19,22],function(value,index){"use strict";if(this!==receiver)throw 1;calls.push(index);return value+index;},receiver);if(a[0]!==19||a[1]!==23||calls.join()!=="0,1")throw 2;`,
  `let log="";const source={get [Symbol.iterator](){log+="g";return function(){let i=0;return {next(){log+="n";return i++===0?{done:false,value:19}:{done:true};}};};}};const result=Uint8Array.from.call(function(length){log+="a";return new Uint8Array(length);},source,(v)=>{log+="m";return v;});if(log!=="gnnam"||result[0]!==19)throw 1;`,
  `let log="";const source={get length(){log+="l";return 2;},get 0(){log+="0";return 19;},get 1(){log+="1";return 23;}};const a=Uint8Array.from.call(function(length){log+="a";return new Uint8Array(length);},source,(v)=>{log+="m";return v;});if(log!=="la0m1m"||a[1]!==23)throw 1;`,
  `let count=0;const source={get [Symbol.iterator](){count++;throw 1;}};let caught=false;try{Uint8Array.from(source,{});}catch(e){caught=e instanceof TypeError;}if(!caught||count!==0)throw 2;caught=false;try{Uint8Array.of.call(function(){return new Uint8Array(0);},19);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;`,
  `let caught=false;try{Uint8Array.from.call(function(){return {};},[1]);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;const target=new Uint8Array(3);const result=Uint8Array.of.call(function(){return target;},19);if(result!==target||target[0]!==19||target[1]!==0)throw 2;`,
]);

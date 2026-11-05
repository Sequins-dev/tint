import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const a=new Uint16Array([19,65537]);if(a.length!==2||a[0]!==19||a[1]!==1)throw 1;const b=new Uint8Array({length:2,0:19,1:279});if(b[0]!==19||b[1]!==23)throw 2;`,
  `let log="";const source={get length(){log+="l";return 2;},get 0(){log+="a";return {valueOf(){log+="c";return 19;}};},get 1(){log+="b";return 23;}};const a=new Uint8Array(source);if(log!=="lacb"||a[0]!==19||a[1]!==23)throw 1;`,
  `let log="";const source={get [Symbol.iterator](){log+="g";return function(){let i=0;return {next(){log+="n";return i++===0?{done:false,value:{valueOf(){log+="c";return 42;}}}:{done:true};}};};}};const a=new Uint8Array(source);if(log!=="gnnc"||a[0]!==42)throw 1;`,
  `const a=new Uint16Array(2);a[0]=65535;a[1]=23;Object.defineProperty(a,Symbol.iterator,{get(){throw 1;}});const b=new Uint8Array(a);if(b.length!==2||b[0]!==255||b[1]!==23||b.buffer===a.buffer)throw 2;const c=new Uint16Array(a);a[0]=1;if(c[0]!==65535)throw 3;`,
  `const a=new BigInt64Array([19n,-1n]);const b=new BigUint64Array(a);if(b[0]!==19n||b[1]!==18446744073709551615n)throw 1;let caught=false;try{new Uint8Array(a);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;`,
]);

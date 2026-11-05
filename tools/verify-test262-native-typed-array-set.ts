import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `const a=new Uint8Array([1,2,3,4]);const source=new Uint8Array(a.buffer,0,3);if(a.set(source,1)!==undefined||a[0]!==1||a[1]!==1||a[2]!==2||a[3]!==3)throw 1;`,
  `const a=new Uint8Array([1,2,3,4]);const source=new Uint8Array(a.buffer,1,3);a.set(source);if(a[0]!==2||a[1]!==3||a[2]!==4||a[3]!==4)throw 1;`,
  `const a=new Uint16Array(3);let log="";a.set({get length(){log+="l";return 2;},get 0(){log+="a";return {valueOf(){log+="c";return 19;}};},get 1(){log+="b";return 23;}},1);if(log!=="lacb"||a[0]!==0||a[1]!==19||a[2]!==23)throw 1;`,
  `const a=new BigInt64Array(2);a.set([19n,-1n]);if(a[0]!==19n||a[1]!==-1n)throw 1;let caught=false;try{a.set(new Uint8Array(0));}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;`,
  `const a=new Uint8Array(1);let count=0,caught=false;try{a.set({get length(){count++;return 2;},get 0(){throw 1;}});}catch(e){caught=e instanceof RangeError;}if(!caught||count!==1)throw 2;count=0;caught=false;try{a.set({get length(){count++;return 0;}},-1);}catch(e){caught=e instanceof RangeError;}if(!caught||count!==0)throw 3;`,
  "const b=new ArrayBuffer(8),source=new Uint8Array(b,0,4);source[0]=1;source[1]=2;source[2]=3;source[3]=4;const target=new Uint16Array(b);target.set(source);if(target[0]!==1||target[1]!==2||target[2]!==3||target[3]!==4)throw 1;",
  "const a=new Float32Array(1),view=new DataView(a.buffer);view.setUint32(0,2143294004,true);const b=new Float32Array(1);b.set(a);if(new DataView(b.buffer).getUint32(0,true)!==2143294004)throw 1;",
  "const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b);let count=0;const value={valueOf(){count++;b.resize(0);return 19;}};a.set({length:2,0:value,1:value});if(count!==2||a.length!==0)throw 1;",
]);

import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// Current ECMA-262 uses explicit ArrayIterator slots, preserving resumable state
// after abrupt completion. Only normal exhaustion permanently clears the source.
// https://tc39.es/ecma262/multipage/indexed-collections.html#sec-%arrayiteratorprototype%.next
verifyNativeScriptCases(
  [
    "const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b);a[0]=19;const it=a.values();if(it.next().value!==19)throw 1;b.resize(2);if(it.next().value!==0||!it.next().done)throw 2;b.resize(8);if(!it.next().done)throw 3;",
    "const b=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(b,0,4),it=a.values();b.resize(0);let caught=false;try{it.next();}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;b.resize(8);const result=it.next();if(result.done||result.value!==0)throw 2;",
    "let count=0;const a={get length(){count++;throw 19;}},it=Array.prototype.values.call(a);try{it.next();}catch(e){if(e!==19)throw e;}try{it.next();throw 1;}catch(e){if(e!==19)throw e;}if(count!==2)throw 2;",
    "let it,reentered=false,inner;const source={get length(){if(!reentered){reentered=true;inner=it.next();}return 1;},0:19};it=Array.prototype.values.call(source);if(it.next().value!==19||inner.value!==19||inner.done||!it.next().done)throw 1;",
    "const foreign=$262.createRealm().global;const foreignNext=Object.getPrototypeOf(new foreign.Uint8Array(0).values()).next;const own=new Uint8Array([19]).values();const first=foreignNext.call(own),second=foreignNext.call(own),third=foreignNext.call(own);if(Object.getPrototypeOf(first)!==foreign.Object.prototype||Object.getPrototypeOf(second)!==foreign.Object.prototype||Object.getPrototypeOf(third)!==foreign.Object.prototype||first.value!==19||!second.done||!third.done)throw 1;",
    "const foreign=$262.createRealm().global;const foreignNext=Object.getPrototypeOf(new foreign.Array().entries()).next;const iterator=[42].entries();const result=foreignNext.call(iterator);if(Object.getPrototypeOf(result)!==foreign.Object.prototype||Object.getPrototypeOf(result.value)!==foreign.Array.prototype||result.value[0]!==0||result.value[1]!==42)throw 1;",
  ],
  { nodeReference: false },
);

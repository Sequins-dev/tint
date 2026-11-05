import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// $262.createRealm is provided by the native test host, separately from Node.
verifyNativeScriptCases(
  [
    `const a=new Int32Array(new SharedArrayBuffer(16));Atomics.store(a,0,-1);if(Atomics.wait(a,0,4294967295,-Infinity)!=='timed-out'||Atomics.wait(a,0,1,0)!=='not-equal'||Atomics.wait(a,0,1,NaN)!=='not-equal')throw 1;`,
    `const a=new BigInt64Array(new SharedArrayBuffer(16));Atomics.store(a,0,-1n);if(Atomics.wait(a,0,18446744073709551615n,-1)!=='timed-out'||Atomics.wait(a,0,0n,Infinity)!=='not-equal')throw 1;`,
    `const a=new Int32Array(new SharedArrayBuffer(4)),x=Atomics.waitAsync(a,0,1),y=Atomics.waitAsync(a,0,0,-0);if(x===y||x.async!==false||x.value!=='not-equal'||y.async!==false||y.value!=='timed-out'||Object.getPrototypeOf(x)!==Object.prototype||String(Object.keys(x))!=='async,value')throw 1;for(const key of ['async','value']){const d=Object.getOwnPropertyDescriptor(x,key);if(!d.writable||!d.enumerable||!d.configurable)throw 2;}`,
    `const a=new Int32Array(new SharedArrayBuffer(4)),log=[];const index={valueOf(){log.push('index');return 0;}},expected={valueOf(){log.push('expected');return 19;}},timeout={valueOf(){log.push('timeout');Atomics.store(a,0,19);return 0;}};if(Atomics.wait(a,index,expected,timeout)!=='timed-out'||String(log)!=='index,expected,timeout')throw 1;`,
    `const a=new Int32Array(new SharedArrayBuffer(4)),foreign=$262.createRealm().global;Object.defineProperty(Object.prototype,'async',{set(){throw 1;},configurable:true});const result=foreign.Atomics.waitAsync(a,0,1);if(Object.getPrototypeOf(result)!==foreign.Object.prototype||result.async!==false||result.value!=='not-equal')throw 2;`,
  ],
  { nodeReference: false },
);

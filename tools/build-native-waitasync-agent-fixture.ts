import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    `var sab=new SharedArrayBuffer(4),a=new Int32Array(sab),events=[];
var result=Atomics.waitAsync(a,0,0,Infinity);
if(!result.async||!(result.value instanceof Promise))throw new Error('missing promise');
result.value.then(function(value){if(value!=="ok")throw new Error('wrong wait result');events.push('wait');});
Atomics.notify(a,0,1);
Promise.resolve().then(function(){events.push('promise');});
Promise.resolve().then(function(){if(events.join(',')!=="wait,promise")throw new Error('same-agent resolution order');print('Test262:AsyncTestComplete');});`,
    `var sab=new SharedArrayBuffer(4),a=new Int32Array(sab);
var result=Atomics.waitAsync(a,0,0,Infinity);
$262.agent.start(\`$262.agent.receiveBroadcast(function(sab){var a=new Int32Array(sab);Atomics.notify(a,0,1);$262.agent.leaving();});\`);
result.value.then(function(value){if(value!=="ok")throw new Error('external resolution');print('Test262:AsyncTestComplete');});
$262.agent.broadcast(sab,0);`,
    `var sab=new SharedArrayBuffer(4),a=new Int32Array(sab);
var result=Atomics.waitAsync(a,0,0,0.5);
result.value.then(function(value){if(value!=="timed-out")throw new Error('timeout result');if(Atomics.notify(a,0,1)!==0)throw new Error('stale waiter');print('Test262:AsyncTestComplete');});`,
    `var sab=new SharedArrayBuffer(4);
$262.agent.start(\`$262.agent.receiveBroadcast(function(sab){var a=new Int32Array(sab);var result=Atomics.waitAsync(a,0,0,10000);result.value.then(function(value){$262.agent.report(value);$262.agent.leaving();});});\`);
$262.agent.broadcast(sab,0);var a=new Int32Array(sab);
while(Atomics.notify(a,0,1)===0)$262.agent.sleep(1);
var report;while((report=$262.agent.getReport())===null)$262.agent.sleep(1);
if(report!=="ok")throw new Error('worker async wait');print('Test262:AsyncTestComplete');`,
  ],
  { nodeReference: false, asynchronous: true },
);

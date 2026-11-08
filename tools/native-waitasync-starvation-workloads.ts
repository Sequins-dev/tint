/** Bespoke liveness controls: no unchanged Test262 sources or harnesses. */
const polling = `
var started=$262.agent.monotonicNow();
function poll(){
 if(finished){print("Test262:AsyncTestComplete");return;}
 if($262.agent.monotonicNow()-started>1000)throw new Error("owner completion starved by Promise jobs");
 Promise.resolve().then(poll);
}
Promise.resolve().then(poll);`;
export const waitAsyncStarvationWorkloads = [
  `var words=new Int32Array(new SharedArrayBuffer(4)),finished=false;
Atomics.waitAsync(words,0,0,1).value.then(function(value){if(value!=="timed-out")throw new Error("timeout result");finished=true;});
${polling}`,
  `var memory=new SharedArrayBuffer(4),words=new Int32Array(memory),finished=false;
Atomics.waitAsync(words,0,0,Infinity).value.then(function(value){if(value!=="ok")throw new Error("notification result");finished=true;});
$262.agent.start("$262.agent.receiveBroadcast(function(memory){Atomics.notify(new Int32Array(memory),0,1);$262.agent.leaving();});");
$262.agent.broadcast(memory);
${polling}`,
];

/** Small agent workloads shared by resource-policy and native fixture checks. */
export const agentWaitCoercionWorkload = `
const ordinary={valueOf:function(){return false;}};
const primitive={[Symbol.toPrimitive]:function(){return false;}};
$262.agent.receiveBroadcast(function(buffer){
 const words=new BigInt64Array(buffer);
 const a=Atomics.wait(words,0,0n,false);
 const b=Atomics.wait(words,0,0n,ordinary);
 const c=Atomics.wait(words,0,0n,primitive);
 $262.agent.report(a);$262.agent.report(b);$262.agent.report(c);
 $262.agent.leaving();
});`;

export const agentTimedWaitWorkload = `
$262.agent.receiveBroadcast(function(buffer){
 const words=new BigInt64Array(buffer);
 const before=$262.agent.monotonicNow();
 const result=Atomics.wait(words,0,0n,2);
 const elapsed=$262.agent.monotonicNow()-before;
 $262.agent.report(elapsed);$262.agent.report(result);
 $262.agent.leaving();
});`;

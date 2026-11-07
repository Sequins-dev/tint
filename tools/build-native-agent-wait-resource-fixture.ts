import { verifyNativeScriptCases } from "./native-script-fixture.ts";
import {
  agentWaitCoercionWorkload,
  agentTimedWaitWorkload,
} from "./native-agent-wait-workloads.ts";

verifyNativeScriptCases(
  [
    `var memory=new SharedArrayBuffer(8);
$262.agent.start("$262.agent.receiveBroadcast(function(buffer){var a=new BigInt64Array(buffer);$262.agent.report(Atomics.wait(a,0,0n,0));$262.agent.leaving();});");
$262.agent.broadcast(memory);
var value;while((value=$262.agent.getReport())===null)$262.agent.sleep(1);
if(value!=="timed-out")throw new Error("immediate control changed");`,
    `var memory=new SharedArrayBuffer(8);
$262.agent.start(${JSON.stringify(agentWaitCoercionWorkload)});
$262.agent.broadcast(memory);
for(var i=0;i<3;i++){var value;while((value=$262.agent.getReport())===null)$262.agent.sleep(1);if(value!=="timed-out")throw new Error("timeout coercion changed");}`,
    `var memory=new SharedArrayBuffer(8);
$262.agent.start(${JSON.stringify(agentTimedWaitWorkload)});
$262.agent.broadcast(memory);
var value;while((value=$262.agent.getReport())===null)$262.agent.sleep(1);
if(Number(value)<2)throw new Error("wait expired early");
while((value=$262.agent.getReport())===null)$262.agent.sleep(1);
if(value!=="timed-out")throw new Error("timed result changed");`,
  ],
  { nodeReference: false },
);

import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NativeImageRunner,nativeDebuggerLaunch} from './node-toolchain-cluster-f-direct-launch-diagnostic-v1/tools/test262-native-process.ts';
import {startNativeHeartbeat} from './node-toolchain-cluster-f-direct-launch-diagnostic-v1/tools/test262-native-heartbeat.ts';
const image='.tint-bootstrap/smoke-cluster-f-phase2-v1/.tint-bootstrap/smoke-stage2';
const descriptor='docs/results/frozen-node-toolchain-cluster-f-direct-launch-diagnostic-v1.json';
const frozen=JSON.parse(readFileSync(descriptor,'utf8')),bytes=readFileSync(image),startedAt=new Date().toISOString();
if(nativeDebuggerLaunch!=='debugserver-direct')throw Error('Expected direct launch');
const heartbeat=startNativeHeartbeat('F known-good small smoke: direct control');
let runner,outcome;
try{
 heartbeat.phase('rewriting retained signed image to a fresh private path');runner=new NativeImageRunner(bytes,300000);
 heartbeat.phase('executing retained case0 through direct launch');
 outcome=runner.run(0,phase=>heartbeat.phase(phase));
}finally{runner?.close();await heartbeat.close();}
const report={kind:'native-launch-protocol-diagnostic',conformance:false,startedAt,completedAt:new Date().toISOString(),debuggerLaunch:nativeDebuggerLaunch,driverSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),adapterFrozenDescriptor:descriptor,adapterSourceSnapshot:frozen.sourceSnapshot,imageBuildSourceSnapshot:'5dd97f5fd5f46759faf13f9637efdb89cbb47a0df52d2e932f4dddcbb76ac26c',imageSha256:createHash('sha256').update(bytes).digest('hex'),imageBytes:bytes.length,caseIndex:0,timeoutMs:300000,scope:'Known-good small smoke image, fresh atomic executable path and current frozen direct-launch adapter. Diagnostic control only; original conformance observations remain unchanged. Completion still requires recorded initial stop and exit42.',outcome};
writeFileSync('.tint-bootstrap/cluster-f-small-smoke-direct-control-v1.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));

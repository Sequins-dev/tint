import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {executeNativeFile,nativeDebuggerLaunch} from './node-toolchain-temporal-h-v16/tools/test262-native-process.ts';
import {startNativeHeartbeat} from './node-toolchain-temporal-h-v16/tools/test262-native-heartbeat.ts';
const authorization=readFileSync('/Users/stephenbelanger/.t3/tint-briefs/load-events.md','utf8');if(authorization.lastIndexOf('HOST AUTHORIZATION RESTORED')<=authorization.lastIndexOf('HOST AUTHORIZATION STALL'))throw Error('Native execution is held pending HOST AUTHORIZATION RESTORED');
if(nativeDebuggerLaunch!=='debugserver-direct')throw Error('Direct launch required');
const [manifestPath,reportPath,portableInputToolchain]=process.argv.slice(2);
const manifest=JSON.parse(readFileSync(manifestPath,'utf8')),binary=join(dirname(manifestPath),'test');
if(createHash('sha256').update(readFileSync(binary)).digest('hex')!==manifest.imageSha256)throw Error('Fixture image hash mismatch');
const heartbeat=startNativeHeartbeat(reportPath),outcomes=[],start=Date.now();
try{for(const {index} of manifest.cases){heartbeat.phase('case '+index);const outcome=executeNativeFile(binary,300000,index,phase=>heartbeat.phase('case '+index+': '+phase));outcomes.push({index,outcome});console.log(JSON.stringify({index,outcome}));}}
finally{await heartbeat.close();writeFileSync(reportPath,JSON.stringify({kind:'native-script-fixture-observation',conformance:false,portableInputToolchain,manifest,debuggerLaunch:nativeDebuggerLaunch,initialStopAndFinalExitValidatedBy:'executeNativeFile',elapsedMs:Date.now()-start,outcomes},null,2)+'\n',{flag:'wx'});}
if(outcomes.length!==manifest.cases.length||outcomes.some(({outcome})=>outcome.kind!=='completed'))process.exitCode=1;

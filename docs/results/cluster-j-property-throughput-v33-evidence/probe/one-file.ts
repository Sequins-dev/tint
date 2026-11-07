import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareNativeScripts,createNativeBatchBuilder} from './native-profile.ts';
import {workspaceSources,workspaceSourceIdentity} from '../../tools/workspace-sources.ts';
import {testMetadata} from '../../tools/test262.ts';
import {executionPlan} from '../../tools/test262-execution.ts';
import {startNativeHeartbeat} from '../../tools/test262-native-heartbeat.ts';
const tag=process.env.J_PROFILE_TAG??'';
const root='/Users/stephenbelanger/Code/nodejs/tint/.tint-bootstrap/test262',file='built-ins/RegExp/property-escapes/generated/Changes_When_Casefolded.js',source=readFileSync(root+'/test/'+file,'utf8');
const base=executionPlan(source,'sloppy',testMetadata(source));
const diagnostic=String.raw`
var phaseBuild=buildString,phaseTest=testPropertyEscapes,phaseStart=Date.now();
buildString=function(args){var start=Date.now();var text=phaseBuild(args);print("PHASE buildString ms="+(Date.now()-start));return text;};
testPropertyEscapes=function(regExp,text,expression){var start=Date.now();var value=phaseTest(regExp,text,expression);print("PHASE testPropertyEscapes ms="+(Date.now()-start)+" expression="+expression);return value;};
print("PHASE test-start");
`;
const plan={...base,harness:[...base.harness,'phase-diagnostic.js'],source:base.source+'\nprint("PHASE test-total ms="+(Date.now()-phaseStart));'};
const harness=plan.harness.map(filename=>({filename,source:filename==='phase-diagnostic.js'?diagnostic:readFileSync(root+'/harness/'+filename,'utf8')}));
const heartbeat=startNativeHeartbeat('J one-file phase diagnostic');
try{
 const snapshot=workspaceSources();writeFileSync('.tint-bootstrap/j-property-phase-probe-v1/provenance'+tag+'.json',JSON.stringify({kind:'diagnostic-only',file,sourceSha256:createHash('sha256').update(source).digest('hex'),sourceSnapshot:workspaceSourceIdentity(snapshot),harness:harness.map(h=>({filename:h.filename,sha256:createHash('sha256').update(h.source).digest('hex')}))},null,2)+'\n',{flag:'wx'});
 heartbeat.phase('prepare unchanged source plus diagnostic markers');const start=performance.now(),cpu=process.cpuUsage();
 const prepared=prepareNativeScripts(plan,'sloppy',harness);if(!prepared.ok)throw Error(JSON.stringify(prepared));
 console.error(JSON.stringify({kind:'prepare',wallMs:performance.now()-start,cpu:process.cpuUsage(cpu)}));
 heartbeat.phase('Node-host one-file native compile with symbols');const built=createNativeBatchBuilder(snapshot)([{scripts:prepared.modules,asynchronous:false,canSuspend:true}]);
 console.error(JSON.stringify({kind:'compile-complete',wallMs:performance.now()-start,cpu:process.cpuUsage(cpu),ok:built.ok}));if(!built.ok)throw Error(JSON.stringify(built));
 const path='.tint-bootstrap/j-property-phase-probe-v1/one-file'+tag;writeFileSync(path,built.bytes,{flag:'wx',mode:0o755});console.log(JSON.stringify({path,imageSha256:createHash('sha256').update(built.bytes).digest('hex')}));
}finally{await heartbeat.close();}

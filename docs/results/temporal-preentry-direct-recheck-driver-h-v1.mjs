import{readFileSync,writeFileSync,appendFileSync,copyFileSync,constants}from'node:fs';
import{resolve,join}from'node:path';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';
import{startNativeHeartbeat}from'./node-toolchain-temporal-h-v8/tools/test262-native-heartbeat.ts';
import{readWorkspaceSourceSnapshot,workspaceSourceIdentity}from'./node-toolchain-temporal-h-v8/tools/workspace-sources.ts';
import{frozenNativeRunIdentity,sameNativeObservationInput}from'./node-toolchain-temporal-h-v8/tools/native-run-journal.ts';
import{test262Checkout,test262Source,within}from'./node-toolchain-temporal-h-v8/tools/test262-checkout.ts';
import{testMetadata,syntaxVariants}from'./node-toolchain-temporal-h-v8/tools/test262.ts';
import{executionPlan,judgeExecution,executionTotals}from'./node-toolchain-temporal-h-v8/tools/test262-execution.ts';
import{prepareNativeScripts,createNativeBatchBuilder,nativeTestResources,capturedScriptEvaluation,nativeScriptAdapter}from'./node-toolchain-temporal-h-v8/tools/test262-native.ts';
import{NativeImageRunner,nativeDebuggerLaunch,nativeDebuggerExecutable,nativeDebuggerStdio,nativeDebuggerTracing,nativeExecutableWriteback}from'./node-toolchain-temporal-h-v8/tools/test262-native-process.ts';
const driverSha256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const descriptor='docs/results/frozen-node-toolchain-temporal-h-v8.json',frozen=JSON.parse(readFileSync(descriptor)),checkout=resolve('.tint-bootstrap/test262');
const journal='docs/results/test262-temporal-preentry-recheck-direct-h-v1.jsonl',reportPath='docs/results/temporal-preentry-recheck-direct-h-v1.json';
const published=JSON.parse(readFileSync('docs/results/temporal-h-coverage-publication-v1.json')).completeReports;
const targets=new Map();for(const file of published)for(const row of JSON.parse(readFileSync(file)).observations)if(row.status==='crash')targets.set(row.path+'\0'+row.variant,{row,origin:file,originalPublishedFailure:true});
if(targets.size!==41)throw Error('Expected exactly the original 41 published failures');
for(const row of readFileSync('.tint-bootstrap/temporal-plain-time-family-h-v1-held.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(r=>r.kind==='observation'&&r.status==='crash'))if(!targets.has(row.path+'\0'+row.variant))targets.set(row.path+'\0'+row.variant,{row,origin:'test262-temporal-plain-time-family-h-v1-prefix.jsonl on feat/temporal-native-coverage',originalPublishedFailure:false});
if(targets.size!==49)throw Error('Expected 49 retained pre-entry failures');
if(nativeDebuggerLaunch!=='debugserver-direct')throw Error('Direct launch must be explicit');
const snapshot=readWorkspaceSourceSnapshot(frozen.sources),identity=workspaceSourceIdentity(snapshot),frozenSha=frozenNativeRunIdentity(pathToFileURL(frozen.entry).href,identity),suite=test262Checkout(checkout,'built-ins/Temporal');
const heartbeat=startNativeHeartbeat('49 Temporal pre-entry failures: original 41 plus 8 newly observed'),observations=[],startedAt=new Date().toISOString();let image,compilation;
const header={kind:'start',schemaVersion:2,startedAt,frozenToolchainSha256:frozenSha,nodeVersion:process.version,debuggerTracing:nativeDebuggerTracing,revision:suite.revision,dirty:suite.dirty,selection:'built-ins/Temporal',batchSize:64,sourceSnapshot:identity,sourceSnapshotFile:frozen.sources,engine:nativeScriptAdapter(capturedScriptEvaluation(snapshot),false,false,false,false),debugger:nativeDebuggerExecutable,debuggerStdio:nativeDebuggerStdio,debuggerLaunch:nativeDebuggerLaunch,executableWriteback:nativeExecutableWriteback,executionResources:nativeTestResources};
writeFileSync(journal,JSON.stringify(header)+'\n',{flag:'wx'});
const inputs=[],cases=[],prior=[];
try{
 for(const target of targets.values()){
  const old=target.row;heartbeat.phase('verifying unchanged '+old.path+' ['+old.variant+']');
  const filename=within(join(checkout,'test'),old.path),{source,sha256}=test262Source(filename),metadata=testMetadata(source);
  if(!syntaxVariants(metadata).includes(old.variant))throw Error('Variant changed');
  const plan=executionPlan(source,old.variant,metadata),harness=plan.harness.map(name=>({filename:within(join(checkout,'harness'),name),...test262Source(within(join(checkout,'harness'),name))}));
  const input={path:old.path,sha256,metadata,variant:old.variant,canSuspend:plan.canSuspend,harness:harness.map((h,i)=>({name:plan.harness[i],sha256:h.sha256}))};
  if(!sameNativeObservationInput(old,input))throw Error('Fixture identity changed: '+old.path);
  const prepared=prepareNativeScripts(plan,old.variant,harness);if(!prepared.ok)throw Error('Formerly-executed case no longer prepares: '+JSON.stringify(prepared));
  inputs.push(input);prior.push(target);cases.push({scripts:prepared.modules,asynchronous:plan.asynchronous,canSuspend:plan.canSuspend});
 }
 heartbeat.phase('compiling one batch of '+cases.length+' unchanged native variants');const start=performance.now(),built=createNativeBatchBuilder(snapshot)(cases);
 compilation={id:0,variants:cases.length,kind:'execution',compileMs:performance.now()-start,outcome:built.ok?'compiled':built.outcome.kind};appendFileSync(journal,JSON.stringify({kind:'compilation',compilation})+'\n');
 if(!built.ok)throw Error('Native batch failed: '+JSON.stringify(built.outcome));
 image=new NativeImageRunner(built.bytes,nativeTestResources.timeoutMs);
 const retained=resolve('.tint-bootstrap/temporal-preentry-direct-image-h-v1');copyFileSync(image.path,retained,constants.COPYFILE_EXCL|constants.COPYFILE_FICLONE);
 writeFileSync(retained+'.json',JSON.stringify({kind:'native-focused-image',sourceSnapshot:identity,imageSha256:createHash('sha256').update(built.bytes).digest('hex'),debuggerLaunch:nativeDebuggerLaunch,cases:inputs},null,2)+'\n',{flag:'wx'});
 for(const[index,input]of inputs.entries()){
  heartbeat.phase('executing '+input.path+' ['+input.variant+']');const start=performance.now();const outcome=image.run(index,phase=>heartbeat.phase(input.path+' ['+input.variant+']: '+phase));
  const row={...input,outcome,status:judgeExecution(input.metadata,outcome),elapsedMs:performance.now()-start,batch:0};observations.push(row);appendFileSync(journal,JSON.stringify({kind:'observation',...row})+'\n');
  heartbeat.counts({total:inputs.length,done:observations.length,pass:observations.filter(o=>o.status==='pass').length,fail:observations.filter(o=>o.status==='fail').length,unsupported:observations.filter(o=>o.status==='unsupported').length,infra:observations.filter(o=>!['pass','fail','unsupported'].includes(o.status)).length});console.log(JSON.stringify({index,path:input.path,variant:input.variant,status:row.status}));
 }
}catch(error){process.exitCode=1;console.error(error.stack??String(error));}
finally{
 image?.close();await heartbeat.close();
 const results=observations.map((o,i)=>({...o,originalPublishedFailure:prior[i].originalPublishedFailure,originalReport:prior[i].origin,originalOutcome:prior[i].row.outcome}));
 const report={kind:'native-focused-variant-recheck',conformance:false,driverSha256,scope:'All 41 published Temporal pre-entry failures, plus eight later failures from the held PlainTime run. Unchanged pinned tests and harnesses through new native output. This is a focused manifest, not a complete Temporal family; no failures are erased or combined with older passes.',startedAt,completedAt:new Date().toISOString(),revision:suite.revision,dirty:suite.dirty,toolchain:descriptor,sourceSnapshot:identity,frozenToolchainSha256:frozenSha,debuggerLaunch:nativeDebuggerLaunch,executionResources:nativeTestResources,journal,manifest:[...targets.values()].map(t=>({path:t.row.path,variant:t.row.variant,sha256:t.row.sha256,originalPublishedFailure:t.originalPublishedFailure,origin:t.origin})),compilation,totals:executionTotals(observations.map(o=>o.status)),originalPublishedTotals:executionTotals(results.filter(o=>o.originalPublishedFailure).map(o=>o.status)),results,completeManifest:observations.length===targets.size};
 writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({report:reportPath,totals:report.totals,originalPublishedTotals:report.originalPublishedTotals}));
 if(observations.length!==targets.size||observations.some(o=>o.status!=='pass'))process.exitCode=1;
}

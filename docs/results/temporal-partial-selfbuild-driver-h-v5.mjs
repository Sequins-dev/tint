import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { debugserverLaunchCommand, cleanupDebuggerSession } from './node-toolchain-temporal-h-v5/tools/native-debugger-session.ts';
import { readWorkspaceSourceSnapshot, workspaceSourceIdentity } from './node-toolchain-temporal-h-v5/tools/workspace-sources.ts';
const root=resolve('.'),binary=resolve('.tint-bootstrap/stage1-temporal-partial-h-v5'),output=resolve('.tint-bootstrap/stage2-temporal-partial-h-v5'),source=resolve('.tint-bootstrap/source-temporal-partial-h-v5');
const session=mkdtempSync('/tmp/tint-h5-'),initialPath=join(session,'initial.json'),resultPath=join(session,'result.json'),pidPath=join(session,'pid');
const snapshot=readWorkspaceSourceSnapshot(resolve('.tint-bootstrap/node-toolchain-temporal-h-v5/source-snapshot.json'));
const report={kind:'native-self-build-observation',conformance:false,frozenToolchain:'docs/results/frozen-node-toolchain-temporal-h-v5.json',sourceSnapshot:workspaceSourceIdentity(snapshot),binary,output,source,session,debuggerLaunch:'debugserver-connected',timeoutMs:10800000,checks:[]};
const started=Date.now();
let phase='verify frozen snapshot',timedOut=false,activePidPath=pidPath;
let cleaned=false;
function clean(){if(!cleaned){cleanupDebuggerSession(session);cleaned=true;}}
function status(){let pid='';try{pid=readFileSync(activePidPath,'utf8').trim();}catch{};const cpu=pid?spawnSync('ps',['-o','pid,pcpu,time,etime,state','-p',pid],{encoding:'utf8',timeout:2000}).stdout?.trim():'';console.log(new Date().toISOString(),phase,'elapsedMs='+String(Date.now()-started),cpu||'inferior not yet launched');}
const heartbeat=setInterval(status,30000);
async function command(executable,args,log,budget=10800000,cwd=undefined){const fd=openSync(log,'wx');return await new Promise((done)=>{const child=spawn(executable,args,{cwd,stdio:['ignore',fd,fd]});let finished=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},budget);child.on('error',error=>{if(finished)return;finished=true;clearTimeout(timer);closeSync(fd);done({code:null,error:String(error)});});child.on('close',(code,signal)=>{if(finished)return;finished=true;clearTimeout(timer);closeSync(fd);done({code,signal});});});}
function json(path){try{return JSON.parse(readFileSync(path,'utf8'));}catch{return null;}}
function hash(path){return createHash('sha256').update(readFileSync(path)).digest('hex');}
async function observedNative(image,args,expectedExit,tag){
 const smokeSession=mkdtempSync('/tmp/tint-h5-smoke-'),initialFile=join(smokeSession,'initial.json'),finalFile=join(smokeSession,'final.json');
 activePidPath=join(smokeSession,'pid');
 try{
 const commands=[debugserverLaunchCommand(image,smokeSession,args,300000,'connected'),
 `script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); open(${JSON.stringify(activePidPath)},'w').write(str(p.GetProcessID())); open(${JSON.stringify(initialFile)},'w').write(json.dumps({'stopped':p.GetState()==lldb.eStateStopped,'pid':p.GetProcessID()})); assert p.GetState()==lldb.eStateStopped`,
 'continue',
 `script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); s=p.GetState(); open(${JSON.stringify(finalFile)},'w').write(json.dumps({'exited':s==lldb.eStateExited,'exitStatus':p.GetExitStatus(),'stopDescription':p.GetSelectedThread().GetStopDescription(512) if s!=lldb.eStateExited else None})); p.Kill() if s!=lldb.eStateExited else None`];
 const log=join(smokeSession,tag+'.log');
 const debuggerResult=await command('/usr/bin/lldb',['--no-lldbinit','--batch',...commands.flatMap(c=>['-o',c]),image],log);
 const observation={image,args,expectedExit,session:smokeSession,debugger:debuggerResult,initial:json(initialFile),result:json(finalFile),logTail:readFileSync(log,'utf8').slice(-16000)};
 report.checks.push({command:tag,...observation});
 if(debuggerResult.code!==0||!observation.initial?.stopped||!observation.result?.exited||observation.result.exitStatus!==expectedExit)throw Error(tag+' did not establish expected initial/final states');
 }finally{cleanupDebuggerSession(smokeSession);activePidPath=undefined;}
}

try{
 if(existsSync(output))throw Error('Stage2 output already exists');
 if(existsSync(binary)||existsSync(source))throw Error('Stage1 snapshot or image already exists');
 phase='Node bootstrap of frozen stage1';status();
 const bootstrapLog=join(session,'bootstrap.log');
 report.bootstrap=await command(process.execPath,[resolve('.tint-bootstrap/node-toolchain-temporal-h-v5/tools/bootstrap-compiler.ts'),binary,'--snapshot',source,'--source-root',resolve('.tint-bootstrap/node-toolchain-temporal-h-v5'),'--debug-symbols'],bootstrapLog);
 report.bootstrapLog=bootstrapLog;report.bootstrapTail=readFileSync(bootstrapLog,'utf8').slice(-16000);
 if(report.bootstrap.code!==0)throw Error('Node bootstrap failed');
 for(const input of snapshot.inputs){if(!readFileSync(join(source,input.id)).equals(Buffer.from(input.bytes)))throw Error('Frozen input mismatch: '+input.id);}
 report.snapshotVerified=true;
 const commands=[debugserverLaunchCommand(binary,session,[source,output,'--debug-symbols'],300000,'connected'),
 `script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); open(${JSON.stringify(pidPath)},'w').write(str(p.GetProcessID())); open(${JSON.stringify(initialPath)},'w').write(json.dumps({'stopped':p.GetState()==lldb.eStateStopped,'pid':p.GetProcessID()})); assert p.GetState()==lldb.eStateStopped`,
 'continue',
 `script import json; p=lldb.debugger.GetSelectedTarget().GetProcess(); s=p.GetState(); open(${JSON.stringify(resultPath)},'w').write(json.dumps({'exited':s==lldb.eStateExited,'exitStatus':p.GetExitStatus(),'stopDescription':p.GetSelectedThread().GetStopDescription(512) if s!=lldb.eStateExited else None})); p.Kill() if s!=lldb.eStateExited else None`];
 phase='native stage1 rebuilding frozen source';status();
 const debuggerLog=join(session,'debugger.log');
 report.debugger=await command('/usr/bin/lldb',['--no-lldbinit','--batch',...commands.flatMap(c=>['-o',c]),binary],debuggerLog);
 report.initial=json(initialPath);report.result=json(resultPath);report.debuggerLog=debuggerLog;report.debuggerTail=readFileSync(debuggerLog,'utf8').slice(-16000);
 clean();
 if(report.debugger.code!==0||timedOut||!report.initial?.stopped||!report.result?.exited||report.result.exitStatus!==0)throw Error('Native self-build did not establish expected initial/final states');
 if(!existsSync(output))throw Error('Native self-build produced no stage2 image');
 report.stage1Sha256=hash(binary);report.stage2Sha256=hash(output);report.bytes=readFileSync(binary).length;report.byteIdentical=readFileSync(binary).equals(readFileSync(output));
 if(!report.byteIdentical)throw Error('Stage images differ');
 for(const image of[binary,output]){phase='verify code signature '+image;status();const checked=await command('/usr/bin/codesign',['--verify','--strict',image],join(session,'signature-'+(image===binary?'stage1':'stage2')+'.log'),300000);report.checks.push({command:'codesign --verify --strict',image,...checked});if(checked.code!==0)throw Error('Signature verification failed');}
 phase='verify DWARF (identical stage images)';status();const dwarf=await command('/usr/bin/dwarfdump',['--verify',binary],join(session,'dwarf.log'),1800000);report.checks.push({command:'dwarfdump --verify',image:binary,...dwarf});if(dwarf.code!==0)throw Error('DWARF verification failed');

 const smokeRoot=resolve('.tint-bootstrap/smoke-temporal-partial-h-v5');
 if(existsSync(smokeRoot))throw Error('Smoke directory already exists');
 mkdirSync(smokeRoot);
 phase='Node reference smoke build from frozen source';status();
 const smokeReferenceLog=join(session,'smoke-reference.log');
 const smokeReference=await command(process.execPath,[resolve('.tint-bootstrap/node-toolchain-temporal-h-v5/tools/prepare-frozen-smoke.ts'),source],smokeReferenceLog,1800000,smokeRoot);
 report.checks.push({command:'prepare-frozen-smoke',...smokeReference,logTail:readFileSync(smokeReferenceLog,'utf8').slice(-16000)});
 if(smokeReference.code!==0)throw Error('Frozen reference smoke failed');
 const smokeSource=join(smokeRoot,'.tint-bootstrap/smoke-project'),smokeNode=join(smokeRoot,'.tint-bootstrap/smoke-node'),smokeNative=join(smokeRoot,'smoke-native');
 phase='native stage2 compiling frozen smoke';status();
 await observedNative(output,[smokeSource,smokeNative,'--debug-symbols'],0,'stage2-smoke-compiler');
 const smokeEqual=readFileSync(smokeNode).equals(readFileSync(smokeNative));
 report.checks.push({command:'compare smoke images',byteIdentical:smokeEqual,nodeSha256:hash(smokeNode),nativeSha256:hash(smokeNative)});
 if(!smokeEqual)throw Error('Native and Node smoke images differ');
 phase='native smoke execution';status();
 await observedNative(smokeNative,[],42,'smoke-execution');
 report.success=true;
}catch(error){report.success=false;report.error=String(error);process.exitCode=1;}
finally{clearInterval(heartbeat);clean();report.elapsedMs=Date.now()-started;report.timedOut=timedOut;writeFileSync(resolve('docs/results/temporal-partial-selfbuild-h-v5.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({success:report.success,error:report.error,report:'docs/results/temporal-partial-selfbuild-h-v5.json'}));}

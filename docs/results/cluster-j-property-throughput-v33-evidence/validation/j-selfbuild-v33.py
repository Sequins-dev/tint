from pathlib import Path
import subprocess,os,json,datetime,time,hashlib
root=Path.cwd();frozen=root/'.tint-bootstrap/cluster-j-toolchain-v33';node=subprocess.check_output(['which','node'],text=True).strip();env={**os.environ,'TINT_TEST262_DEBUGGER_LAUNCH':'debugserver-direct','TINT_TEST262_HEARTBEAT_MS':'30000','TINT_TEST262_STALL_MS':'150000'}
stage1=root/'.tint-bootstrap/j-string-stage1-v33';stage2=root/'.tint-bootstrap/j-string-stage2-v33';snapshot=root/'.tint-bootstrap/j-string-source-v33';initialFile=root/'.tint-bootstrap/j-selfbuild-v33-initial.json';finalFile=root/'.tint-bootstrap/j-selfbuild-v33-final.json';debugdir=root/'.tint-bootstrap/j-selfbuild-v33-debugger'
assert not stage1.exists() and not stage2.exists() and not snapshot.exists() and not debugdir.exists()
def run(args,log,phase,native=False):
 print(datetime.datetime.now(datetime.timezone.utc).isoformat(),'START',phase,flush=True);started=time.monotonic()
 with log.open('xb') as out:
  p=subprocess.Popen(args,stdout=out,stderr=subprocess.STDOUT,env=env,cwd=root)
  while p.poll() is None:
   try:p.wait(timeout=30)
   except subprocess.TimeoutExpired:
    print(datetime.datetime.now(datetime.timezone.utc).isoformat(),phase,'wall',round(time.monotonic()-started),flush=True)
    print('\n'.join(log.read_text(errors='replace').splitlines()[-3:]),flush=True)
    print(subprocess.run(['ps','-p',str(p.pid),'-o','pid,ppid,etime,time,%cpu,state'],capture_output=True,text=True).stdout.strip(),flush=True)
    if native and initialFile.exists():
     try:
      pid=json.loads(initialFile.read_text())['pid'];print(subprocess.run(['ps','-p',str(pid),'-o','pid,ppid,etime,time,%cpu,state'],capture_output=True,text=True).stdout.strip(),flush=True)
     except (ValueError,KeyError):pass
 assert p.returncode==0,{'phase':phase,'status':p.returncode,'log':str(log)}
 print('EXIT0',phase,'seconds',round(time.monotonic()-started,3),flush=True);return time.monotonic()-started
bootstrapSeconds=run([node,str(frozen/'tools/bootstrap-compiler.ts'),str(stage1),'--source-root',str(frozen),'--snapshot',str(snapshot),'--debug-symbols'],root/'.tint-bootstrap/j-selfbuild-v33-bootstrap.log','Node bootstrap')
debugdir.mkdir();program="import {debugserverLaunchCommand} from './tools/native-debugger-session.ts'; console.log(JSON.stringify(debugserverLaunchCommand(process.argv[1],process.argv[2],[process.argv[3],process.argv[4],'--debug-symbols'],300000,'direct')));";launch=json.loads(subprocess.check_output([node,'--input-type=module','-e',program,str(stage1),str(debugdir),str(snapshot),str(stage2)],cwd=frozen,env=env,text=True));Path(root/'.tint-bootstrap/j-selfbuild-v33-launch-command.json').write_text(json.dumps(launch)+'\n')
expression='lldb.debugger.GetSelectedTarget().GetProcess()'
initial=f"script import json; p={expression}; open({str(initialFile)!r},'w').write(json.dumps({{'state':'stopped' if p.GetState()==lldb.eStateStopped else str(p.GetState()),'pid':p.GetProcessID()}})); open({str(debugdir/'pid')!r},'w').write(str(p.GetProcessID())); assert p.GetState()==lldb.eStateStopped and p.GetProcessID()>0"
final=f"script p={expression}; open({str(finalFile)!r},'w').write(json.dumps({{'state':'exited' if p.GetState()==lldb.eStateExited else str(p.GetState()),'exitStatus':p.GetExitStatus()}})); assert p.GetState()==lldb.eStateExited and p.GetExitStatus()==0"
try:
 nativeSeconds=run(['/usr/bin/lldb','--no-lldbinit','--batch','--one-line-on-crash','bt 25','-o','settings set target.disable-aslr false','-o',launch,'-o',initial,'-o','continue','-o',final,str(stage1)],root/'.tint-bootstrap/j-selfbuild-v33-native.log','Native stage2',True)
 a=json.loads(initialFile.read_text());b=json.loads(finalFile.read_text());assert a['state']=='stopped' and a['pid']>0 and b=={'state':'exited','exitStatus':0},(a,b)
finally:
 subprocess.run([node,'--input-type=module','-e',"import {cleanupDebuggerSession} from './tools/native-debugger-session.ts';cleanupDebuggerSession(process.argv[1]);",str(debugdir)],cwd=frozen,env=env,check=True)
print('Independent initial/final native states verified',flush=True)
subprocess.run(['cmp',str(stage1),str(stage2)],check=True)
subprocess.run(['codesign','--verify',str(stage1)],check=True);subprocess.run(['codesign','--verify',str(stage2)],check=True)
with (root/'.tint-bootstrap/j-selfbuild-v33-dwarf.log').open('xb') as out:subprocess.run(['dwarfdump','--verify',str(stage1)],stdout=out,stderr=subprocess.STDOUT,check=True)
images=[{'stage':i,'image':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for i,p in [(1,stage1),(2,stage2)]];assert images[0]['bytes']==images[1]['bytes'] and images[0]['sha256']==images[1]['sha256']
report={'kind':'cluster-j-frozen-native-selfbuild','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceSnapshot':json.loads((frozen/'source-snapshot.json').read_text())['identity'],'debuggerLaunch':'debugserver-direct','bootstrapExit':0,'bootstrapSeconds':bootstrapSeconds,'nativeExit':0,'nativeSeconds':nativeSeconds,'initial':a,'final':b,'stageComparisonExit':0,'signatureExits':[0,0],'dwarfExit':0,'images':images};(root/'.tint-bootstrap/j-selfbuild-v33-result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True);print('Frozen selfbuild, comparison, signatures and DWARF exit=0',flush=True)

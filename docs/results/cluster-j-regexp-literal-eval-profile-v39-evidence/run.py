from pathlib import Path
import json,subprocess,os,time,datetime
root=Path.cwd();out=root/'.tint-bootstrap/j-literal-eval-profile-v39';m=json.loads((out/'manifest.json').read_text());image=m['image'];directory=Path('/tmp/j-ev39-'+str(os.getpid()));directory.mkdir();env={**os.environ,'TINT_TEST262_CONTAINMENT_MS':'60000','TINT_TEST262_DEBUGGER_LAUNCH':'debugserver-direct','TINT_TEST262_HEARTBEAT_MS':'30000','TINT_TEST262_STALL_MS':'150000'}
launch=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{debugserverLaunchCommand}from'./tools/native-debugger-session.ts';console.log(JSON.stringify(debugserverLaunchCommand(process.argv[1],process.argv[2],['0'],60000,'direct')))",image,str(directory)],env=env,text=True));(out/'launch.json').write_text(json.dumps({'launch':launch,'directory':str(directory)})+'\n');initialFile=out/'initial.json';finalFile=out/'final.json';expression='lldb.debugger.GetSelectedTarget().GetProcess()'
initial=f"script import json; p={expression}; open({str(initialFile)!r},'w').write(json.dumps({{'state':'stopped' if p.GetState()==lldb.eStateStopped else str(p.GetState()),'pid':p.GetProcessID()}})); open({str(directory/'pid')!r},'w').write(str(p.GetProcessID())); assert p.GetState()==lldb.eStateStopped and p.GetProcessID()>0"
final=f"script p={expression}; open({str(finalFile)!r},'w').write(json.dumps({{'state':'exited' if p.GetState()==lldb.eStateExited else str(p.GetState()),'exitStatus':p.GetExitStatus()}})); assert p.GetState()==lldb.eStateExited and p.GetExitStatus()==42"
args=['/usr/bin/lldb','--no-lldbinit','--batch','--one-line-on-crash','bt 25','-o','settings set target.disable-aslr false','-o',launch,'-o',initial,'-o','continue','-o',final,image];start=time.monotonic();sampled=False;nativeStarted=None;sample=None
with (out/'native.log').open('xb') as log:
 p=subprocess.Popen(args,stdout=log,stderr=subprocess.STDOUT,env=env)
 try:
  while p.poll() is None:
   if time.monotonic()-start>65:raise TimeoutError('Bounded native diagnostic exceeded containment')
   if initialFile.exists():
    a=json.loads(initialFile.read_text());pid=a['pid'];nativeStarted=nativeStarted or time.monotonic();q=subprocess.run(['ps','-p',str(pid),'-o','pid=,time=,etime=,state='],capture_output=True,text=True)
    with (out/'cpu.jsonl').open('a') as f:f.write(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'process':q.stdout.strip()})+'\n')
    if not sampled and time.monotonic()-nativeStarted>.5 and q.returncode==0:
     sample=subprocess.Popen(['sample',str(pid),'1','-file',str(out/'native.sample.txt')],stdout=(out/'sample-command.log').open('xb'),stderr=subprocess.STDOUT);sampled=True
   if int((time.monotonic()-start)*10)%100==0:print(datetime.datetime.now(datetime.timezone.utc).isoformat(),'native bounded fixture',round(time.monotonic()-start,1),'s',flush=True)
   time.sleep(.1)
  if sample:sample.wait(timeout=10)
  a=json.loads(initialFile.read_text());b=json.loads(finalFile.read_text());assert a['state']=='stopped' and a['pid']>0 and b=={'state':'exited','exitStatus':42} and p.returncode==0,(a,b,p.returncode)
  result={'initial':a,'final':b,'lldbExit':p.returncode,'wallSeconds':time.monotonic()-start,'sampled':sampled,'manifest':m};(out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
 finally:
  subprocess.run(['node','--input-type=module','-e',"import{cleanupDebuggerSession}from'./tools/native-debugger-session.ts';cleanupDebuggerSession(process.argv[1]);",str(directory)],env=env,check=True)
  if p.poll() is None:p.terminate();p.wait(timeout=10)

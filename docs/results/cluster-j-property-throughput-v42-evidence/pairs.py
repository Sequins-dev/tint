from pathlib import Path
import os,json,time,datetime,subprocess,hashlib,statistics
root=Path.cwd();out=root/'.tint-bootstrap/j-property-throughput-v42';old=json.loads((root/'.tint-bootstrap/j-property-current-profile-v41/manifest.json').read_text());new=json.loads((out/'manifest.json').read_text())
oldRuntime={k:v for k,v in old['resources'].items() if k!='maxSpecializations'};newRuntime={k:v for k,v in new['resources'].items() if k!='maxSpecializations'}
assert oldRuntime==newRuntime,'runtime resources differ'
for field in ['selection','variant','sourceSha256','harness']:
 assert old[field]==new[field],field
for m in [old,new]:assert hashlib.sha256(Path(m['image']).read_bytes()).hexdigest()==m['imageSha256']
env={**os.environ,'TINT_TEST262_CONTAINMENT_MS':'60000','TINT_TEST262_DEBUGGER_LAUNCH':'debugserver-direct','TINT_TEST262_HEARTBEAT_MS':'30000','TINT_TEST262_STALL_MS':'150000'}
results=[]
for name,m in [('a1',old),('b1',new),('b2',new),('a2',old),('a3',old),('b3',new)]:
 run=out/name;run.mkdir();directory=Path('/tmp/j-pair42-'+name+'-'+str(os.getpid()));directory.mkdir();initialFile=run/'initial.json';finalFile=run/'final.json';expression='lldb.debugger.GetSelectedTarget().GetProcess()';image=m['image'];launch=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import{debugserverLaunchCommand}from'./tools/native-debugger-session.ts';console.log(JSON.stringify(debugserverLaunchCommand(process.argv[1],process.argv[2],['0'],60000,'direct')))",image,str(directory)],env=env,text=True));(run/'launch.json').write_text(json.dumps({'launch':launch,'directory':str(directory)})+'\n')
 initial=f"script import json; p={expression}; open({str(initialFile)!r},'w').write(json.dumps({{'state':'stopped' if p.GetState()==lldb.eStateStopped else str(p.GetState()),'pid':p.GetProcessID()}})); assert p.GetState()==lldb.eStateStopped and p.GetProcessID()>0"
 final=f"script p={expression}; open({str(finalFile)!r},'w').write(json.dumps({{'state':'exited' if p.GetState()==lldb.eStateExited else str(p.GetState()),'exitStatus':p.GetExitStatus()}})); assert p.GetState()==lldb.eStateExited and p.GetExitStatus()==42"
 args=['/usr/bin/lldb','--no-lldbinit','--batch','--one-line-on-crash','bt 25','-o','settings set target.disable-aslr false','-o',launch,'-o',initial,'-o','continue','-o',final,image];start=time.monotonic();heartbeat=start;cpu=0
 with (run/'native.log').open('xb') as log:
  p=subprocess.Popen(args,stdout=log,stderr=subprocess.STDOUT,env=env)
  try:
   while p.poll() is None:
    elapsed=time.monotonic()-start
    if elapsed>65:raise TimeoutError('65s outer containment')
    if initialFile.exists():
     initialState=json.loads(initialFile.read_text());pid=initialState['pid'];s=subprocess.run(['ps','-p',str(pid),'-o','time=,etime=,state='],capture_output=True,text=True)
     if s.returncode==0 and s.stdout.strip():
      fields=s.stdout.split();cpu=max(cpu,sum(float(t)*60**i for i,t in enumerate(reversed(fields[0].split(':')))))
      with (run/'cpu.jsonl').open('a') as f:f.write(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'process':s.stdout.strip()})+'\n')
    if time.monotonic()-heartbeat>=10:print(datetime.datetime.now(datetime.timezone.utc).isoformat(),name,'wall',round(elapsed,2),'cpuLowerBound',cpu,flush=True);heartbeat=time.monotonic()
    time.sleep(.05)
   a=json.loads(initialFile.read_text());b=json.loads(finalFile.read_text());assert a['state']=='stopped' and a['pid']>0 and b=={'state':'exited','exitStatus':42} and p.returncode==0,(a,b,p.returncode)
   result={'name':name,'sourceSnapshot':m['sourceSnapshot'],'imageSha256':m['imageSha256'],'initial':a,'final':b,'lldbExit':p.returncode,'wallSeconds':time.monotonic()-start,'cpuSecondsLowerBound':cpu};(run/'result.json').write_text(json.dumps(result,indent=2)+'\n');results.append(result);print(json.dumps(result),flush=True)
  except Exception as e:
   (run/'failure.json').write_text(json.dumps({'error':str(e),'wallSeconds':time.monotonic()-start,'cpuSecondsLowerBound':cpu})+'\n');raise
  finally:
   subprocess.run(['node','--input-type=module','-e',"import{cleanupDebuggerSession}from'./tools/native-debugger-session.ts';cleanupDebuggerSession(process.argv[1]);",str(directory)],env=env,check=True)
   if p.poll() is None:p.terminate();p.wait(timeout=10)
summary={'kind':'paired-unchanged-property-throughput','conformance':False,'results':results,'medians':{group:{field:statistics.median(r[field] for r in results if r['name'].startswith(group)) for field in ['wallSeconds','cpuSecondsLowerBound']} for group in ['a','b']}}
(out/'paired-result.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary),flush=True)

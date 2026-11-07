from pathlib import Path
import json,subprocess,os,signal,time,hashlib,datetime,shutil
root=Path.cwd();pause=root/'.tint-bootstrap/cluster-j-property-remaining-v35.pause';ack=Path(str(pause)+'.ack');a=json.loads(ack.read_text());assert a=={'pid':50867,'state':'between-variants'},a
processes=subprocess.check_output(['ps','-axo','pid=,ppid=,comm=,args='],text=True);rows=[line.split(None,3) for line in processes.splitlines()];p=next(row for row in rows if int(row[0])==50867);assert int(p[1])==50855 and '.tint-bootstrap/cluster-j-toolchain-v35/tools/test262-native-run.ts' in p[3],p
children=[r for r in rows if int(r[1])==50867];assert not children,children
journal=root/'.tint-bootstrap/cluster-j-property-remaining-v35.jsonl';before=journal.read_bytes();assert before.endswith(b'\n');records=[json.loads(line) for line in before.splitlines()];obs=[r for r in records if r['kind']=='observation'];assert all(r['status']=='pass' for r in obs);assert not any(r['kind']=='complete' for r in records)
out=root/'docs/results/cluster-j-property-transition-v38-evidence';out.mkdir(exist_ok=False);(out/'pause-request.txt').write_bytes(pause.read_bytes());(out/'pause-ack.json').write_bytes(ack.read_bytes());(out/'processes-at-boundary.txt').write_text('\n'.join(line for line in processes.splitlines() if int(line.split(None,1)[0]) in [50855,50867,52184])+'\n')
print('Verified acknowledgement, no child/inferior, observations',len(obs),flush=True);os.kill(50867,signal.SIGTERM)
def waitGone(pid):
 for _ in range(100):
  r=subprocess.run(['ps','-p',str(pid),'-o','stat='],capture_output=True,text=True)
  if r.returncode!=0 or not r.stdout.strip() or r.stdout.strip().startswith('Z'):return
  time.sleep(.1)
 raise RuntimeError('process remains alive '+str(pid))
waitGone(50867);assert journal.read_bytes()==before
try:
 args=subprocess.check_output(['ps','-p','52184','-o','args='],text=True).strip();assert args=='node .tint-bootstrap/j-observe-property-remaining-v35.ts',args;os.kill(52184,signal.SIGTERM);waitGone(52184)
except subprocess.CalledProcessError:pass
for source,target in [(journal,'original-journal.jsonl'),(root/'.tint-bootstrap/cluster-j-property-remaining-v35.stderr','original-stderr.log'),(root/'.tint-bootstrap/test262-cluster-j-property-remaining-native-v35.json','original-stdout.txt'),(root/'.tint-bootstrap/j-property-remaining-resources-v35.jsonl','original-resources.jsonl'),(root/'.tint-bootstrap/j-property-remaining-recheck-list-v35.json','original-rechecks.json')]:
 shutil.copyfile(source,out/target)
journal.chmod(0o444);(root/'.tint-bootstrap/cluster-j-property-remaining-v35.stderr').chmod(0o444)
r={'kind':'verified-native-boundary-stop','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'authorizedBy':'User explicitly approved safe transition to current-main merged reset, property cache and call-facts improvements','pid':50867,'ack':a,'childrenAtBoundary':[],'inferiorAlive':False,'signal':'SIGTERM to Node host only after acknowledgement','originalProcessGone':True,'observerStopped':52184,'originalObserved':len(obs),'originalTotals':{'total':len(obs),'passed':len(obs),'failed':0,'unsupported':0,'timeouts':0,'harnessErrors':0,'crashes':0},'originalSelectionComplete':False,'originalRequested':836,'journalUnchangedAcrossStop':True,'originalJournalSha256':hashlib.sha256(before).hexdigest(),'originalSourceSnapshot':records[0]['sourceSnapshot'],'originalFrozenToolchainSha256':records[0].get('frozenToolchainSha256'),'originalJournalReadOnly':True,'originalResumedOnChangedGraph':False,'discardedCompiledBatch':next((x for x in reversed(records) if x['kind']=='compilation'),None)}
(out/'boundary-stop.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r),flush=True)

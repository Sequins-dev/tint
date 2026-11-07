from pathlib import Path
import json,subprocess,signal,time,hashlib,shutil,datetime,os
root=Path.cwd();stem='.tint-bootstrap/cluster-j-property-remaining-v38';pause=root/(stem+'.pause');ack=Path(str(pause)+'.ack');a=json.loads(ack.read_text());assert a=={'pid':27481,'state':'between-variants'}
rows=[line.split(None,3) for line in subprocess.check_output(['ps','-axo','pid=,ppid=,comm=,args='],text=True).splitlines()];host=next(x for x in rows if x[0]=='27481');assert host[1]=='27467' and host[3].startswith('node .tint-bootstrap/cluster-j-toolchain-v38/tools/test262-native-run.ts');assert not [x for x in rows if x[1]=='27481'];j=root/(stem+'.jsonl');before=j.read_bytes();records=[json.loads(x) for x in before.splitlines()];assert not [x for x in records if x['kind']=='observation'];assert records[0]['executionResources']['timeoutMs']==60000
out=root/'docs/results/cluster-j-property-budget-correction-v38-r1-evidence';out.mkdir();(out/'pause-ack.json').write_bytes(ack.read_bytes());(out/'pause-request.txt').write_bytes(pause.read_bytes());owned=[x for x in rows if x[0] in ['27481','27467'] or x[3]=='node .tint-bootstrap/j-observe-property-remaining-v38.ts'];(out/'processes-at-boundary.json').write_text(json.dumps(owned,indent=2)+'\n')
os.kill(27481,signal.SIGTERM)
for _ in range(50):
 p=subprocess.run(['ps','-p','27481','-o','state='],capture_output=True,text=True)
 if p.returncode or not p.stdout.strip() or p.stdout.strip().startswith('Z'):break
 time.sleep(.1)
else:raise RuntimeError('Host remains')
assert j.read_bytes()==before
for x in owned:
 if x[3]=='node .tint-bootstrap/j-observe-property-remaining-v38.ts':os.kill(int(x[0]),signal.SIGTERM)
for suffix,target in [('.jsonl','initial-journal.jsonl'),('.stderr','initial-stderr.log')]:p=root/(stem+suffix);shutil.copyfile(p,out/target);p.chmod(0o444)
shutil.copyfile(root/'.tint-bootstrap/test262-cluster-j-property-remaining-native-v38.json',out/'initial-stdout.txt')
r={'kind':'verified-budget-correction-boundary','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cause':'Launch command omitted TINT_TEST262_CONTAINMENT_MS; runner default60000 found by inspecting immutable header before first execution.','ack':a,'noChildOrInferior':True,'observedVariants':0,'noNativeVariantExecuted':True,'hostStoppedAfterAck':True,'journalUnchanged':True,'journalReadOnly':True,'journalSha256':hashlib.sha256(before).hexdigest(),'oldBudgetMs':60000,'replacementBudgetMs':300000,'sameFrozenGraph':True,'sameManifest':True,'oldGraphReport':'docs/results/cluster-j-property-toolchain-transition-v38.json','replacementJournal':'.tint-bootstrap/cluster-j-property-remaining-v38-r1.jsonl','wrapperExpectedExit':143};(out/'boundary.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))

# usage: eval24-counters.py <out.tsv> <reps> label=image ... : alternating load-matched runs of
# cases 0 (eval) and 1 (Function) per image under LLDB direct debugserver launch, with
# proc_pid_rusage V4 instructions/cycles of the inferior (docs/results/a1-perf-rusage-poll-v1.py).
import sys,subprocess,json,os,tempfile,time,ctypes,struct,shutil
W='/Users/stephenbelanger/.t3/worktrees/tint/j-numfmt'
out,reps=sys.argv[1],int(sys.argv[2]);images=[a.split('=',1) for a in sys.argv[3:]]
lib=ctypes.CDLL('/usr/lib/libSystem.B.dylib')
node=shutil.which('node')
def launch_cmd(image,d,case):
    prog="import {debugserverLaunchCommand} from './tools/native-debugger-session.ts'; console.log(JSON.stringify(debugserverLaunchCommand(process.argv[1],process.argv[2],[process.argv[3]],300000,'direct')));"
    return json.loads(subprocess.check_output([node,'--input-type=module','-e',prog,image,d,str(case)],cwd=W,text=True))
def run(image,case):
    d=tempfile.mkdtemp(prefix='j-eval24-');pidf=os.path.join(d,'pid');res=os.path.join(d,'res.json')
    expr='lldb.debugger.GetSelectedTarget().GetProcess()'
    save=f"script p={expr}; open({pidf!r},'w').write(str(p.GetProcessID())); assert p.GetState()==lldb.eStateStopped"
    fin=f"script import json; p={expr}; open({res!r},'w').write(json.dumps({{'state':str(p.GetState()),'exit':p.GetExitStatus()}}))"
    t0=time.monotonic()
    p=subprocess.Popen(['/usr/bin/lldb','--no-lldbinit','--batch','-o','settings set target.disable-aslr false','-o',launch_cmd(image,d,case),'-o',save,'-o','continue','-o',fin,image],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    pid=None
    while pid is None and p.poll() is None:
        try: pid=int(open(pidf).read().strip())
        except Exception: time.sleep(0.01)
    buf=ctypes.create_string_buffer(512);last=None;n=0
    while pid is not None and lib.proc_pid_rusage(pid,4,ctypes.byref(buf))==0:
        user,system=struct.unpack_from('QQ',buf.raw,16);ins,cyc=struct.unpack_from('QQ',buf.raw,248)
        last=(user+system,ins,cyc);n+=1;time.sleep(0.01)
    p.wait();wall=time.monotonic()-t0
    r=json.load(open(res));shutil.rmtree(d,ignore_errors=True)
    return r['exit'],wall,last,n
with open(out,'a') as f:
    f.write('rep\tlabel\tcase\texit\twall_s\tinferior_cpu_ns_raw\tsamples\tinstructions\tcycles\n')
    for rep in range(1,reps+1):
        order=images if rep%2 else images[::-1]
        for case in (0,1):
            for label,image in order:
                e,wall,last,n=run(image,case)
                f.write(f'{rep}\t{label}\t{case}\t{e}\t{wall:.3f}\t{last[0]}\t{n}\t{last[1]}\t{last[2]}\n');f.flush()
                print(rep,label,case,e,round(wall,1),last[1],flush=True)

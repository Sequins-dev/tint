import ctypes,struct,subprocess,time,json,sys,os
lib=ctypes.CDLL('/usr/lib/libSystem.B.dylib'); buf=ctypes.create_string_buffer(512)
root=int(sys.argv[1]); out=sys.argv[2]; last={}
def ancestors(pid):
    seen=[]
    for _ in range(8):
        r=subprocess.run(['ps','-o','ppid=','-p',str(pid)],capture_output=True,text=True).stdout.strip()
        if not r: break
        pid=int(r); seen.append(pid)
    return seen
known={}
while True:
    try: os.kill(root,0)
    except OSError: break
    for line in subprocess.run(['pgrep','-fl','tint-test262-image-.*/test [0-9]+$'],capture_output=True,text=True).stdout.split('\n'):
        if not line.strip(): continue
        pid,cmd=line.split(' ',1); pid=int(pid)
        if pid not in known: known[pid]= root in ancestors(pid)
        if not known[pid]: continue
        if lib.proc_pid_rusage(pid,4,ctypes.byref(buf))==0:
            user,system=struct.unpack_from('QQ',buf.raw,16); ins,cyc=struct.unpack_from('QQ',buf.raw,248)
            last[str(pid)]={'case':cmd.strip().split()[-1],'instructions':ins,'cycles':cyc,'user_ns':user}
    json.dump(last,open(out,'w')); time.sleep(0.01)

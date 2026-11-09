import ctypes,struct,sys,time,json
# usage: rusage-poll.py <pidfile> <out.json>: poll proc_pid_rusage V4 every 10 ms until the pid is gone; keep the last sample.
lib=ctypes.CDLL('/usr/lib/libSystem.B.dylib')
pidfile,out=sys.argv[1],sys.argv[2]
pid=None
for _ in range(3000):
    try: pid=int(open(pidfile).read().strip()); break
    except Exception: time.sleep(0.05)
buf=ctypes.create_string_buffer(512); last=None; first=None
while True:
    if lib.proc_pid_rusage(pid,4,ctypes.byref(buf))!=0: break
    user,system=struct.unpack_from('QQ',buf.raw,16); ins,cyc=struct.unpack_from('QQ',buf.raw,248)
    last={'user':user,'system':system,'instructions':ins,'cycles':cyc}
    if first is None: first=last
    time.sleep(0.01)
json.dump({'pid':pid,'first':first,'last':last},open(out,'w'))

import ctypes,json,struct,time
from pathlib import Path
lib=ctypes.CDLL('/usr/lib/libproc.dylib')
class Timebase(ctypes.Structure):_fields_=[('numer',ctypes.c_uint32),('denom',ctypes.c_uint32)]
base=Timebase();assert ctypes.CDLL('/usr/lib/libSystem.B.dylib').mach_timebase_info(ctypes.byref(base))==0
last=None;last_at=time.monotonic_ns();probes=0
while True:
 b=ctypes.create_string_buffer(1024);now=time.monotonic_ns();status=lib.proc_pid_rusage(56058,0,ctypes.byref(b));probes+=1
 if status!=0:break
 user,system=struct.unpack_from('QQ',b.raw,16);last={'userTicks':user,'systemTicks':system};last_at=now
 if probes%300==1:print(json.dumps({'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'cpuSecondsLowerBound':(user+system)*base.numer/base.denom/1e9}),flush=True)
 time.sleep(0.1)
assert last is not None
result={'pid':56058,'timebase':{'numer':base.numer,'denom':base.denom},'lastCPU':last,'cpuMsLowerBound':(last['userTicks']+last['systemTicks'])*base.numer/base.denom/1e6,'finalUnobservedWallBoundMs':(now-last_at)/1e6,'probes':probes,'scope':'Total inferior process CPU since launch, including loader work. Final unobserved wall bounds missing CPU; the observer does not affect native execution or debugger state.'}
Path('.tint-bootstrap/perf/selfbuild-codegen-copy-v1/cpu-finish-v2.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)

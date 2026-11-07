from pathlib import Path
import subprocess,os,hashlib
p=Path('packages/ts-native/dist/runtime/index.js');q=Path('packages/compiler/dist/native/index.js');a=p.read_bytes();b=q.read_bytes();old=b'return { ok: false, error: result.error.message };';assert a.count(old)==1
old2=b'if (!prepared.ok)\n        return failure("runtime", prepared.error);';assert b.count(old2)==1
try:
 p.write_bytes(a.replace(old,b'return { ok: false, error: JSON.stringify(result.error) };'))
 q.write_bytes(b.replace(old2,b'if (!prepared.ok) { const detail=JSON.parse(prepared.error); return failure("runtime",JSON.stringify({detail,location:locateSource(linked.value,detail)})); }'))
 env={**os.environ,'TINT_BUILD_ONLY':'1','TINT_KEEP_NATIVE':'1','TINT_DEBUG_SYMBOLS':'1','TINT_TEST262_DEBUGGER_LAUNCH':'debugserver-direct','TINT_TEST262_HEARTBEAT_MS':'30000','TINT_TEST262_STALL_MS':'150000'}
 with open('.tint-bootstrap/j-collator-native-api-runtime-diagnostic-v2.log','xb')as out:r=subprocess.run(['node','tools/verify-hosted-intl-collator.ts'],env=env,stdout=out,stderr=subprocess.STDOUT)
 print('Diagnostic build exit',r.returncode)
finally:
 p.write_bytes(a);q.write_bytes(b);assert p.read_bytes()==a and q.read_bytes()==b;print('Restored exact compiled tools',hashlib.sha256(a).hexdigest(),hashlib.sha256(b).hexdigest())

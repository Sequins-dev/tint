from pathlib import Path
import subprocess,os,hashlib
p=Path('packages/ts-native/dist/runtime/index.js');original=p.read_bytes();old=b'return { ok: false, error: result.error.message };';assert original.count(old)==1
try:
 p.write_bytes(original.replace(old,b'return { ok: false, error: JSON.stringify(result.error) };'))
 env={**os.environ,'TINT_BUILD_ONLY':'1','TINT_KEEP_NATIVE':'1','TINT_DEBUG_SYMBOLS':'1','TINT_TEST262_DEBUGGER_LAUNCH':'debugserver-direct','TINT_TEST262_HEARTBEAT_MS':'30000','TINT_TEST262_STALL_MS':'150000'}
 with open('.tint-bootstrap/j-collator-native-api-runtime-diagnostic.log','xb')as out:
  r=subprocess.run(['node','tools/verify-hosted-intl-collator.ts'],env=env,stdout=out,stderr=subprocess.STDOUT)
 print('Diagnostic build exit',r.returncode)
finally:
 p.write_bytes(original);assert p.read_bytes()==original;print('Restored exact compiled tool bytes',hashlib.sha256(original).hexdigest())

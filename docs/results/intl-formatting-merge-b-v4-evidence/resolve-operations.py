p='packages/js-runtime/src/objects/operations.ts'
s=open(p).read()
old='''<<<<<<< HEAD
import type { ShadowRealmHost } from "./shadow-realm.ts";
=======
import type { DateTimeFormatter } from "./date-time-service-contracts.ts";
>>>>>>> park/intl-formatting-service-h
'''
assert s.count(old)==1 and s.count('<<<<<<<')==1, "unexpected operations.ts conflict"
s=s.replace(old,'import type { ShadowRealmHost } from "./shadow-realm.ts";\nimport type { DateTimeFormatter } from "./date-time-service-contracts.ts";\n')
open(p,'w').write(s)

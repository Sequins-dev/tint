import re,sys
p='tools/script-runtime-surface.test.ts'
s=open(p).read()
def bump(pattern, delta, optional=False):
    global s
    m=re.findall(pattern,s,flags=re.M)
    if optional and not m: return  # main derives this count from the census
    assert len(m)>=1,(pattern)
    s=re.sub(pattern,lambda m:m.group(1)+str(int(m.group(2))+delta)+m.group(3),s,flags=re.M)
bump(r'(assert\.equal\(census\.value\.anchors\.length, )(\d+)(\);)',8)
bump(r'(assert\.equal\(census\.value\.collections\.length, )(\d+)(\);)',3)
m=re.search(r'^(\s+)\[(\d+), 2, 6\],$',s,flags=re.M); assert m
s=s[:m.start()]+m.group(1)+'[%d, 2, 6],'%(int(m.group(2))+3)+s[m.end():]
bump(r'(assert\.equal\(facts\.value\.runtimes\.length, )(\d+)(\);)',3)
bump(r'(assert\.equal\(collectionNames\.length, )(\d+)(\);)',8,True)
bump(r'(assert\.equal\(names\.value\.providers\.length, )(\d+)(\);)',3)
bump(r'(assert\.equal\(names\.value\.targets\.length, )(\d+)(\);)',24)
bump(r'(assert\.equal\(exported\.value\.slots\.length, )(\d+)(\);)',24)
bump(r'(assert\.equal\(exported\.value\.stubs\.declarations\.length, )(\d+)(\);)',24)
bump(r'(assert\.equal\(collectionOperations\.length, )(\d+)(\);)',8,True)
bump(r'(new Set\(collectionOperations\.map\(\(names\) => JSON\.stringify\(names\)\)\)\.size,\n\s+)(\d+)(,)',3)
bump(r'(assert\.equal\(new Set\(collectionOperations\.flat\(\)\)\.size, )(\d+)(\);)',24)
# the three bare operation-count literals (collection ops, runtime ops, targets/slots echoes)
bare=re.findall(r'^(\s+)(\d{3}),$',s,flags=re.M)
assert len(bare)==4,bare
s=re.sub(r'^(\s+)(\d{3}),$',lambda m:m.group(1)+str(int(m.group(2))+24)+',',s,flags=re.M)
old='  // Agent caller reflection reuses one depth-indexed callee slot list.\n'
assert s.count(old)==1
i=s.index(old)+len(old)
# keep any following explanatory comment lines from main, then append H's
while s[i:].startswith('  //'):
    i=s.index('\n',i)+1
s=s[:i]+'''  // DateTimeFormat adds five aliases for its readonly pattern-token list class
  // and eight operations through the formatter slot on OrdinaryObject.
  // Temporal format caches add one optional-pattern list alias/provider.
  // Unit profiles add one readonly-string list alias using an existing provider.
  // DurationFormat adds one unit-options list class with eight operations.
'''+s[i:]
open(p,'w').write(s)

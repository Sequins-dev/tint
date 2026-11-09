import re,sys,collections
# Block-local stack-slot forwarding opportunities in otool -tV text.
# A load [sp,#k] is forwardable if, since the last store to [sp,#k] from register R in the same
# straight-line run (no label, branch, call, or ret), neither R nor the slot was written.
mem=re.compile(r'^(x\d+|w\d+|d\d+|xzr), \[sp, #(0x[0-9a-f]+|\d+)\]$')
def dests(op,args):
    a=args.split(', ')
    if op in('str','stp','stur','strb','strh','cmp','tst','b','cbz','cbnz','tbz','tbnz','ret','fcmp'): return []
    if op=='ldp': return a[:2]
    return a[:1]
c=collections.Counter(); avail={}  # slot -> reg
for line in open(sys.argv[1]):
    p=line.rstrip('\n').split('\t')
    if not (len(p)>=2 and re.match(r'^[0-9a-f]{16}$',p[0])): avail.clear(); continue
    op=p[1]; args=p[2] if len(p)>2 else ''
    c['instructions']+=1
    if op in('b','bl','blr','br','ret','cbz','cbnz','tbz','tbnz','brk') or op.startswith('b.'):
        avail.clear(); continue
    m=mem.match(args)
    if op=='str' and m:
        avail[m.group(2)]=m.group(1); continue
    if op=='ldr' and m:
        r=avail.get(m.group(2))
        if r is not None and r[0]==m.group(1)[0] and r!='xzr':
            c['forwardable loads']+=1
            if r==m.group(1): c['  same register (deletable)']+=1
        # destination register now holds slot value too
        for s,reg in list(avail.items()):
            if reg==m.group(1) and s!=m.group(2): del avail[s]
        if r is None: avail[m.group(2)]=m.group(1)
        continue
    if op in('stp',) or (op.startswith('st') and '[sp' in args and not m):
        avail.clear(); continue  # conservative for other stores to sp
    if '[sp' in args and op.startswith('st'): avail.clear(); continue
    for d in dests(op,args):
        for s,reg in list(avail.items()):
            if reg==d or reg[1:]==d[1:] and reg[0] in 'xw' and d[0] in 'xw': del avail[s]
for k,v in c.items(): print(f"{v:10d} {k}")

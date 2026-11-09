import json,re,collections,bisect,sys
import xml.etree.ElementTree as ET
# Dynamic instruction-class profile: classify each sampled leaf PC using otool text of the image.
text={}
for line in open('stage1-text.txt'):
    p=line.rstrip('\n').split('\t')
    if len(p)>=2 and re.match(r'^[0-9a-f]{16}$',p[0]): text[int(p[0],16)]=(p[1],p[2] if len(p)>2 else '')
root=ET.parse(sys.argv[1]).getroot(); frames={}; bts={}; leafs=collections.Counter()
for row in root.iter('row'):
    bt=row.find('tagged-backtrace')
    if bt is None: continue
    if 'ref' in bt.attrib: leaf=bts.get(bt.attrib['ref'])
    else:
        fs=bt.findall('frame'); leaf=None
        for j,f in enumerate(fs):
            a=frames.get(f.attrib['ref']) if 'ref' in f.attrib else f.attrib.get('addr')
            if 'id' in f.attrib: frames[f.attrib['id']]=a
            if j==0: leaf=a
        bts[bt.attrib.get('id')]=leaf
    if leaf: leafs[int(leaf,16)-1]+=1
tot=sum(leafs.values()); cls=collections.Counter()
for pc,v in leafs.items():
    op,a=text.get(pc,('?',''))
    if op=='?': cls['outside image text']+=v; continue
    if op in('str','stp','stur') and ('xzr' in a.split('[')[0]) and '[sp' in a: k='zero store to frame (root clear)'
    elif op in('ldr','ldp','ldur') and '[sp' in a: k='frame load'
    elif op in('str','stp','stur') and '[sp' in a: k='frame store'
    elif op in('ldr','ldrb','ldrh','ldp','ldur','ldrsw'): k='heap/other load'
    elif op.startswith('st'): k='heap/other store'
    elif op in ('b','bl','blr','br','ret','cbz','cbnz','tbz','tbnz') or op.startswith('b.'): k='branch/call'
    elif op in ('fmov',): k='fmov (int<->fp transfer)'
    elif op in ('adr','adrp'): k='address materialization'
    elif op in ('cmp','fcmp','tst','ccmp'): k='compare'
    else: k='alu/other'
    cls[k]+=v
for k,v in cls.most_common(): print(f"{100*v/tot:6.2f}% {v:7d} {k}")

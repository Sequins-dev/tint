// Extract every fully observed whole file from an immutable prefix of G's property-escape journal.
// Never launches or controls native work. Usage: node docs/results/g-property-harvest-v1.mjs <minimumObservations>
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const minimum=Number(process.argv[2]??1);
const hash=b=>createHash('sha256').update(b).digest('hex'),load=p=>JSON.parse(readFileSync(p,'utf8'));
const metadata=load('docs/results/frozen-node-toolchain-g-regexp-property-v1.json'),manifest=load('docs/results/g-regexp-property-variants-v1.json');
const expectedPerFile=new Map();for(const e of manifest)expectedPerFile.set(e.path,(expectedPerFile.get(e.path)??0)+1);
const journal='docs/results/test262-g-regexp-property-native-v1.jsonl',raw=readFileSync(journal),bytes=raw.subarray(0,raw.lastIndexOf(10)+1),rows=bytes.toString().trimEnd().split('\n').map(JSON.parse),header=rows[0];assert.equal(header.kind,'start');
const obs=rows.filter(r=>r.kind==='observation');assert.ok(obs.length>=minimum);const groups=new Map();for(const r of obs){const g=groups.get(r.path)??[];g.push(r);groups.set(r.path,g);}
// Files J published are excluded by construction (disjoint manifest); assert no G output collides with a J report name.
const jReports=new Set(readdirSync('docs/results').filter(n=>n.startsWith('test262-cluster-j-property-')));
let prefix;const reports=[];
for(const [path,group] of groups){const expected=expectedPerFile.get(path);assert.ok(expected!==undefined,path);if(group.length!==expected)continue;assert.equal(new Set(group.map(r=>r.variant)).size,expected);
 const stem=path.slice('built-ins/RegExp/property-escapes/'.length).replaceAll('/','-').replace(/\.js$/,''),output=`docs/results/test262-g-property-${stem}-native-v1.json`;if(existsSync(output))continue;
 if(prefix===undefined){prefix=`docs/results/g-regexp-property-prefix-${obs.length}-v1.jsonl`;if(existsSync(prefix))assert.ok(readFileSync(prefix).equals(bytes),'immutable prefix collision');else writeFileSync(prefix,bytes,{flag:'wx'});}
 const temp=`.tint-bootstrap/g-property-extract-${stem}.json`,r=spawnSync(process.execPath,[metadata.toolchain.directory+'/tools/test262-native-extract.ts','/Users/stephenbelanger/Code/nodejs/tint/.tint-bootstrap/test262',prefix,path,temp],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const report=load(temp);assert.deepEqual(report.sourceSnapshot,header.sourceSnapshot);assert.equal(report.frozenToolchainSha256,header.frozenToolchainSha256);assert.equal(report.totals.total,expected);
 writeFileSync(output,readFileSync(temp),{flag:'wx'});reports.push({selection:path,report:output,sha256:hash(readFileSync(output)),totals:report.totals});
}
const totals={total:0,passed:0,failed:0,unsupported:0,timeouts:0,harnessErrors:0,crashes:0};for(const r of reports)for(const k of Object.keys(totals))totals[k]+=r.totals[k];
if(reports.length){const out=`docs/results/g-regexp-property-complete-files-${obs.length}-v1.json`;writeFileSync(out,JSON.stringify({kind:'g-complete-property-file-slice',conformance:false,at:new Date().toISOString(),parentJournal:journal,parentRequestedVariants:manifest.length,parentObserved:obs.length,parentComplete:rows.at(-1).kind==='complete',prefix,prefixSha256:hash(bytes),sourceSnapshot:header.sourceSnapshot,frozenToolchainSha256:header.frozenToolchainSha256,newCompleteFiles:reports.length,totals,reports,note:'Whole files from one immutable append-only prefix; J-handed half, disjoint from J-published files. Checkpoints overlap the eventual parent; not additive.'},null,2)+'\n',{flag:'wx'});console.log(out);}
console.log(JSON.stringify({observed:obs.length,newReports:reports.length,totals}));

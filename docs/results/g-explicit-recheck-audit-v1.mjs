// Read-only audit of a finished explicit-variant native recheck. Usage:
// node docs/results/g-explicit-recheck-audit-v1.mjs <frozen-metadata> <root> <manifest> <stem> <journal> <canonical-report> <audit-out>
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [metadataPath,root,manifestPath,stem,journal,canonical,auditOut]=process.argv.slice(2);assert.ok(auditOut);
const load=p=>JSON.parse(readFileSync(p,'utf8')),hash=b=>createHash('sha256').update(b).digest('hex'),metadata=load(metadataPath),directory=dirname(metadata.toolchain.entry);
const get=m=>import(pathToFileURL(resolve(directory,m+'.ts')).href);
const [{test262Checkout,test262Source,within},{testMetadata},{executionPlan},{nativeVariantSelection},{nativeSelectionObservations},{frozenNativeRunIdentity}]=await Promise.all(['test262-checkout','test262','test262-execution','native-variant-selection','native-selection-observations','native-run-journal'].map(get));
const ownerExit=existsSync(stem+'.exit')?Number(readFileSync(stem+'.exit','utf8').trim()):null;if(ownerExit!==null)assert.equal(ownerExit,0);
const bytes=readFileSync(journal);assert.equal(bytes.at(-1),10);const rows=bytes.toString().trimEnd().split('\n').map(JSON.parse);assert.equal(rows[0].kind,'start');assert.equal(rows.at(-1).kind,'complete');assert.equal(rows.filter(r=>r.kind==='complete').length,1);
const observations=rows.filter(r=>r.kind==='observation').map(({kind,...x})=>x),byKey=new Map(observations.map(x=>[x.path+'\0'+x.variant,x]));assert.equal(byKey.size,observations.length);
const suite=test262Checkout('/Users/stephenbelanger/Code/nodejs/tint/.tint-bootstrap/test262',root);assert.equal(suite.revision,'91c70759363c46557b694792bf34a2551a7af5ba');assert.equal(suite.dirty,false);
const manifest=load(manifestPath),selected=nativeVariantSelection(suite.files.map(f=>({...f,sha256:test262Source(f.filename).sha256,metadata:testMetadata(test262Source(f.filename).source)})),root,manifest);assert.equal(selected.totalVariants,manifest.length);for(const [k,v] of Object.entries(selected.subset))assert.deepEqual(rows[0][k],v);
const expected=selected.files.flatMap(file=>file.variants.map(variant=>{const source=test262Source(file.filename),prepared=executionPlan(source.source,variant,file.metadata),prior=byKey.get(file.path+'\0'+variant);assert.ok(prior);
 const sibling=n=>within(dirname(file.filename),n);for(const f of prior.fixtures??[])assert.equal(hash(readFileSync(sibling(f.name))),f.sha256);for(const n of prior.absent??[])assert.ok(!existsSync(sibling(n)));
 return {path:file.path,sha256:source.sha256,metadata:file.metadata,variant,canSuspend:prepared.canSuspend,...(prior.fixtures===undefined?{}:{fixtures:prior.fixtures}),...(prior.absent===undefined?{}:{absent:prior.absent}),harness:prepared.harness.map(name=>({name,sha256:test262Source(within(resolve(suite.root,'harness'),name)).sha256}))};}));
assert.equal(nativeSelectionObservations(observations,expected).length,manifest.length);
const reportBytes=readFileSync(stem+'.stdout.json'),report=JSON.parse(reportBytes);assert.equal(report.complete,true);assert.deepEqual(report.observations,observations);assert.deepEqual(report.totals,rows.at(-1).totals);assert.deepEqual(report.sourceSnapshot,metadata.sourceSnapshot);assert.equal(report.engine.debuggerStartupTimeoutMs,300000);assert.equal(report.engine.debuggerLaunch,'debugserver-direct');
const identity=frozenNativeRunIdentity(pathToFileURL(metadata.toolchain.entry).href,report.sourceSnapshot);assert.equal(identity,metadata.runIdentity);assert.equal(identity,report.frozenToolchainSha256);
if(existsSync(canonical))assert.ok(readFileSync(canonical).equals(reportBytes));else writeFileSync(canonical,reportBytes,{flag:'wx'});
const audit={kind:'native-explicit-recheck-audit',conformance:false,completedAt:new Date().toISOString(),rootSelection:root,manifest:manifestPath,manifestSha256:hash(readFileSync(manifestPath)),subset:selected.subset,requestedVariants:manifest.length,ownerExitStatus:ownerExit,journal,journalSha256:hash(bytes),report:canonical,reportSha256:hash(reportBytes),totals:report.totals,containmentMs:300000,frozenToolchain:metadataPath,frozenRunIdentity:identity,sourceSnapshot:report.sourceSnapshot,sourceHarnessFixtureIdentitiesVerified:true,observationJudgementsVerified:true,outcomes:observations.map(({path,variant,status})=>({path,variant,status})),note:'Single explicit recheck; earlier observations stay in their original immutable reports.'};
writeFileSync(auditOut,JSON.stringify(audit,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({totals:report.totals}));

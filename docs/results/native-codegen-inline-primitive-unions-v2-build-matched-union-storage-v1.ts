import{readFileSync}from'node:fs';
const mode=process.argv[2],root='/Users/stephenbelanger/.t3/worktrees/tint/t3-0e68a211/.tint-bootstrap/perf/',frozen=mode==='before'?'codegen-copy-toolchain-v1':'codegen-inline-union-toolchain-v5';
process.chdir(root+'codegen-inline-union-toolchain-v5');
const{verifyHostedFixture}=await import(root+frozen+'/tools/hosted-fixture.ts');
const text=readFileSync('/var/folders/60/fkw4vxts4p1g7rvpdh06k19r0000gn/T/tint-hosted-union-storage-boxed-V5W4oL/union-storage-boxed.source.ts','utf8');
verifyHostedFixture(text,'union-storage-matched-'+mode);

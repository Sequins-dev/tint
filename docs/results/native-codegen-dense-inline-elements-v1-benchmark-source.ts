const root =
  "/Users/stephenbelanger/.t3/worktrees/tint/t3-0e68a211/.tint-bootstrap/perf/codegen-dense-production-toolchain-v9";
process.chdir(root);
const { verifyHostedFixture } = await import(root + "/tools/hosted-fixture.ts");
verifyHostedFixture(
  `export function run():number{const items:(number|string)[]=[];for(let n=0;n<1025;n++)items.push(n);items[100]='text';const tail=items.pop();if(tail!==1024)return 1;let sum=0;for(let n=0;n<3000000;n++){const item=items[n%1024];if(typeof item==='number')sum+=item;else if(item!=='text')return 2;}return sum===1534094360?42:3;}`,
  "general-array",
);

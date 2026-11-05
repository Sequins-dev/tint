import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const inputs = ["America/New_York", "Australia/Lord_Howe", "Pacific/Apia"].map(
  (name) => ({
    name,
    bytes: new Uint8Array(readFileSync("/usr/share/zoneinfo/" + name)),
  }),
);
console.log(
  JSON.stringify({
    kind: "tzif-zone-native-build",
    sourceSnapshot: workspaceSourceIdentity(workspaceSources()),
    fixtures: inputs.map(({ name, bytes }) => ({
      name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })),
  }),
);
const placeholderBlock = new Uint8Array(54);
placeholderBlock.set([84, 90, 105, 102, 50]);
const placeholderView = new DataView(placeholderBlock.buffer);
placeholderView.setUint32(36, 1);
placeholderView.setUint32(40, 4);
placeholderBlock.set([45, 48, 48, 0], 50);
const footer = new TextEncoder().encode("\n<-00>0\n"),
  placeholder = new Uint8Array(108 + footer.length);
placeholder.set(placeholderBlock);
placeholder.set(placeholderBlock, 54);
placeholder.set(footer, 108);
const bridge = new Uint8Array(123),
  bridgeView = new DataView(bridge.buffer);
bridge.set(placeholderBlock);
bridge.set([84, 90, 105, 102, 50], 54);
bridgeView.setUint32(86, 1);
bridgeView.setUint32(90, 1);
bridgeView.setUint32(94, 4);
bridge.set([45, 48, 48, 0], 113);
bridge.set(new TextEncoder().encode("\nUTC0\n"), 117);
const checks = [
  `if(tzifOffsetSecondsAt(zone,1710053999)!==-18000||tzifOffsetSecondsAt(zone,1710054000)!==-14400||tzifOffsetSecondsAt(zone,2540246400)!==-14400)return 10;
  const overlap=resolveTzifLocalSeconds(zone,1730597400);if(!overlap.ok||overlap.epochSeconds!==1730611800)return 11;
  const later=resolveTzifLocalSeconds(zone,1730597400,"later");if(!later.ok||later.epochSeconds!==1730615400)return 12;
  const gap=resolveTzifLocalSeconds(zone,1710037800);if(!gap.ok||gap.epochSeconds!==1710055800)return 13;
  const earlier=resolveTzifLocalSeconds(zone,1710037800,"earlier");if(!earlier.ok||earlier.epochSeconds!==1710052200)return 14;
  const rejected=resolveTzifLocalSeconds(zone,1710037800,"reject");if(rejected.ok||rejected.error!=="ambiguous")return 15;
  const future=resolveTzifLocalSeconds(zone,2530751400);if(!future.ok||future.epochSeconds!==2530769400)return 16;
  const analysis=analyzeTzifLocalSeconds(zone,1710037800);
  if(!analysis.ok||analysis.candidates.length!==0||analysis.gap===undefined||analysis.gap.transitionEpochSeconds!==1710054000)return 17;
  const fold=analyzeTzifLocalSeconds(zone,1730597400);
  if(!fold.ok||fold.candidates.length!==2||fold.candidates[0]!==1730611800||fold.candidates[1]!==1730615400)return 18;
  const boundary=analyzeTzifLocalSeconds(zone,100000001*86400+86399);
  if(!boundary.ok||boundary.candidates.length!==1)return 19;`,
  `const gap=resolveTzifLocalSeconds(zone,1728180900);if(!gap.ok||gap.epochSeconds!==1728143100)return 20;`,
  `const gap=resolveTzifLocalSeconds(zone,1325246400);if(!gap.ok||gap.epochSeconds!==1325282400)return 30;`,
];
verifyHostedFixture(
  `import {createTzifZone,tzifOffsetSecondsAt,findTzifTransition,resolveTzifLocalSeconds,analyzeTzifLocalSeconds} from "tzif";
${inputs
  .map(
    ({ bytes }, index) => `function case${index}():number {
 const bytes=new Uint8Array([${[...bytes].join(",")}]);
 const read=createTzifZone(bytes);if(!read.ok)return 1;const zone=read.value;
 ${checks[index]}
 return 42;
}`,
  )
  .join("\n")}
function policies():number {
 const bytes=new Uint8Array([${[...placeholder].join(",")}]);
 const strict=createTzifZone(bytes),stored=createTzifZone(bytes,"stored");
 if(!strict.ok||!stored.ok)return 40;
 if(tzifOffsetSecondsAt(strict.value,0)!==undefined||tzifOffsetSecondsAt(stored.value,0)!==0)return 41;
 const transition=findTzifTransition(strict.value,{epochSeconds:0,direction:"next",inclusive:false,minimum:-100,maximum:100});
 if(transition.ok||transition.error!=="unavailable")return 43;
 const bridge=createTzifZone(new Uint8Array([${[...bridge].join(",")} ]));
 if(!bridge.ok||tzifOffsetSecondsAt(bridge.value,-1)!==undefined||tzifOffsetSecondsAt(bridge.value,0)!==0)return 44;
 return 42;
}
export function run():number {const policy=policies();if(policy!==42)return policy;const one=case0();if(one!==42)return one;const two=case1();if(two!==42)return two;return case2();}
`,
  "tzif-zone",
  [["tzif", "packages/foundation/src/chrono/tzif/index.ts"]],
);

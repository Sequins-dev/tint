import { verifyHostedFixture } from "./hosted-fixture.ts";
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("cpu pause fixture requires TINT_BUILD_ONLY=1");
const module = "packages/native-runtime/src/intrinsics/spin-hint.ts";
verifyHostedFixture(
  `import {cpuPause} from 'spin';
export function run():number { for(let i=0;i<3;i++)cpuPause();return 42; }
`,
  "cpu-pause-v1",
  [["spin", module]],
  [],
  [],
  [{ module, namespace: "cpu-pause-fixture", retainedExports: ["cpuPause"] }],
  {
    managedBytes: 4194304,
    allocationCapacity: 65536,
    hostBindings: [{ module, name: "cpuPause", operation: "cpu-pause" }],
  },
);

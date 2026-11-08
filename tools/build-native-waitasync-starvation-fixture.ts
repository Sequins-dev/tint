import { verifyNativeScriptCases } from "./native-script-fixture.ts";
import { waitAsyncStarvationWorkloads } from "./native-waitasync-starvation-workloads.ts";
verifyNativeScriptCases(waitAsyncStarvationWorkloads, {
  nodeReference: false,
  asynchronous: true,
});

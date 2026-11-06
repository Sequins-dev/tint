import { startNativeHeartbeat } from "./test262-native-heartbeat.ts";
import { verifyNativeScriptCases } from "./native-script-fixture.ts";
import { promiseKeyedCases } from "../packages/js-engine/test/promise-keyed-cases.ts";
// Node 24 does not implement the Await Dictionary proposal. Expected behavior
// comes from https://tc39.es/proposal-await-dictionary/, not a Node comparison.
// Raw Scripts do not load doneprintHandle.js; adapt completion explicitly.
const heartbeat = startNativeHeartbeat("bespoke Promise keyed fixture");
heartbeat.counts({
  total: promiseKeyedCases.length,
  done: 0,
  pass: 0,
  fail: 0,
  unsupported: 0,
  infra: 0,
});
try {
  heartbeat.phase("compiling keyed Promise fixture");
  verifyNativeScriptCases(
    promiseKeyedCases.map(
      (c) =>
        `function $DONE(error){if(error!==undefined)print("Test262:AsyncTestFailure:Error:"+String(error));else print("Test262:AsyncTestComplete");}` +
        c.source,
    ),
    {
      nodeReference: false,
      asynchronous: true,
    },
  );
} finally {
  await heartbeat.close();
}

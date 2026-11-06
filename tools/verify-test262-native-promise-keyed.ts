import { verifyNativeScriptCases } from "./native-script-fixture.ts";
import { promiseKeyedCases } from "../packages/js-engine/test/promise-keyed-cases.ts";
// Node 24 does not implement the Await Dictionary proposal. Expected behavior
// comes from https://tc39.es/proposal-await-dictionary/, not a Node comparison.
// Raw Scripts do not load doneprintHandle.js; adapt completion explicitly.
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

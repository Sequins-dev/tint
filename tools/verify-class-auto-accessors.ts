import { verifyNativeScriptCases } from "./native-script-fixture.ts";
import { classAutoAccessorCases } from "../packages/js-engine/test/class-auto-accessor-cases.ts";

verifyNativeScriptCases(
  classAutoAccessorCases.map(([, source]) => source),
  {
    nodeReference: false,
  },
);

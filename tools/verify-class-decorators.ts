import { verifyNativeScriptCases } from "./native-script-fixture.ts";
import { classDecoratorCases } from "../packages/js-engine/test/class-decorator-cases.ts";

verifyNativeScriptCases(
  classDecoratorCases.map(([, source]) => source),
  {
    nodeReference: false,
  },
);

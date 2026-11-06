import {
  directEvalAnnexCases,
  directEvalAnnexPrelude,
} from "../packages/js-engine/test/direct-eval-annex-cases.ts";
import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// Native execution of the sloppy direct-eval Annex B copy cases (B.3.2.3 copy
// into the caller VariableEnvironment, B.3.4 catch exemption). Bespoke
// regression evidence, not a Test262 conformance measurement.
verifyNativeScriptCases(
  directEvalAnnexCases.map(([, source]) => directEvalAnnexPrelude + source),
);

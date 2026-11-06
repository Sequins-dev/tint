import {
  directEvalClosureCases,
  directEvalClosurePrelude,
} from "../packages/js-engine/test/direct-eval-closure-cases.ts";
import { Script } from "node:vm";
import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// Native execution of functions created by sloppy direct eval code (the shapes
// of annexB/language/eval-code/direct *-skip-early-err-* variants). Bespoke
// regression evidence, not a Test262 conformance measurement.
// Node references every case except documented V8 deviations from the
// specification, which must still disagree with Node.
const sources = directEvalClosureCases.map(([, source, exemptions]) => {
  const text = directEvalClosurePrelude + source;
  let nodeCompleted = true;
  try {
    new Script(text).runInNewContext();
  } catch {
    nodeCompleted = false;
  }
  if (nodeCompleted !== (exemptions?.nodeDeviation === undefined))
    throw new Error("Node reference disagrees with the recorded case policy");
  return text;
});
verifyNativeScriptCases(sources, { nodeReference: false });

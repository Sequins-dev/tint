import { verifyNativeScriptCases } from "./native-script-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("build-only failure containment fixture");

// The managed Script compiler emits over 600 KiB for this small input, above
// the unchanged 256 KiB entry budget. Catching that host failure in a child
// realm must not let the worker report successful completion.
const cases = ["0", "var x=0;" + "x=x+1;".repeat(64)].map((body) => {
  const worker =
    "var child=$262.createRealm();try{child.evalScript(" +
    JSON.stringify(body) +
    ");}catch(error){}$262.agent.leaving();";
  return "$262.agent.start(" + JSON.stringify(worker) + ");";
});
verifyNativeScriptCases(cases, { nodeReference: false });

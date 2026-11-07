import { verifyNativeScriptCases } from "./native-script-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("build-only failure containment fixture");

// The managed Script compiler emits over 2 MiB for this bounded input, above
// the uniform 2 MiB entry budget. Catching that host failure in a child
// realm must not let the worker report successful completion.
const cases = ["0", "var x=0;" + "x=x+1;".repeat(256)].map((body) => {
  const worker =
    "var child=$262.createRealm();try{child.evalScript(" +
    JSON.stringify(body) +
    ");}catch(error){}$262.agent.leaving();";
  return "$262.agent.start(" + JSON.stringify(worker) + ");";
});
verifyNativeScriptCases(cases, { nodeReference: false });

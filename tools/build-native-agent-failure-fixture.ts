import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// The first three cases must fail at the host boundary; the final case must pass.
// Build-only retains them for the LLDB observation driver, including each source.
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("build-only failure containment fixture");
verifyNativeScriptCases(
  [
    `$262.agent.start("throw new Error('worker failed');");`,
    `$262.agent.start("Promise.resolve().then(function(){throw new Error('late worker failure');});$262.agent.leaving();");`,
    `$262.agent.start(\`var realm=$262.createRealm();try{realm.evalScript('"'+'x'.repeat(300000)+'"');}catch(error){}$262.agent.leaving();\`);`,
    `$262.agent.start("Promise.reject('handled').catch(function(){});$262.agent.leaving();");`,
  ],
  { nodeReference: false },
);

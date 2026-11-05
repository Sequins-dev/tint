import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`if(typeof f!=="function"||f()!==42)throw 1;one:two:function f(){return 42;}if(f.name!=="f"||!f.toString().startsWith("function f"))throw 2;`,
    String.raw`function outer(f){if(typeof f!=="function"||arguments[0]!==f||f()!==43)throw 1;one:two:function f(){return 43;}return f;}if(outer(1)()!==43)throw 2;`,
    String.raw`const saved=f;one:function f(){return "first";}two:three:function f(){f=7;return "second";}if(saved()!=="second"||f!==7)throw 1;`,
  ],
  { nodeReference: true },
);

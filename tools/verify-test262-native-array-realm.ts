import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const other=$262.createRealm().global;const a=new other.Array();let caught=false;try{a.length=4294967296;}catch(e){caught=e instanceof RangeError&&!(e instanceof other.RangeError);}if(!caught)throw 1;caught=false;try{other.Object.defineProperty(a,"length",{value:4294967296});}catch(e){caught=e instanceof other.RangeError&&!(e instanceof RangeError);}if(!caught)throw 2;`,
  ],
  { nodeReference: false },
);

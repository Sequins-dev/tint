import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const blank=new Temporal.Duration(),d=new Temporal.Duration(0,0,0,0,0,5);for(const relativeTo of ["-271821-04-19","-271821-04-19T01:00"]){if(blank.total({unit:"minute",relativeTo})!==0)throw 1;let ok=false;try{d.total({unit:"minute",relativeTo});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;}`,
    String.raw`const blank=new Temporal.Duration(),d=new Temporal.Duration(0,0,0,0,0,5);for(const relativeTo of ["+275760-09-13T00:00Z[UTC]","+275760-09-13T01:00+01:00[+01:00]"]){if(blank.total({unit:"minute",relativeTo})!==0)throw 1;let ok=false;try{d.total({unit:"minute",relativeTo});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;}`,
  ],
  { nodeReference: false },
);

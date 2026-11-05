import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`for(const t of [-8640000000000000,-62198755200000,-1,0,1,951782400000,8640000000000000]){const d=new Date(t);if(Date.parse(d.toISOString())!==t||new Date(d.toISOString()).getTime()!==t)throw 1;if(t%1000===0&&Date.parse(d.toUTCString())!==t)throw 2;}`,
    String.raw`if(Date.parse("1970")!==0||Date.parse("1970-01")!==0||Date.parse("1970-01-01")!==0||Date.parse("1970-01-01T01:00+01:00")!==0||Date.parse("1969-12-31T24:00:00.000Z")!==0)throw 1;for(const s of ["-000000-01-01T00:00Z","2000-00-01","2000-01-00","2000-13-01","2000-01-32","2000-01-01T24:01Z","2000-01-01T00:00+24:00"]){if(!Number.isNaN(Date.parse(s)))throw 2;}`,
    String.raw`let log="";const x={toString(){log+="s";return "1970-01-01T00:00Z";},valueOf(){throw 1;}};if(Date.parse(x)!==0||log!=="s")throw 2;let caught=false;try{Date.parse(Symbol());}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;`,
  ],
  { nodeReference: false },
);

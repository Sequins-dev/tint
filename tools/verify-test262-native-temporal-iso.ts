import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`for(const text of ["20000502","2000-05-02T12:34:56.123456789+02:30","2000-05-02 12:34[Asia/Kolkata][u-ca=iso8601]","2000-05-02[!UTC][!u-ca=iso8601]","2000-05-02[foo=bar]","2000-05-02[u-ca=iso8601][u-ca=discord]"]){if(Temporal.PlainDate.from(text).toString()!=="2000-05-02")throw 1;}if(Temporal.PlainDate.from("2016-12-31T23:59:60").toString()!=="2016-12-31")throw 2;for(const calendar of ["2020-01-01","2020-01-01[u-ca=iso8601]","2020-01-01T00:00","01-01","2020-01","2016-12-31T23:59:60"]){if(Temporal.PlainDate.from({year:1976,monthCode:"M11",day:18,calendar}).toString()!=="1976-11-18")throw 3;}`,
    String.raw`for(const text of ["2000-02-30","2000-05-02Z","2000-05-02T12:34Z","2000-05-02T24:00","2000-05-02T12:34:56.1234567890","2000-05-02[!foo=bar]","2000-05-02[u-ca=iso8601][!u-ca=iso8601]","2000-05-02[UTC][UTC]","2000-05-02T12:34−02:00"]){let caught=false;try{Temporal.PlainDate.from(text);}catch(e){caught=e instanceof RangeError;}if(!caught)throw 1;}`,
    String.raw`let log="";const marker={};const bad={day:1,monthCode:"M1",get year(){log+="y";throw marker;}};let caught=false;try{Temporal.PlainDate.from(bad,{get overflow(){log+="o";throw marker;}});}catch(e){caught=e instanceof RangeError;}if(!caught||log!=="")throw 1;caught=false;try{Temporal.PlainDate.from({day:1,monthCode:"M99L"},{get overflow(){log+="o";return "reject";}});}catch(e){caught=e instanceof TypeError;}if(!caught||log!=="o")throw 2;log="";caught=false;try{Temporal.PlainDate.from({day:1,year:2021,monthCode:"M00L"},{get overflow(){log+="o";return "reject";}});}catch(e){caught=e instanceof RangeError;}if(!caught||log!=="o")throw 3;`,
  ],
  { nodeReference: false },
);

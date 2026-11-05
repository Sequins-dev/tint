import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`for(const text of ["-999999-10-01","-999999-10-01[u-ca=iso8601]","+999999-10-01","+999999-10-01[u-ca=ISO8601]"]){if(Temporal.PlainMonthDay.from(text).toString({calendarName:"always"})!=="1972-10-01[u-ca=iso8601]")throw 1;}for(const text of ["1976-11[u-ca=hebrew]","1976-11[u-ca=gregory]"]){let ok=false;try{Temporal.PlainYearMonth.from(text);}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;}for(const text of ["02-29[u-ca=chinese]","02-29[u-ca=hebrew]"]){let ok=false;try{Temporal.PlainMonthDay.from(text);}catch(e){ok=e instanceof RangeError;}if(!ok)throw 3;}`,
    String.raw`let read=false,ok=false;try{Temporal.PlainMonthDay.from("+999999-10-01[u-ca=gregory]",{get overflow(){read=true;return "reject";}});}catch(e){ok=e instanceof RangeError;}if(!ok||!read)throw 1;read=false;ok=false;try{Temporal.PlainMonthDay.from("+999999-10-01[u-ca=unknown]",{get overflow(){read=true;return "reject";}});}catch(e){ok=e instanceof RangeError;}if(!ok||read)throw 2;read=false;ok=false;try{Temporal.PlainYearMonth.from("1976-11[u-ca=hebrew]",{get overflow(){read=true;return "reject";}});}catch(e){ok=e instanceof RangeError;}if(!ok||read)throw 3;`,
  ],
  { nodeReference: false },
);

import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Temporal.PlainDateTime(2020,2,29,23,59,59,999,999,999);if(d.toString({smallestUnit:"second",roundingMode:"ceil"})!=="2020-03-01T00:00:00"||d.toString({fractionalSecondDigits:6,calendarName:"critical"})!=="2020-02-29T23:59:59.999999[!u-ca=iso8601]"||d.toString({smallestUnit:"minute"})!=="2020-02-29T23:59")throw 1;if(d.toLocaleString()!==d.toJSON())throw 2;`,
    String.raw`let log="";new Temporal.PlainDateTime(2020,1,1).toString({get calendarName(){log+="c;";return "auto";},get fractionalSecondDigits(){log+="f;";return 3;},get roundingMode(){log+="r;";return "trunc";},get smallestUnit(){log+="s;";return undefined;},get timeZone(){throw 1;}});if(log!=="c;f;r;s;")throw 2;for(const d of [new Temporal.PlainDateTime(-271821,4,19,0,0,0,1),new Temporal.PlainDateTime(275760,9,13,23,59,59,999)]){let ok=false;try{d.toString({smallestUnit:"second",roundingMode:d.year<0?"floor":"ceil"});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 3;}`,
    String.raw`const d=new Temporal.PlainDateTime(2020,1,2,12,34);if(d.withPlainTime().toString()!=="2020-01-02T00:00:00"||d.withPlainTime("23:59:59.123456789").toString()!=="2020-01-02T23:59:59.123456789")throw 1;class D extends Temporal.PlainDateTime{}if(new D(2020,1,1).withPlainTime({hour:2}) instanceof D)throw 2;let ok=false;try{new Temporal.PlainDateTime(-271821,4,19,0,0,0,1).withPlainTime();}catch(e){ok=e instanceof RangeError;}if(!ok)throw 3;`,
  ],
  { nodeReference: false },
);

import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=Temporal.ZonedDateTime.from("1970-01-01T00:00:00.123456789[+05:30]");if(a.toString({fractionalSecondDigits:3})!=="1970-01-01T00:00:00.123+05:30[+05:30]"||a.toString({smallestUnit:"second",offset:"never",timeZoneName:"never",calendarName:"critical"})!=="1970-01-01T00:00:00[!u-ca=iso8601]"||a.toString({smallestUnit:"minute",timeZoneName:"critical"})!=="1970-01-01T00:00+05:30[!+05:30]")throw 1;`,
    String.raw`const a=new Temporal.ZonedDateTime(-1n,"UTC");if(a.toString({fractionalSecondDigits:0})!=="1969-12-31T23:59:59+00:00[UTC]"||a.toString({smallestUnit:"second",roundingMode:"ceil"})!=="1970-01-01T00:00:00+00:00[UTC]")throw 1;let log="";a.toString({get calendarName(){log+="c";return "auto";},get fractionalSecondDigits(){log+="f";return "auto";},get offset(){log+="o";return "auto";},get roundingMode(){log+="r";return "trunc";},get smallestUnit(){log+="s";return "second";},get timeZoneName(){log+="z";return "auto";}});if(log!=="cforsz")throw 2;`,
    String.raw`const a=new Temporal.ZonedDateTime(1n,"UTC");if(a.toJSON({get calendarName(){throw 1;}})!=="1970-01-01T00:00:00.000000001+00:00[UTC]")throw 2;let log="";let ok=false;try{a.toString({smallestUnit:"hour",get timeZoneName(){log+="z";return "auto";}});}catch(e){ok=e instanceof RangeError;}if(!ok||log!=="z")throw 3;`,
  ],
  { nodeReference: false },
);

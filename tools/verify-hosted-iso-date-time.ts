import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {parseISODateTime} from "iso";
export function run():number {
 const parsed=parseISODateTime("2000-05-02T12:34:56.123456789+02:30[Asia/Kolkata][u-ca=iso8601]");
 const v=parsed.value;
 if(parsed.error!=="none"||v===undefined)return 1;
 if(v.date.year!==2000||v.date.month!==5||v.date.day!==2||v.hour!==12||v.minute!==34||v.second!==56||v.nanosecond!==123456789)return 2;
 if(v.offsetNanoseconds!==9000000000000||v.calendar!=="iso8601"||v.timeZone!=="Asia/Kolkata"||v.utc)return 3;
 const leap=parseISODateTime("2016-12-31T23:59:60").value;
 if(leap===undefined||leap.second!==59)return 4;
 for(const text of ["2000-02-30","2000-05-02Z","2000-05-02T24:00","2000-05-02T12:34:56.1234567890","2000-05-02[!foo=bar]","2000-05-02[u-ca=iso8601][!u-ca=iso8601]"]){
  if(text===undefined)return 5;
  if(parseISODateTime(text).error!=="invalid")return 6;
 }
 return 42;
}`,
  "iso-date-time",
  [["iso", "packages/foundation/src/chrono/iso-date-time/index.ts"]],
);

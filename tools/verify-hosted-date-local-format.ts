import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {dateLocalCalendarText,dateLocalClockText} from "format";
import {parseDateText} from "parse";
export function run():number {
 for(const time of [-8640000000000000,-62198755200000,-1000,0,1000,8640000000000000]){
  if(time===undefined)return 1;
  for(const seconds of [-90000,-57368,-17762,-1,0,1,19800,29040,50400,90000]){
   if(seconds===undefined)return 2;
   const local=time+seconds*1000;
   const clock=dateLocalClockText(local,seconds*1000);
   if(clock===undefined)return 3;
   const text=dateLocalCalendarText(local)+" "+clock;
   if(parseDateText(text).value!==time)return 4;
  }
 }
 if(dateLocalClockText(-17762000,-17762000)!=="19:03:58 GMT-0456 (UTC-04:56:02)")return 5;
 if(dateLocalClockText(90000000,90000000)!=="01:00:00 GMT+0100 (UTC+25:00:00)")return 6;
 return 42;
}`,
  "date-local-format",
  [
    ["format", "packages/js-runtime/src/objects/date-format.ts"],
    ["parse", "packages/js-runtime/src/objects/date-parse.ts"],
  ],
);

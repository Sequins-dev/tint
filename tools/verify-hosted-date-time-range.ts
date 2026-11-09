import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createDateTimePartsFormatter,type DateTimeDisplayFields} from "parts";
import {resolveDateTimeSkeleton} from "skeleton";
import {dateTimeRangeParts,type DateTimeRangePart} from "range";
function text(parts:readonly DateTimeRangePart[]):string {let value="";for(let index=0;index<parts.length;index++){const item:DateTimeRangePart|undefined=parts[index];if(item===undefined)return "INVALID";value+=item.value;}return value;}
function source(parts:readonly DateTimeRangePart[],type:string):string|undefined {for(let index=0;index<parts.length;index++){const item:DateTimeRangePart|undefined=parts[index];if(item===undefined)return undefined;if(item.type===type)return item.source;}return undefined;}
export function run():number {
 const formatter=createDateTimePartsFormatter("en","gregory",undefined);if(formatter===undefined)return 1;
 const first:DateTimeDisplayFields={date:{year:2019,month:1,day:3},hour:13,minute:5,second:9,millisecond:700},last:DateTimeDisplayFields={date:{year:2019,month:1,day:5},hour:14,minute:6,second:9,millisecond:710};
 const date=resolveDateTimeSkeleton(formatter.calendar,"yMMMd",".");if(date===undefined)return 2;
 const one=dateTimeRangeParts(formatter,date,first,last,undefined,undefined);if(one===undefined||text(one)!=="Jan 3 – 5, 2019"||source(one,"month")!=="shared"||source(one,"day")!=="startRange"||source(one,"year")!=="shared")return 3;
 const reverse=dateTimeRangeParts(formatter,date,last,first,undefined,undefined);if(reverse===undefined||text(reverse)!=="Jan 5 – 3, 2019")return 4;
 const both=resolveDateTimeSkeleton(formatter.calendar,"yMMMdHm",".");if(both===undefined)return 5;
 const timeEnd:DateTimeDisplayFields={date:{year:2019,month:1,day:3},hour:14,minute:6,second:9,millisecond:710};
 const combined=dateTimeRangeParts(formatter,both,first,timeEnd,undefined,undefined);if(combined===undefined||text(combined)!=="Jan 3, 2019, 13:05 – 14:06"||source(combined,"day")!=="shared")return 6;
 const fraction=resolveDateTimeSkeleton(formatter.calendar,"yMMMdmsSS",".");if(fraction===undefined)return 7;
 const precise=dateTimeRangeParts(formatter,fraction,first,{date:{year:2019,month:1,day:3},hour:13,minute:5,second:9,millisecond:710},undefined,undefined);if(precise===undefined||text(precise)!=="Jan 3, 2019, 05:09.70 – 05:09.71"||source(precise,"year")!=="shared")return 8;
 const point=dateTimeRangeParts(formatter,date,first,first,undefined,undefined);if(point===undefined||text(point)!=="Jan 3, 2019"||source(point,"day")!=="shared")return 9;
 const time=resolveDateTimeSkeleton(formatter.calendar,"H",".");if(time===undefined)return 10;
 const dates=dateTimeRangeParts(formatter,time,first,{date:{year:2019,month:1,day:5},hour:13,minute:5,second:9,millisecond:700},undefined,undefined);if(dates===undefined||text(dates)!=="13 – 13")return 11;
 return 42;
}`,
  "date-time-range",
  [
    ["parts", "packages/js-runtime/src/objects/date-time-parts.ts"],
    ["skeleton", "packages/js-runtime/src/objects/date-time-skeleton.ts"],
    ["range", "packages/js-runtime/src/objects/date-time-range.ts"],
  ],
  [],
  [],
  [],
  {
    managedBytes: 268435456,
    allocationCapacity: 8388608,
    stackBytes: 16777216,
    rootCapacity: 16384,
  },
);

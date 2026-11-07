import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createDateTimeCalendarProfile,dateTimeCalendarValue,dateTimeCalendarEntries} from "calendarData";
export function run():number {
 const en=createDateTimeCalendarProfile("en-US-u-ca-buddhist","buddhist");
 if(en===undefined||en.locale!=="en-US"||dateTimeCalendarValue(en,"months","format.wide.1")!=="January")return 1;
 const ja=createDateTimeCalendarProfile("ja","japanese");
 if(ja===undefined||dateTimeCalendarValue(ja,"eras","wide.236")!=="令和")return 2;
 const zh=createDateTimeCalendarProfile("zh","chinese");
 if(zh===undefined||dateTimeCalendarValue(zh,"cyclicYears","wide.1")!=="甲子"||dateTimeCalendarValue(zh,"leapMonths","format.wide")!=="闰{0}")return 3;
 const he=createDateTimeCalendarProfile("en","hebrew");
 if(he===undefined||dateTimeCalendarValue(he,"months","format.wide.7leap")!=="Adar II")return 4;
 const short=createDateTimeCalendarProfile("en","gregory");
 if(short===undefined||dateTimeCalendarValue(short,"styles","A.short")!=="{1}, {0}"||dateTimeCalendarEntries(short,"patterns").length<20)return 5;
 if(createDateTimeCalendarProfile("zz-ZZ","gregory")!==undefined||createDateTimeCalendarProfile("en","unknown")!==undefined)return 6;
 return 42;
}`,
  "date-time-calendar",
  [["calendarData", "packages/js-runtime/src/objects/date-time-calendar.ts"]],
);

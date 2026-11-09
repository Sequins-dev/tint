import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {parseDateTimePattern,dateTimePatternFields,basicDateTimeFormatScore,selectBasicDateTimeFormat,splitDateTimeIntervalPattern,type DateTimePatternFormat} from "pattern";
export function run():number {
 const source=parseDateTimePattern("yyyy-MM-dd 'at' HH:mm 'o''clock'");if(source===undefined||source.length!==10)return 1;
 const first=source[0],last=source[9];if(first===undefined||last===undefined||first.symbol!=="y"||first.width!==4||last.literal!==" o'clock")return 2;
 if(parseDateTimePattern("y 'unfinished")!==undefined)return 3;
 const r=parseDateTimePattern("yMd"),a=parseDateTimePattern("M/d/y"),b=parseDateTimePattern("E M/d/y"),c=parseDateTimePattern("M/y");
 if(r===undefined||a===undefined||b===undefined||c===undefined)return 4;
 const requested=dateTimePatternFields(r),one=dateTimePatternFields(a),two=dateTimePatternFields(b),three=dateTimePatternFields(c);
 if(requested===undefined||one===undefined||two===undefined||three===undefined)return 5;
 if(basicDateTimeFormatScore(requested,one)!==0||basicDateTimeFormatScore(requested,two)!==-20||basicDateTimeFormatScore(requested,three)!==-120)return 6;
 const formats:DateTimePatternFormat[]=[{pattern:"M/y",fields:three},{pattern:"E M/d/y",fields:two},{pattern:"M/d/y",fields:one}];
 const best=selectBasicDateTimeFormat(requested,formats);if(best===undefined||best.pattern!=="M/d/y")return 7;
 const interval=parseDateTimePattern("r(U) MMM d–d, y");if(interval===undefined)return 8;const split=splitDateTimeIntervalPattern(interval);if(split===undefined||split.field!=="day"||split.first.length!==8)return 9;
 const explicit=parseDateTimePattern("h BBBBB"),implicit=parseDateTimePattern("h a");if(explicit===undefined||implicit===undefined)return 10;
 const e=dateTimePatternFields(explicit),i=dateTimePatternFields(implicit);if(e===undefined||i===undefined||e.dayPeriod!=="narrow"||i.dayPeriod!==undefined)return 11;
 return 42;
}`,
  "date-time-pattern",
  [["pattern", "packages/js-runtime/src/objects/date-time-pattern.ts"]],
);

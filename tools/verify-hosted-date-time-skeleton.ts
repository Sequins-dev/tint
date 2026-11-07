import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createDateTimeCalendarProfile} from "data";
import {resolveDateTimeSkeleton,resolveDateTimeStylePattern,combineDateTimePatterns} from "skeleton";
import {parseDateTimePattern,dateTimePatternFields} from "pattern";
export function run():number {
 const en=createDateTimeCalendarProfile("en","gregory");if(en===undefined)return 1;
 const date=resolveDateTimeSkeleton(en,"yMMMMd",".");if(date===undefined||date.fields.month!=="long"||date.fields.era!==undefined)return 2;
 const both=resolveDateTimeSkeleton(en,"yMdHm",".");if(both===undefined||both.fields.hour!=="2-digit"||both.fields.minute!=="2-digit"||both.fields.second!==undefined)return 3;
 const fr=createDateTimeCalendarProfile("fr","gregory");if(fr===undefined)return 4;
 const fraction=resolveDateTimeSkeleton(fr,"HmsSSS",",");if(fraction===undefined||fraction.fields.fractionalSecondDigits!==3)return 5;
 const appended=resolveDateTimeSkeleton(en,"hsSS",".");if(appended===undefined||appended.fields.fractionalSecondDigits!==2||appended.fields.second!=="numeric")return 6;
 const ja=createDateTimeCalendarProfile("ja","gregory");if(ja===undefined)return 7;
 const japanese=resolveDateTimeSkeleton(ja,"yMMMM",".");if(japanese===undefined||japanese.fields.month!=="numeric")return 8;
 const ksh=createDateTimeCalendarProfile("ksh","gregory");if(ksh===undefined)return 9;
 const year=resolveDateTimeSkeleton(ksh,"yM",".");if(year===undefined||year.fields.year!=="numeric")return 10;
 const style=resolveDateTimeStylePattern(en,"long","short","h23");if(style===undefined||style.fields.hour!=="2-digit")return 11;
 const raw=parseDateTimePattern("rr U");if(raw===undefined)return 12;const fields=dateTimePatternFields(raw);if(fields===undefined||fields.year!=="2-digit")return 13;
 const joined=combineDateTimePatterns("{0} ({2}: {1})",[date.tokens,both.tokens],"o'clock");if(joined===undefined||joined.length<date.tokens.length)return 14;
 if(resolveDateTimeSkeleton(en,"yMy",".")!==undefined||resolveDateTimeSkeleton(en,"QQQ",".")!==undefined)return 15;
 return 42;
}`,
  "date-time-skeleton",
  [
    ["data", "packages/js-runtime/src/objects/date-time-calendar.ts"],
    ["skeleton", "packages/js-runtime/src/objects/date-time-skeleton.ts"],
    ["pattern", "packages/js-runtime/src/objects/date-time-pattern.ts"],
  ],
);

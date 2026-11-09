import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createDateTimePartsFormatter,dateTimePatternParts,type DateTimePart,type DateTimeDisplayFields} from "parts";
import {parseDateTimePattern} from "pattern";
function field(parts:readonly DateTimePart[],name:string):string|undefined {
 for(let index=0;index<parts.length;index++){const item:DateTimePart|undefined=parts[index];if(item===undefined)return undefined;if(item.type===name)return item.value;}return undefined;
}
export function run():number {
 const sample:DateTimeDisplayFields={date:{year:2024,month:2,day:29},hour:13,minute:5,second:9,millisecond:7};
 const en=createDateTimePartsFormatter("en","gregory",undefined),tokens=parseDateTimePattern("EEEEEE MMMM d y h:mm:ss.SSS a");if(en===undefined||tokens===undefined)return 1;
 const one=dateTimePatternParts(en,tokens,sample,undefined);if(one===undefined||field(one,"weekday")!=="Th"||field(one,"month")!=="February"||field(one,"hour")!=="1"||field(one,"minute")!=="05"||field(one,"fractionalSecond")!=="007"||field(one,"dayPeriod")!=="PM")return 2;
 const astral=createDateTimePartsFormatter("en","gregory","mathbold"),two=parseDateTimePattern("yy SSS");if(astral===undefined||two===undefined)return 3;
 const numbers=dateTimePatternParts(astral,two,sample,undefined);if(numbers===undefined||field(numbers,"year")!=="𝟐𝟒"||field(numbers,"fractionalSecond")!=="𝟎𝟎𝟕")return 4;
 const zh=createDateTimePartsFormatter("zh","chinese",undefined),lunar=parseDateTimePattern("r U MMMM d");if(zh===undefined||lunar===undefined)return 5;
 const chinese=dateTimePatternParts(zh,lunar,{date:{year:2020,month:5,day:23},hour:0,minute:0,second:0,millisecond:0},undefined);if(chinese===undefined||field(chinese,"relatedYear")!=="2020"||field(chinese,"yearName")!=="庚子"||field(chinese,"month")!=="闰四月"||field(chinese,"day")!=="1")return 6;
 const he=createDateTimePartsFormatter("en","hebrew",undefined),month=parseDateTimePattern("MMMM");if(he===undefined||month===undefined)return 7;
 const hebrew=dateTimePatternParts(he,month,{date:{year:2024,month:3,day:15},hour:0,minute:0,second:0,millisecond:0},undefined);if(hebrew===undefined||field(hebrew,"month")!=="Adar II")return 8;
 const era=parseDateTimePattern("G y");if(era===undefined)return 9;
 const bce=dateTimePatternParts(en,era,{date:{year:0,month:1,day:1},hour:0,minute:0,second:0,millisecond:0},undefined);if(bce===undefined||field(bce,"year")!=="1"||field(bce,"era")!=="BC")return 10;
 const noon=parseDateTimePattern("BBBB");if(noon===undefined)return 11;const period=dateTimePatternParts(en,noon,{date:{year:2024,month:2,day:29},hour:12,minute:0,second:0,millisecond:0},undefined);if(period===undefined||field(period,"dayPeriod")!=="noon")return 12;
 return 42;
}`,
  "date-time-parts",
  [
    ["parts", "packages/js-runtime/src/objects/date-time-parts.ts"],
    ["pattern", "packages/js-runtime/src/objects/date-time-pattern.ts"],
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

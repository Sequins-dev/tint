import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createDateTimePartsFormatter} from "parts";
import {createDateTimeZoneProfile} from "data";
import {dateTimeZoneName,type DateTimeZoneNameFormatter} from "name";
import {readPosixTimeZone,type TzifZone} from "tzif";
import type {TemporalTimeZone} from "zone";
function named(identifier:string,rules:string):TemporalTimeZone|undefined {
 const parsed=readPosixTimeZone(rules,true);if(!parsed.ok)return undefined;
 const model:TzifZone={data:{version:0,transitions:[],types:[{offsetSeconds:0,daylightSaving:false,designation:[],standard:false,universal:false}],footer:undefined},transitionSeconds:[],future:parsed.value,futureStatus:"ready",unspecifiedOffsetPolicy:"stored"};
 return {kind:"named",identifier,primaryIdentifier:identifier,model};
}
export function run():number {
 const parts=createDateTimePartsFormatter("en","gregory",undefined),data=createDateTimeZoneProfile("en");if(parts===undefined||data===undefined)return 1;
 const context:DateTimeZoneNameFormatter={data,numeric:parts.numeric,twoDigits:parts.twoDigits,region:"US"};
 const pacific=named("America/Los_Angeles","PST8PDT,M3.2.0,M11.1.0");if(pacific===undefined)return 2;
 if(dateTimeZoneName(context,pacific,1704067200,"short")!=="PST"||dateTimeZoneName(context,pacific,1719792000,"long")!=="Pacific Daylight Time"||dateTimeZoneName(context,pacific,1719792000,"shortGeneric")!=="PT")return 3;
 const vancouver=named("America/Vancouver","PST8PDT,M3.2.0,M11.1.0");if(vancouver===undefined)return 4;
 if(dateTimeZoneName(context,vancouver,1719792000,"longGeneric")!=="Pacific Time (Canada)")return 5;
 const offset:TemporalTimeZone={kind:"fixed",identifier:"+05:30",offsetNanoseconds:19800000000000};
 if(dateTimeZoneName(context,offset,1719792000,"longOffset")!=="GMT+05:30")return 6;
 const dublin=named("Europe/Dublin","IST-1GMT0,M10.5.0,M3.5.0/1");if(dublin===undefined)return 7;
 const irish:DateTimeZoneNameFormatter={data,numeric:parts.numeric,twoDigits:parts.twoDigits,region:"IE"};
 if(dateTimeZoneName(irish,dublin,1704067200,"long")!=="Greenwich Mean Time"||dateTimeZoneName(irish,dublin,1719792000,"long")!=="Irish Standard Time")return 8;
 const astParts=createDateTimePartsFormatter("ast","gregory",undefined),astData=createDateTimeZoneProfile("ast");if(astParts===undefined||astData===undefined)return 9;
 const ast:DateTimeZoneNameFormatter={data:astData,numeric:astParts.numeric,twoDigits:astParts.twoDigits,region:"GB"};
 const stable=named("Europe/London","GMT0"),temporary=named("Europe/London","GMT0BST0,M3.1.0,M3.1.1");if(stable===undefined||temporary===undefined)return 10;
 if(dateTimeZoneName(ast,stable,1719792000,"longGeneric")!=="Hora media de Greenwich"||dateTimeZoneName(ast,temporary,1719792000,"longGeneric")!=="Hora de RX")return 11;
 return 42;
}`,
  "date-time-zone-name",
  [
    ["parts", "packages/js-runtime/src/objects/date-time-parts.ts"],
    ["data", "packages/js-runtime/src/objects/date-time-zone-data.ts"],
    ["name", "packages/js-runtime/src/objects/date-time-zone-name.ts"],
    ["tzif", "packages/foundation/src/chrono/tzif/index.ts"],
    ["zone", "packages/js-runtime/src/objects/temporal-time-zone.ts"],
  ],
);

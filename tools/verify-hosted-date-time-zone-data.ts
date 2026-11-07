import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {createDateTimeZoneProfile,dateTimeZoneValue,dateTimeZoneMetazone,dateTimeZoneCanonicalName,dateTimeZoneTerritory,dateTimeDayPeriod} from "zoneData";
import {readPosixTimeZone,posixDaylightSavingAt,tzifDaylightSavingAt,type TzifZone} from "tzif";
export function run():number {
 const en=createDateTimeZoneProfile("en-US-u-nu-latn");if(en===undefined||en.locale!=="en-US")return 1;
 if(dateTimeZoneValue(en,"metazones","America_Pacific.long.standard")!=="Pacific Standard Time"||dateTimeZoneValue(en,"metazones","America_Pacific.short.daylight")!=="PDT")return 2;
 if(dateTimeZoneCanonicalName("aSiA/kOlKaTa")!=="Asia/Calcutta"||dateTimeZoneTerritory("US/Pacific")!=="US")return 3;
 if(dateTimeZoneMetazone("America/Indiana/Knox",688546799)!=="America_Central"||dateTimeZoneMetazone("America/Indiana/Knox",688546800)!=="America_Eastern")return 4;
 if(dateTimeZoneMetazone("Africa/Monrovia",63593069)!==undefined||dateTimeZoneMetazone("Africa/Monrovia",63593070)!=="GMT")return 5;
 if(dateTimeDayPeriod(en,0)!=="midnight"||dateTimeDayPeriod(en,0.1)!=="morning1"||dateTimeDayPeriod(en,43200)!=="noon"||dateTimeDayPeriod(en,43200.1)!=="afternoon1")return 6;
 const parsed=readPosixTimeZone("AAA0BBB0,M3.2.0,M11.1.0",true);if(!parsed.ok)return 7;
 if(posixDaylightSavingAt(parsed.value,1704067200)!==false||posixDaylightSavingAt(parsed.value,1719792000)!==true)return 8;
 const model:TzifZone={unspecifiedOffsetPolicy:"stored",data:{version:0,transitions:[],types:[{offsetSeconds:0,daylightSaving:false,designation:[],standard:false,universal:false}],footer:undefined},transitionSeconds:[],future:parsed.value,futureStatus:"ready"};
 if(tzifDaylightSavingAt(model,1704067200)!==false||tzifDaylightSavingAt(model,1719792000)!==true)return 9;
 return 42;
}`,
  "date-time-zone-data",
  [
    ["zoneData", "packages/js-runtime/src/objects/date-time-zone-data.ts"],
    ["tzif", "packages/foundation/src/chrono/tzif/index.ts"],
  ],
);

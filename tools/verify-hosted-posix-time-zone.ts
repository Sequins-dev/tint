import {
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
console.log(
  JSON.stringify({
    kind: "posix-time-zone-native-build",
    sourceSnapshot: workspaceSourceIdentity(workspaceSources()),
  }),
);
verifyHostedFixture(
  `import {readPosixTimeZone,posixOffsetSecondsAt} from "tzif";import {gregorianYearStartEpochDay} from "calendar";
export function run():number {
 const fixed=readPosixTimeZone("<+0545>-5:45");if(!fixed.ok)return 1;const f=fixed.value;if(f.kind!=="fixed"||f.offsetSeconds!==20700)return 1;
 const zone=readPosixTimeZone("EST5EDT,M3.2.0,M11.1.0");if(!zone.ok)return 2;
 const data=zone.value;if(data.kind!=="alternating")return 2;
 if(data.standardOffsetSeconds!==-18000||data.daylightOffsetSeconds!==-14400||data.start.seconds!==7200)return 3;
 const date=data.start.date;if(date.kind!=="month-week-day"||date.month!==3||date.week!==2||date.weekday!==0)return 4;
 const text="<-03>3<-02>,J60/-2,365/167:59:59";
 if(readPosixTimeZone(text,false).ok)return 5;
 const extended=readPosixTimeZone(text,true);if(!extended.ok)return 6;const e=extended.value;if(e.kind!=="alternating")return 6;
 if(e.start.seconds!==-7200||e.end.seconds!==604799)return 7;
 const first=e.start.date,last=e.end.date;
 if(first.kind!=="julian"||first.day!==60||last.kind!=="ordinal"||last.day!==365)return 8;
 const unsupported=readPosixTimeZone("EST5EDT");if(unsupported.ok||unsupported.error!=="DEFAULT_RULES_UNSUPPORTED")return 9;
 for(const text of ["UTC25","UTC0DST,M3.6.0,M11.1.0","UTC0DST,J366,J1","UTC0DST,0/168,365"]) {
  if(text===undefined||readPosixTimeZone(text,true).ok)return 10;
 }

 if(posixOffsetSecondsAt(data,1710053999)!==-18000||posixOffsetSecondsAt(data,1710054000)!==-14400||posixOffsetSecondsAt(data,1730613600)!==-18000)return 11;
 if(posixOffsetSecondsAt(data,-8640000000000)===undefined||posixOffsetSecondsAt(data,8640000000000)===undefined)return 12;
 const southern=readPosixTimeZone("AEST-10AEDT,M10.1.0,M4.1.0/3");if(!southern.ok)return 13;
 if(posixOffsetSecondsAt(southern.value,1712419199)!==39600||posixOffsetSecondsAt(southern.value,1712419200)!==36000||posixOffsetSecondsAt(southern.value,1728144000)!==39600)return 14;
 const all=readPosixTimeZone("XXX3EDT4,0/0,J365/23");if(!all.ok||posixOffsetSecondsAt(all.value,1704078000)!==-14400)return 15;
 if(gregorianYearStartEpochDay(-271822)!==-100000474||gregorianYearStartEpochDay(275761)!==100000110||gregorianYearStartEpochDay(-1000000000)!==-365243219528)return 16;
 return 42;
}`,
  "posix-time-zone",
  [
    ["tzif", "packages/foundation/src/chrono/tzif/index.ts"],
    ["calendar", "packages/foundation/src/chrono/gregorian-calendar/index.ts"],
  ],
);

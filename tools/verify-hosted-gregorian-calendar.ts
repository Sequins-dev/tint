import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {gregorianFromEpochDay,epochDayFromGregorian,daysInGregorianMonth,isoWeekFromEpochDay,gregorianCoordinateFromEpochDay,gregorianYearStartEpochDay} from "calendar";
export function run():number {
 if(epochDayFromGregorian(1970,1,1)!==0||epochDayFromGregorian(0,1,1)!==-719528)return 1;
 if(daysInGregorianMonth(1900,2)!==28||daysInGregorianMonth(2000,2)!==29)return 2;
 if(epochDayFromGregorian(1900,2,29)!==undefined||gregorianFromEpochDay(0.5)!==undefined)return 3;
 for(let day=-25567;day < -25567+146097;day++){
  const date=gregorianFromEpochDay(day);if(date===undefined)return 4;
  if(epochDayFromGregorian(date.year,date.month,date.day)!==day)return 5;
 }
 for(const day of [-100000001,-100000000,-719528,-1,0,1,100000000,100000001]){
  if(day===undefined)return 9;
  const date=gregorianFromEpochDay(day);if(date===undefined)return 6;
  if(epochDayFromGregorian(date.year,date.month,date.day)!==day)return 7;
 }
 const before=gregorianFromEpochDay(-1);
 if(before===undefined||before.year!==1969||before.month!==12||before.day!==31)return 8;
 for(const day of [-100000001,-719528,-1,0,100000001]){
  if(day===undefined)return 14;
  const a=isoWeekFromEpochDay(day),b=isoWeekFromEpochDay(day<0?day+146097:day-146097);
  if(a===undefined||b===undefined||a.week!==b.week||a.weekday!==b.weekday)return 10;
  if(a.year-b.year!==(day<0?-400:400))return 11;
 }
 const boundary=epochDayFromGregorian(2021,1,1);
 if(boundary===undefined)return 12;
 const week=isoWeekFromEpochDay(boundary);
 if(week===undefined||week.year!==2020||week.week!==53||week.weekday!==5)return 13;
 for(const year of [-1000000000,-271822,1970,275762,1000000000]){
  if(year===undefined)return 20;
  const day=gregorianYearStartEpochDay(year);if(day===undefined)return 15;
  const first=gregorianCoordinateFromEpochDay(day),february=gregorianCoordinateFromEpochDay(day+58);
  if(first===undefined||first.year!==year||first.month!==1||first.day!==1)return 16;
  if(february===undefined||february.year!==year||february.month!==2||february.day!==28)return 17;
 }
 for(const day of [-100000002,100000002]){
  if(day===undefined)return 21;
  if(gregorianFromEpochDay(day)!==undefined||gregorianCoordinateFromEpochDay(day)===undefined)return 18;
 }
 if(gregorianCoordinateFromEpochDay(9007199254740991)!==undefined)return 19;
 return 42;
}`,
  "gregorian-calendar",
  [["calendar", "packages/foundation/src/chrono/gregorian-calendar/index.ts"]],
);

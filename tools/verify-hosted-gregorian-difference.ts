import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `import {differenceGregorianDates,addGregorianDate,gregorianFromEpochDay,epochDayFromGregorian,type GregorianDate} from "calendar";
 function check(one:GregorianDate,two:GregorianDate,unit:"year"|"month"|"week"|"day"):number {
  const d=differenceGregorianDates(one,two,unit);if(d===undefined)return 1;
  const restored=addGregorianDate(one,d.years,d.months,d.weeks,d.days,"constrain");
  if(restored===undefined||restored.year!==two.year||restored.month!==two.month||restored.day!==two.day)return 2;
  const first=epochDayFromGregorian(one.year,one.month,one.day),last=epochDayFromGregorian(two.year,two.month,two.day);
  if(first===undefined||last===undefined)return 3;
  const sign=last>first?1:last<first?-1:0;
  if(d.years*sign<0||d.months*sign<0||d.weeks*sign<0||d.days*sign<0)return 4;
  return 0;
 }
 export function run():number {
  const january={year:2021,month:1,day:31},february={year:2021,month:2,day:28};
  const d=differenceGregorianDates(january,february,"month");if(d===undefined||d.months!==0||d.days!==28)return 1;
  const leap=differenceGregorianDates({year:2020,month:2,day:29},february,"year");if(leap===undefined||leap.years!==0||leap.months!==11||leap.days!==30)return 2;
  for(let i=0;i<256;i++){
   const one=gregorianFromEpochDay(-25567+i*571),two=gregorianFromEpochDay(-25567+i*571+4367);if(one===undefined||two===undefined)return 3;
   if(check(one,two,"year")+check(one,two,"month")+check(one,two,"week")+check(one,two,"day")+check(two,one,"year")+check(two,one,"month")+check(two,one,"week")+check(two,one,"day")!==0)return 4;
  }
  const one=gregorianFromEpochDay(-100000001),two=gregorianFromEpochDay(100000001);if(one===undefined||two===undefined)return 5;
  if(check(one,two,"year")+check(one,two,"month")+check(one,two,"week")+check(one,two,"day")!==0)return 6;
  const span=differenceGregorianDates(one,two,"day");if(span===undefined||span.days!==200000002)return 7;
  const week=differenceGregorianDates({year:2021,month:1,day:8},{year:2021,month:1,day:1},"week");if(week===undefined||week.weeks!==-1||week.days!==0||1/week.days!==Infinity)return 8;
  return 42;
 }`,
  "gregorian-difference",
  [["calendar", "packages/foundation/src/chrono/gregorian-calendar/index.ts"]],
  [],
  [],
  [],
  { managedBytes: 16777216, allocationCapacity: 1048576 },
);

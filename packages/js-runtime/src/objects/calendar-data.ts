// Era arithmetic follows the Stage 4 Intl era/monthCode table, including
// lenient input years. Offsets map eraYear to the calendar arithmetic year.
// https://tc39.es/proposal-intl-era-monthcode/#table-eras
export const calendarEraData =
  "buddhist|be,1,0\ncoptic|am,1,0\nethioaa|aa,1,0\nethiopic|am,1,0;aa,1,-5500\ngregory|ce,1,0,ad;bce,-1,1,bc\nhebrew|am,1,0\nindian|shaka,1,0\nislamic-civil|ah,1,0;bh,-1,1\nislamic-tbla|ah,1,0;bh,-1,1\nislamic-umalqura|ah,1,0;bh,-1,1\njapanese|ce,1,0,ad;bce,-1,1,bc;meiji,1,1867;taisho,1,1911;showa,1,1925;heisei,1,1988;reiwa,1,2018\npersian|ap,1,0\nroc|roc,1,0;broc,-1,1";

// Japanese modern eras use Gregorian dates. The 1873 calendar cutoff controls
// Meiji field output; its arithmetic era-year offset still starts in 1868.
export const japaneseGregorianEraData =
  "reiwa|2019|5|1|2019;heisei|1989|1|8|1989;showa|1926|12|25|1926;taisho|1912|7|30|1912;meiji|1873|1|1|1868";

// The shared 1461-day Coptic/Ethiopic cycle uses the Coptic epoch, expressed as
// an ISO epoch day. Year offsets are multiples of four and preserve leap years.
// Traditional epochs: Coptic 1-01-01 = ISO 0284-08-29;
// Ethiopic 1-01-01 = ISO 0008-08-27. Ethioaa arithmetic years add 5500.
export const copticEpochDay = -615558;
export const copticCalendarYearOffsets = "coptic|0\nethioaa|5776\nethiopic|276";

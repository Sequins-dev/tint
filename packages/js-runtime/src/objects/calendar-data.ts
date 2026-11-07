// Era arithmetic follows the Stage 4 Intl era/monthCode table, including
// lenient input years. Offsets map eraYear to the calendar arithmetic year.
// https://tc39.es/proposal-intl-era-monthcode/#table-eras
export const calendarEraData =
  "buddhist|be,1,0\ncoptic|am,1,0\nethioaa|aa,1,0\nethiopic|am,1,0;aa,1,-5500\ngregory|ce,1,0,ad;bce,-1,1,bc\nhebrew|am,1,0\nindian|shaka,1,0\nislamic-civil|ah,1,0;bh,-1,1\nislamic-tbla|ah,1,0;bh,-1,1\nislamic-umalqura|ah,1,0;bh,-1,1\njapanese|ce,1,0,ad;bce,-1,1,bc;meiji,1,1867;taisho,1,1911;showa,1,1925;heisei,1,1988;reiwa,1,2018\npersian|ap,1,0\nroc|roc,1,0;broc,-1,1";

// Japanese modern eras use Gregorian dates. The 1873 calendar cutoff controls
// Meiji field output; its arithmetic era-year offset still starts in 1868.
export const japaneseGregorianEraData =
  "reiwa|2019|5|1|2019;heisei|1989|1|8|1989;showa|1926|12|25|1926;taisho|1912|7|30|1912;meiji|1873|1|1|1868";

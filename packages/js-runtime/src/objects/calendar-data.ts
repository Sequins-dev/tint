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

// Leap corrections from ICU 77.1 persncal.cpp, Unicode-3.0.
// https://raw.githubusercontent.com/unicode-org/icu/release-77-1/icu4c/source/i18n/persncal.cpp
export const persianEpochDay = -492268;
export const persianLeapCorrectionYears =
  ",1502,1601,1634,1667,1700,1733,1766,1799,1832,1865,1898,1931,1964,1997,2030,2059,2063,2096,2129,2158,2162,2191,2195,2224,2228,2257,2261,2290,2294,2323,2327,2356,2360,2389,2393,2422,2426,2455,2459,2488,2492,2521,2525,2554,2558,2587,2591,2620,2624,2653,2657,2686,2690,2719,2723,2748,2752,2756,2781,2785,2789,2818,2822,2847,2851,2855,2880,2884,2888,2913,2917,2921,2946,2950,2954,2979,2983,2987,";

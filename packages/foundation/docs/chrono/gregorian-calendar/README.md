# @tint/foundation/chrono/gregorian-calendar

Pure proleptic Gregorian date/epoch-day conversion, with astronomical years
(including year zero), one-based months and days, and 1970-01-01 as epoch day zero.
There are no clock, time-zone, locale, object-model or host dependencies.

Conversions accept valid dates and integral epoch days within ±100,000,001 days.
This contains the calendar domain needed by Date and Temporal; adapters must still
apply their own boundary rules. Invalid inputs return `undefined`, and invalid
month queries return zero. Dates are not normalized across month boundaries.

The year calculation follows ECMAScript's
[DayFromYear](https://262.ecma-international.org/16.0/#sec-dayfromyear). Inverse
conversion corrects an average-year estimate against exact year boundaries.
The module does not itself implement Date or Temporal APIs.

`isoWeekFromEpochDay` returns the ISO week year, week number and Monday-based
weekday. It handles year transitions and the clipped domain boundaries without
requiring an out-of-domain Thursday conversion. Portable tests compare a full
400-year cycle and boundary dates; the native calendar/week fixture passes.

`addGregorianDate` applies years and months together, then constrains or rejects
an invalid source day, then adds weeks and days. Inputs, intermediate calendar
month and final result must lie in the supported domain. Overflow is explicit;
JavaScript coercion and Temporal duration policies belong to adapters.

`differenceGregorianDates` returns whole years/months/weeks/days with a common
sign and positive zero fields. Month/year anniversaries compare the original day
before the final anchor is constrained; this preserves month-end and leap-day
asymmetry. The span is computed arithmetically, including extreme endpoints,
without a loop proportional to the number of elapsed years or days. JavaScript
coercion, duration rounding and time-zone rules remain adapter responsibilities.

`gregorianYearStartEpochDay` supplies an unclipped year-start coordinate for
adjacent-year transition calculations. It rejects nonintegral years and arithmetic
that cannot stay exact in Number's safe integer range. This does not expand the
clipped date-conversion APIs above.

`gregorianCoordinateFromEpochDay` performs the inverse conversion without
Date/Temporal clipping, rejecting inexact year-boundary arithmetic. This permits
local-time shifts beyond the calendar API limits without weakening the range
checks of `gregorianFromEpochDay` or the calendar arithmetic APIs.

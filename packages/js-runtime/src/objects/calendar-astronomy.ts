/** Solar/lunar approximation from ICU 77.1 CalendarAstronomer (Unicode-3.0).
 * Only ecliptic longitude is needed; all math uses portable runtime primitives.
 */
import {
  sine,
  cosine,
  tangent,
} from "@tint/foundation/numeric/binary64-trigonometry";
import { numberAtan, numberAtan2 } from "./number-angle.ts";
const pi = Math.PI,
  turn = 2 * pi,
  degree = pi / 180,
  dayMS = 86400000;
export const calendarTropicalYear = 365.242191;
export const calendarSynodicMonth = 29.530588853;
function normalize(angle: number): number {
  return angle - turn * Math.floor(angle / turn);
}
function signed(angle: number): number {
  return normalize(angle + pi) - pi;
}
function solarPosition(ms: number): { longitude: number; anomaly: number } {
  const day = (ms + 210866760000000) / dayMS - 2447891.5;
  const anomaly = normalize(
    normalize((turn / calendarTropicalYear) * day) +
      279.403303 * degree -
      282.768422 * degree,
  );
  let eccentric = anomaly;
  for (let i = 0; i < 12; i++) {
    const delta = eccentric - 0.016713 * sine(eccentric) - anomaly;
    eccentric -= delta / (1 - 0.016713 * cosine(eccentric));
    if (Math.abs(delta) <= 0.00001) break;
  }
  return {
    longitude: normalize(
      2 * numberAtan(tangent(eccentric / 2) * Math.sqrt(1.016713 / 0.983287)) +
        282.768422 * degree,
    ),
    anomaly,
  };
}
export function calendarSolarLongitude(ms: number): number {
  return solarPosition(ms).longitude;
}
function moonAge(ms: number): number {
  const sun = solarPosition(ms),
    day = (ms + 210866760000000) / dayMS - 2447891.5;
  const mean = normalize(13.1763966 * degree * day + 318.351648 * degree);
  let anomaly = normalize(mean - 0.1114041 * degree * day - 36.34041 * degree);
  const evection = 1.2739 * degree * sine(2 * (mean - sun.longitude) - anomaly),
    annual = 0.1858 * degree * sine(sun.anomaly);
  anomaly += evection - annual - 0.37 * degree * sine(sun.anomaly);
  let longitude =
    mean +
    evection +
    6.2886 * degree * sine(anomaly) -
    annual +
    0.214 * degree * sine(2 * anomaly);
  longitude += 0.6583 * degree * sine(2 * (longitude - sun.longitude));
  const node =
    normalize(318.510107 * degree - 0.0529539 * degree * day) -
    0.16 * degree * sine(sun.anomaly);
  return normalize(
    numberAtan2(
      sine(longitude - node) * cosine(5.145366 * degree),
      cosine(longitude - node),
    ) +
      node -
      sun.longitude,
  );
}
/** Secant correction with ICU's one-minute convergence and divergence restart. */
export function calendarAstronomicalEvent(
  start: number,
  moon: boolean,
  forward: boolean,
): number {
  const desired = moon ? 0 : (3 * pi) / 2,
    period = (moon ? calendarSynodicMonth : calendarTropicalYear) * dayMS;
  const angle = (time: number): number =>
    moon ? moonAge(time) : calendarSolarLongitude(time);
  let origin = start;
  for (let restart = 0; restart < 16; restart++) {
    let lastAngle = angle(origin),
      delta =
        ((normalize(desired - lastAngle) + (forward ? 0 : -turn)) * period) /
        turn;
    let lastDelta = delta,
      time = origin + Math.ceil(delta);
    for (let iteration = 0; iteration < 32; iteration++) {
      const current = angle(time),
        factor = Math.abs(delta / signed(current - lastAngle));
      delta = signed(desired - current) * factor;
      if (!Number.isFinite(delta) || Math.abs(delta) > Math.abs(lastDelta))
        break;
      lastDelta = delta;
      lastAngle = current;
      time += Math.ceil(delta);
      if (Math.abs(delta) <= 60000) return time;
    }
    origin += (forward ? 1 : -1) * Math.ceil(period / 8);
  }
  throw "CALENDAR_ASTRONOMY_CONVERGENCE_INVARIANT";
}
/** Astronomical computation zones are calendar rules, independent of user zones. */
function offsetHours(calendar: string, ms: number, local: boolean): number {
  if (calendar !== "dangi") return 8;
  const a = (1897 - 1970) * 365 * dayMS,
    b = (1898 - 1970) * 365 * dayMS,
    c = (1912 - 1970) * 365 * dayMS;
  if (local)
    return ms < a ? 8 : ms < b + 3600000 ? 7 : ms < c + 3600000 ? 8 : 9;
  return ms < a - 8 * 3600000
    ? 8
    : ms < b - 7 * 3600000
      ? 7
      : ms < c - 8 * 3600000
        ? 8
        : 9;
}
export function calendarAstronomicalMidnight(
  calendar: string,
  day: number,
): number {
  const ms = day * dayMS;
  return ms - offsetHours(calendar, ms, true) * 3600000;
}
export function calendarAstronomicalDay(calendar: string, ms: number): number {
  return Math.floor((ms + offsetHours(calendar, ms, false) * 3600000) / dayMS);
}
export function calendarNewMoon(
  calendar: string,
  day: number,
  forward: boolean,
): number {
  return calendarAstronomicalDay(
    calendar,
    calendarAstronomicalEvent(
      calendarAstronomicalMidnight(calendar, day),
      true,
      forward,
    ),
  );
}
export function calendarWinterSolstice(calendar: string, year: number): number {
  // Stable cycle labels prevent a drifting fixed orbit from skipping solar years.
  return calendarAstronomicalDay(
    calendar,
    calendarAstronomicalEvent(
      calendarAstronomicalMidnight(
        calendar,
        11292 + (year - 2000) * calendarTropicalYear,
      ),
      false,
      true,
    ),
  );
}

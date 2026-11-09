import { clipDateTime, makeDateTime } from "./date-values.ts";
export interface DateParseResult {
  /** Offsetless date-times require the embedding's local-time conversion. */
  readonly local: boolean;
  readonly value: number;
}
/** Date's interchange grammar is narrower than Temporal's grammar: no calendar
 * annotations, offset seconds, or nanosecond precision. Date-only text is UTC. */
export function parseDateText(text: string): DateParseResult {
  if (text.endsWith(" GMT"))
    return { local: false, value: clipDateTime(parseUTCDateText(text)) };
  if (text.indexOf(" GMT") >= 0)
    return { local: false, value: parseLocalDateText(text) };
  if (text.indexOf(" ") >= 0) return parseSpaceSeparatedDateText(text);
  let offset = 0;
  function digits(count: number): number | undefined {
    let value = 0;
    for (let index = 0; index < count; index++) {
      const code = text.charCodeAt(offset++);
      if (!(code >= 48 && code <= 57)) return undefined;
      value = value * 10 + code - 48;
    }
    return value;
  }
  function token(value: string): boolean {
    if (text[offset] !== value) return false;
    offset++;
    return true;
  }
  function invalid(): DateParseResult {
    return { local: false, value: NaN };
  }
  const signed = text[0] === "+" || text[0] === "-";
  const negative = text[0] === "-";
  if (signed) offset++;
  const yearPart = digits(signed ? 6 : 4);
  if (yearPart === undefined || (negative && yearPart === 0)) return invalid();
  const year = negative ? -yearPart : yearPart;
  let month = 1,
    day = 1;
  if (token("-")) {
    const field = digits(2);
    if (field === undefined || field < 1 || field > 12) return invalid();
    month = field;
    if (token("-")) {
      const field = digits(2);
      if (field === undefined || field < 1 || field > 31) return invalid();
      day = field;
    }
  }
  if (offset === text.length)
    return {
      local: false,
      value: clipDateTime(makeDateTime(year, month - 1, day, 0, 0, 0, 0)),
    };
  if (!token("T")) return invalid();
  const hour = digits(2);
  if (hour === undefined || hour > 24 || !token(":")) return invalid();
  const minute = digits(2);
  if (minute === undefined || minute > 59) return invalid();
  let second = 0,
    millisecond = 0;
  if (token(":")) {
    const field = digits(2);
    if (field === undefined || field > 59) return invalid();
    second = field;
    if (token(".")) {
      const field = fraction(text, offset);
      if (field === undefined) return invalid();
      millisecond = field.milliseconds;
      offset = field.end;
    }
  }
  if (hour === 24 && (minute !== 0 || second !== 0 || millisecond !== 0))
    return invalid();
  let local = true,
    zone = 0;
  if (token("Z")) local = false;
  else if (text[offset] === "+" || text[offset] === "-") {
    const sign = text[offset] === "-" ? -1 : 1;
    offset++;
    const hours = digits(2);
    if (hours === undefined || hours > 23 || !token(":")) return invalid();
    const minutes = digits(2);
    if (minutes === undefined || minutes > 59) return invalid();
    zone = sign * (hours * 60 + minutes) * 60000;
    local = false;
  }
  if (offset !== text.length) return invalid();
  const value =
    makeDateTime(year, month - 1, day, hour, minute, second, millisecond) -
    zone;
  return { local, value: local ? value : clipDateTime(value) };
}

/** Fraction digits after a decimal point: at least one, any count, truncated
 * to milliseconds (as other engines read "01:01:01.01" and ".0123"). The
 * interchange format names exactly three; other counts are the
 * implementation-defined fallback of Date.parse. */
function fraction(
  text: string,
  start: number,
): { readonly milliseconds: number; readonly end: number } | undefined {
  let end = start,
    milliseconds = 0;
  while (end < text.length) {
    const code = text.charCodeAt(end);
    if (code < 48 || code > 57) break;
    if (end - start < 3) milliseconds = milliseconds * 10 + code - 48;
    end++;
  }
  if (end === start) return undefined;
  for (let count = end - start; count < 3; count++) milliseconds *= 10;
  return { milliseconds, end };
}
/** Implementation-defined fallback shared with V8 and SpiderMonkey (W3C
 * NOTE-datetime with relaxed widths): `[+-YY]YYYY-M[M][-D[D]] H[H]:M[M]
 * [:S[S][.fraction]]`, then optionally one space and `Z`, `+-HH`, `+-HHMM` or
 * `+-HH:MM`. Without an offset the time is local. A date with only an hour,
 * or any other text, is NaN. */
function parseSpaceSeparatedDateText(text: string): DateParseResult {
  const invalid: DateParseResult = { local: false, value: NaN };
  let offset = 0;
  /** Between min and max decimal digits. */
  function digits(min: number, max: number): number | undefined {
    let value = 0,
      count = 0;
    while (count < max && offset < text.length) {
      const code = text.charCodeAt(offset);
      if (code < 48 || code > 57) break;
      value = value * 10 + code - 48;
      offset++;
      count++;
    }
    return count < min ? undefined : value;
  }
  function token(value: string): boolean {
    if (text[offset] !== value) return false;
    offset++;
    return true;
  }
  const signed = text[0] === "+" || text[0] === "-";
  const negative = text[0] === "-";
  if (signed) offset++;
  const yearPart = signed ? digits(6, 6) : digits(4, 4);
  if (yearPart === undefined || (negative && yearPart === 0) || !token("-"))
    return invalid;
  const month = digits(1, 2);
  if (month === undefined || month < 1 || month > 12) return invalid;
  let day = 1;
  if (token("-")) {
    const field = digits(1, 2);
    if (field === undefined || field < 1 || field > 31) return invalid;
    day = field;
  }
  if (!token(" ")) return invalid;
  const hour = digits(1, 2);
  if (hour === undefined || hour > 24 || !token(":")) return invalid;
  const minute = digits(1, 2);
  if (minute === undefined || minute > 59) return invalid;
  let second = 0,
    millisecond = 0;
  if (token(":")) {
    const field = digits(1, 2);
    if (field === undefined || field > 59) return invalid;
    second = field;
    if (token(".")) {
      const parsed = fraction(text, offset);
      if (parsed === undefined) return invalid;
      millisecond = parsed.milliseconds;
      offset = parsed.end;
    }
  }
  if (hour === 24 && (minute !== 0 || second !== 0 || millisecond !== 0))
    return invalid;
  let local = true,
    zone = 0;
  if (offset < text.length) {
    token(" ");
    if (token("Z")) local = false;
    else if (text[offset] === "+" || text[offset] === "-") {
      const sign = text[offset] === "-" ? -1 : 1;
      offset++;
      const hours = digits(2, 2);
      if (hours === undefined || hours > 23) return invalid;
      let minutes = 0;
      const colon = token(":");
      if (colon || offset < text.length) {
        const field = digits(2, 2);
        if (field === undefined || field > 59) return invalid;
        minutes = field;
      }
      zone = sign * (hours * 60 + minutes) * 60000;
      local = false;
    } else return invalid;
  }
  if (offset !== text.length) return invalid;
  const year = negative ? -yearPart : yearPart;
  const value =
    makeDateTime(year, month - 1, day, hour, minute, second, millisecond) -
    zone;
  return { local, value: local ? value : clipDateTime(value) };
}

function decimal(text: string): number | undefined {
  if (text.length === 0) return undefined;
  let value = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 48 || code > 57) return undefined;
    value = value * 10 + code - 48;
  }
  return value;
}
/** Required round trip for this implementation's toUTCString output. */
function parseUTCDateText(text: string): number {
  const parts = text.split(" ");
  const weekday = parts[0],
    dayText = parts[1],
    monthText = parts[2],
    yearText = parts[3],
    clock = parts[4];
  if (
    parts.length !== 6 ||
    weekday === undefined ||
    dayText === undefined ||
    monthText === undefined ||
    yearText === undefined ||
    clock === undefined
  )
    return NaN;
  if (
    ["Sun,", "Mon,", "Tue,", "Wed,", "Thu,", "Fri,", "Sat,"].indexOf(weekday) <
    0
  )
    return NaN;
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ].indexOf(monthText);
  const negative = yearText[0] === "-",
    yearDigits = negative ? yearText.slice(1) : yearText;
  const year = decimal(yearDigits),
    day = decimal(dayText),
    hour = decimal(clock.slice(0, 2)),
    minute = decimal(clock.slice(3, 5)),
    second = decimal(clock.slice(6));
  if (
    year === undefined ||
    yearDigits.length < 4 ||
    yearDigits.length > 6 ||
    day === undefined ||
    dayText.length !== 2 ||
    day < 1 ||
    day > 31 ||
    month < 0 ||
    clock.length !== 8 ||
    clock[2] !== ":" ||
    clock[5] !== ":" ||
    hour === undefined ||
    hour > 23 ||
    minute === undefined ||
    minute > 59 ||
    second === undefined ||
    second > 59
  )
    return NaN;
  return makeDateTime(
    negative ? -year : year,
    month,
    day,
    hour,
    minute,
    second,
    0,
  );
}

/** Read the implementation's explicit-offset local serialization. */
function parseLocalDateText(text: string): number {
  const labelStart = text.indexOf(" (");
  let label = "";
  if (labelStart >= 0) {
    if (!text.endsWith(")")) return NaN;
    label = text.slice(labelStart + 2, -1);
    text = text.slice(0, labelStart);
  }
  const parts = text.split(" ");
  const weekday = parts[0],
    month = parts[1],
    day = parts[2],
    year = parts[3],
    clock = parts[4],
    zone = parts[5];
  if (
    parts.length !== 6 ||
    weekday === undefined ||
    month === undefined ||
    day === undefined ||
    year === undefined ||
    clock === undefined ||
    zone === undefined ||
    zone.length !== 8 ||
    zone.slice(0, 3) !== "GMT" ||
    (zone[3] !== "+" && zone[3] !== "-")
  )
    return NaN;
  const hours = decimal(zone.slice(4, 6)),
    minutes = decimal(zone.slice(6));
  if (
    hours === undefined ||
    hours > 23 ||
    minutes === undefined ||
    minutes > 59
  )
    return NaN;
  const time = parseUTCDateText(
    weekday + ", " + day + " " + month + " " + year + " " + clock + " GMT",
  );
  const sign = zone[3] === "-" ? -1 : 1;
  let offset = sign * (hours * 60 + minutes) * 60000;
  if (label.startsWith("UTC+") || label.startsWith("UTC-")) {
    const fields = label.slice(4).split(":");
    const exactHours = decimal(fields[0] ?? ""),
      exactMinutes = decimal(fields[1] ?? ""),
      exactSeconds = decimal(fields[2] ?? "");
    if (
      fields.length !== 3 ||
      exactHours === undefined ||
      exactHours % 24 !== hours ||
      exactMinutes !== minutes ||
      exactSeconds === undefined ||
      exactSeconds > 59 ||
      label[3] !== zone[3]
    )
      return NaN;
    offset = sign * (exactHours * 3600 + minutes * 60 + exactSeconds) * 1000;
    if (!Number.isSafeInteger(offset)) return NaN;
  }
  return clipDateTime(time - offset);
}

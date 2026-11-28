import {
  big5Index,
  eucKrIndex,
  gbRanges,
  gbTwoBytes,
  jis0208Index,
  jis0212Index,
} from "./multibyte-data.ts";

function codePoint(index: string, pointer: number): number {
  const offset = pointer * 2;
  if (offset < 0 || offset + 1 >= index.length) return 0;
  const low = index.charCodeAt(offset);
  return low === 65535 ? 0 : low + (index.charCodeAt(offset + 1) - 65) * 65536;
}
function inRange(value: number, start: number, end: number): boolean {
  return value >= start && value <= end;
}
function gbFourBytePoint(pointer: number): number {
  if ((pointer > 39419 && pointer < 189000) || pointer > 1237575) return 0;
  if (pointer === 7457) return 0xe7c7;
  for (let i = gbRanges.length - 4; i >= 0; i -= 4) {
    const start = gbRanges.charCodeAt(i) + gbRanges.charCodeAt(i + 1) * 65536;
    if (pointer >= start)
      return (
        gbRanges.charCodeAt(i + 2) +
        gbRanges.charCodeAt(i + 3) * 65536 +
        pointer -
        start
      );
  }
  return 0;
}

interface DecodedUnit {
  readonly point: number;
  readonly second?: number;
  readonly consumed: number;
}
function point(point: number, consumed: number): DecodedUnit {
  return { point, consumed };
}
function invalid(trail: number): DecodedUnit {
  return point(0, trail < 128 ? 1 : 2);
}
function gbUnit(
  bytes: Uint8Array,
  offset: number,
  lead: number,
  trail: number,
): DecodedUnit {
  if (lead === 0x80) return point(0x20ac, 1);
  if (!inRange(lead, 0x81, 0xfe)) return point(0, 1);
  if (offset + 1 >= bytes.length) return point(0, 0);
  if (inRange(trail, 0x30, 0x39)) {
    if (offset + 2 >= bytes.length) return point(0, 0);
    const third = bytes[offset + 2] ?? 0;
    if (!inRange(third, 0x81, 0xfe)) return point(0, 1);
    if (offset + 3 >= bytes.length) return point(0, 0);
    const fourth = bytes[offset + 3] ?? 0;
    if (!inRange(fourth, 0x30, 0x39)) return point(0, 1);
    const pointer =
      (((lead - 0x81) * 10 + trail - 0x30) * 126 + third - 0x81) * 10 +
      fourth -
      0x30;
    return point(gbFourBytePoint(pointer), 4);
  }
  if (!inRange(trail, 0x40, 0xfe) || trail === 0x7f) return invalid(trail);
  const mapped = codePoint(
    gbTwoBytes,
    (lead - 0x81) * 190 + trail - (trail < 0x7f ? 0x40 : 0x41),
  );
  return mapped === 0 ? invalid(trail) : point(mapped, 2);
}
function big5Unit(
  bytes: Uint8Array,
  offset: number,
  lead: number,
  trail: number,
): DecodedUnit {
  if (!inRange(lead, 0x81, 0xfe)) return point(0, 1);
  if (offset + 1 >= bytes.length) return point(0, 0);
  if (!inRange(trail, 0x40, 0x7e) && !inRange(trail, 0xa1, 0xfe))
    return invalid(trail);
  const pointer = (lead - 0x81) * 157 + trail - (trail < 0x7f ? 0x40 : 0x62);
  if (pointer === 1133) return { point: 0xca, second: 0x304, consumed: 2 };
  if (pointer === 1135) return { point: 0xca, second: 0x30c, consumed: 2 };
  if (pointer === 1164) return { point: 0xea, second: 0x304, consumed: 2 };
  if (pointer === 1166) return { point: 0xea, second: 0x30c, consumed: 2 };
  const mapped = codePoint(big5Index, pointer);
  return mapped === 0 ? invalid(trail) : point(mapped, 2);
}
function koreanUnit(
  bytes: Uint8Array,
  offset: number,
  lead: number,
  trail: number,
): DecodedUnit {
  if (!inRange(lead, 0x81, 0xfe)) return point(0, 1);
  if (offset + 1 >= bytes.length) return point(0, 0);
  const mapped = inRange(trail, 0x41, 0xfe)
    ? codePoint(eucKrIndex, (lead - 0x81) * 190 + trail - 0x41)
    : 0;
  return mapped === 0 ? invalid(trail) : point(mapped, 2);
}
function shiftJisUnit(
  bytes: Uint8Array,
  offset: number,
  lead: number,
  trail: number,
): DecodedUnit {
  if (lead === 0x80) return point(lead, 1);
  if (inRange(lead, 0xa1, 0xdf)) return point(0xff61 + lead - 0xa1, 1);
  if (!inRange(lead, 0x81, 0x9f) && !inRange(lead, 0xe0, 0xfc))
    return point(0, 1);
  if (offset + 1 >= bytes.length) return point(0, 0);
  if (!inRange(trail, 0x40, 0xfc) || trail === 0x7f) return invalid(trail);
  const pointer =
    (lead - (lead < 0xa0 ? 0x81 : 0xc1)) * 188 +
    trail -
    (trail < 0x7f ? 0x40 : 0x41);
  if (inRange(pointer, 8836, 10715)) return point(0xe000 + pointer - 8836, 2);
  const mapped = codePoint(jis0208Index, pointer);
  return mapped === 0 ? invalid(trail) : point(mapped, 2);
}
function eucJpUnit(
  bytes: Uint8Array,
  offset: number,
  lead: number,
  trail: number,
): DecodedUnit {
  if (lead !== 0x8e && lead !== 0x8f && !inRange(lead, 0xa1, 0xfe))
    return point(0, 1);
  if (offset + 1 >= bytes.length) return point(0, 0);
  if (lead === 0x8e)
    return inRange(trail, 0xa1, 0xdf)
      ? point(0xff61 + trail - 0xa1, 2)
      : invalid(trail);
  if (!inRange(trail, 0xa1, 0xfe)) return invalid(trail);
  if (lead === 0x8f) {
    if (offset + 2 >= bytes.length) return point(0, 0);
    const third = bytes[offset + 2] ?? 0;
    if (!inRange(third, 0xa1, 0xfe)) return point(0, third < 128 ? 2 : 3);
    return point(
      codePoint(jis0212Index, (trail - 0xa1) * 94 + third - 0xa1),
      3,
    );
  }
  return point(codePoint(jis0208Index, (lead - 0xa1) * 94 + trail - 0xa1), 2);
}

export function createMultibyteDecoder(
  encoding: string,
  fatal: boolean,
): (input: Uint8Array, stream: boolean) => string | undefined {
  let pending = new Uint8Array(0);
  let isoMode = 0;
  let isoEscaped = false;
  function isoUnit(
    bytes: Uint8Array,
    offset: number,
    lead: number,
    trail: number,
    stream: boolean,
  ): DecodedUnit {
    if (lead === 0x1b) {
      if (offset + 1 >= bytes.length) return point(0, 0);
      if (trail !== 0x24 && trail !== 0x28) {
        isoEscaped = false;
        return point(0, 1);
      }
      if (offset + 2 >= bytes.length && stream) return point(0, 0);
      const third = bytes[offset + 2] ?? 0;
      let mode = -1;
      if (trail === 0x28 && third === 0x42) mode = 0;
      if (trail === 0x28 && third === 0x4a) mode = 1;
      if (trail === 0x28 && third === 0x49) mode = 2;
      if (trail === 0x24 && (third === 0x40 || third === 0x42)) mode = 3;
      const duplicate = isoEscaped;
      isoEscaped = mode >= 0;
      if (mode < 0) return point(0, 1);
      isoMode = mode;
      return point(duplicate ? 0 : -1, 3);
    }
    isoEscaped = false;
    if (isoMode <= 1) {
      if (lead === 0x0e || lead === 0x0f || lead > 127) return point(0, 1);
      if (isoMode === 1 && lead === 0x5c) return point(0xa5, 1);
      if (isoMode === 1 && lead === 0x7e) return point(0x203e, 1);
      return point(lead === 0 ? -2 : lead, 1);
    }
    if (isoMode === 2)
      return point(inRange(lead, 0x21, 0x5f) ? 0xff61 + lead - 0x21 : 0, 1);
    if (!inRange(lead, 0x21, 0x7e)) return point(0, 1);
    if (offset + 1 >= bytes.length) return point(0, 0);
    if (trail === 0x1b) return point(0, 1);
    if (!inRange(trail, 0x21, 0x7e)) return point(0, 2);
    return point(codePoint(jis0208Index, (lead - 0x21) * 94 + trail - 0x21), 2);
  }
  return (input, stream): string | undefined => {
    let bytes = input;
    if (pending.length > 0) {
      bytes = new Uint8Array(pending.length + input.length);
      bytes.set(pending);
      bytes.set(input, pending.length);
      pending = new Uint8Array(0);
    }
    const output: string[] = [];
    for (let i = 0; i < bytes.length;) {
      const lead = bytes[i] ?? 0;
      const trail = bytes[i + 1] ?? 0;
      if (encoding !== "iso-2022-jp" && lead < 128) {
        output.push(String.fromCharCode(lead));
        i++;
        continue;
      }
      const unit =
        encoding === "iso-2022-jp"
          ? isoUnit(bytes, i, lead, trail, stream)
          : encoding === "gbk" || encoding === "gb18030"
            ? gbUnit(bytes, i, lead, trail)
            : encoding === "big5"
              ? big5Unit(bytes, i, lead, trail)
              : encoding === "euc-kr"
                ? koreanUnit(bytes, i, lead, trail)
                : encoding === "shift_jis"
                  ? shiftJisUnit(bytes, i, lead, trail)
                  : eucJpUnit(bytes, i, lead, trail);
      if (unit.consumed === 0) {
        if (stream) pending = bytes.slice(i);
        else if (fatal) return undefined;
        else output.push("�");
        break;
      }
      i += unit.consumed;
      if (unit.point === 0) {
        if (fatal) return undefined;
        output.push("�");
      } else if (unit.point !== -1) {
        output.push(String.fromCodePoint(unit.point === -2 ? 0 : unit.point));
        const second = unit.second;
        if (second !== undefined) output.push(String.fromCodePoint(second));
      }
    }
    if (!stream) {
      isoMode = 0;
      isoEscaped = false;
    }
    return output.join("");
  };
}

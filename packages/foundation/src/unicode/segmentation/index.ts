import {
  segmentationVersion,
  segmentationClasses,
  graphemeBreakValues,
  wordBreakValues,
  sentenceBreakValues,
  conjunctBreakValues,
} from "./data.ts";
import { hasUnicodeProperty } from "../properties/index.ts";

export { segmentationVersion };

/** UAX #29 default (untailored) boundaries for the given granularity. */
export type SegmentationGranularity = "grapheme" | "word" | "sentence";

// Grapheme_Cluster_Break values (generator order).
const gOther = 0,
  gCR = 1,
  gLF = 2,
  gControl = 3,
  gExtend = 4,
  gZWJ = 5,
  gRI = 6,
  gPrepend = 7,
  gSpacingMark = 8,
  gL = 9,
  gV = 10,
  gT = 11,
  gLV = 12,
  gLVT = 13;
// Word_Break values.
const wCR = 1,
  wLF = 2,
  wNewline = 3,
  wExtend = 4,
  wZWJ = 5,
  wRI = 6,
  wFormat = 7,
  wKatakana = 8,
  wHebrew = 9,
  wALetter = 10,
  wSingleQuote = 11,
  wDoubleQuote = 12,
  wMidNumLet = 13,
  wMidLetter = 14,
  wMidNum = 15,
  wNumeric = 16,
  wExtendNumLet = 17,
  wWSegSpace = 18;
// Sentence_Break values.
const sCR = 1,
  sLF = 2,
  sExtend = 3,
  sSep = 4,
  sFormat = 5,
  sSp = 6,
  sLower = 7,
  sUpper = 8,
  sOLetter = 9,
  sNumeric = 10,
  sATerm = 11,
  sSContinue = 12,
  sSTerm = 13,
  sClose = 14;
// Indic_Conjunct_Break values.
const cLinker = 1,
  cConsonant = 2,
  cExtend = 3;

/** Packed class: grapheme | word << 4 | sentence << 9 | conjunct << 13 |
 * extended pictographic << 15 (see tools/generate-unicode-segmentation.ts). */
function packedClass(point: number): number {
  let low = 0,
    high = segmentationClasses.length / 3 - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2),
      offset = mid * 3;
    const start =
      segmentationClasses.charCodeAt(offset) * 65536 +
      segmentationClasses.charCodeAt(offset + 1);
    if (start <= point) low = mid;
    else high = mid - 1;
  }
  return segmentationClasses.charCodeAt(low * 3 + 2);
}
function graphemeOf(packed: number): number {
  return packed & 15;
}
function wordOf(packed: number): number {
  return (packed >>> 4) & 31;
}
function sentenceOf(packed: number): number {
  return (packed >>> 9) & 15;
}
function conjunctOf(packed: number): number {
  return (packed >>> 13) & 3;
}
function pictographicOf(packed: number): boolean {
  return (packed & 32768) !== 0;
}
function valueName(values: readonly string[], index: number): string {
  const name = values[index];
  if (name === undefined) throw "SEGMENTATION_VALUE_INVARIANT";
  return name;
}

export interface SegmentationClass {
  readonly grapheme: string;
  readonly word: string;
  readonly sentence: string;
  readonly conjunct: string;
  readonly pictographic: boolean;
}
/** Property values used by the segmentation rules for one code point. */
export function segmentationClassOf(point: number): SegmentationClass {
  if (!Number.isInteger(point) || point < 0 || point > 0x10ffff)
    throw "INVALID_CODE_POINT";
  const packed = packedClass(point);
  return {
    grapheme: valueName(graphemeBreakValues, graphemeOf(packed)),
    word: valueName(wordBreakValues, wordOf(packed)),
    sentence: valueName(sentenceBreakValues, sentenceOf(packed)),
    conjunct: valueName(conjunctBreakValues, conjunctOf(packed)),
    pictographic: pictographicOf(packed),
  };
}

interface DecodedText {
  /** UTF-16 offset of each code point; a lone surrogate is one code point. */
  readonly offsets: number[];
  readonly classes: number[];
}
function decode(text: string): DecodedText {
  const offsets: number[] = [],
    classes: number[] = [];
  let index = 0;
  while (index < text.length) {
    const lead = text.charCodeAt(index);
    let point = lead,
      width = 1;
    if (lead >= 0xd800 && lead <= 0xdbff && index + 1 < text.length) {
      const trail = text.charCodeAt(index + 1);
      if (trail >= 0xdc00 && trail <= 0xdfff) {
        point = (lead - 0xd800) * 0x400 + (trail - 0xdc00) + 0x10000;
        width = 2;
      }
    }
    offsets.push(index);
    classes.push(packedClass(point));
    index += width;
  }
  return { offsets, classes };
}
function classAt(classes: number[], index: number): number {
  const value = classes[index];
  if (value === undefined) throw "SEGMENTATION_INDEX_INVARIANT";
  return value;
}

/** breaks[i] reports a boundary before code point i (1 <= i < n). */
function graphemeBreaks(classes: number[]): boolean[] {
  const breaks: boolean[] = [],
    count = classes.length;
  if (count === 0) return breaks;
  breaks.push(true);
  // State describing the text up to and including the previous code point.
  let regionalRun = 0, // consecutive Regional_Indicator code points
    pictographicRun = false, // ExtPict Extend*
    pictographicJoiner = false, // ExtPict Extend* ZWJ
    conjunct = 0; // 1: Consonant [Extend|Linker]*; 2: also saw a Linker
  function advance(packed: number): void {
    const g = graphemeOf(packed);
    regionalRun = g === gRI ? regionalRun + 1 : 0;
    if (pictographicOf(packed)) {
      pictographicRun = true;
      pictographicJoiner = false;
    } else if (g === gExtend && pictographicRun) pictographicJoiner = false;
    else if (g === gZWJ && pictographicRun) {
      pictographicRun = false;
      pictographicJoiner = true;
    } else {
      pictographicRun = false;
      pictographicJoiner = false;
    }
    const c = conjunctOf(packed);
    if (c === cConsonant) conjunct = 1;
    else if (conjunct !== 0 && (c === cExtend || c === cLinker)) {
      if (c === cLinker) conjunct = 2;
    } else conjunct = 0;
  }
  advance(classAt(classes, 0));
  for (let i = 1; i < count; i++) {
    const previous = classAt(classes, i - 1),
      current = classAt(classes, i);
    const p = graphemeOf(previous),
      c = graphemeOf(current);
    let boundary: boolean;
    if (p === gCR && c === gLF)
      boundary = false; // GB3
    else if (p === gControl || p === gCR || p === gLF)
      boundary = true; // GB4
    else if (c === gControl || c === gCR || c === gLF)
      boundary = true; // GB5
    else if (p === gL && (c === gL || c === gV || c === gLV || c === gLVT))
      boundary = false; // GB6
    else if ((p === gLV || p === gV) && (c === gV || c === gT))
      boundary = false; // GB7
    else if ((p === gLVT || p === gT) && c === gT)
      boundary = false; // GB8
    else if (c === gExtend || c === gZWJ)
      boundary = false; // GB9
    else if (c === gSpacingMark)
      boundary = false; // GB9a
    else if (p === gPrepend)
      boundary = false; // GB9b
    else if (conjunctOf(current) === cConsonant && conjunct === 2)
      boundary = false; // GB9c
    else if (pictographicJoiner && pictographicOf(current))
      boundary = false; // GB11
    else if (p === gRI && c === gRI && regionalRun % 2 === 1)
      boundary = false; // GB12, GB13
    else boundary = true; // GB999
    breaks.push(boundary);
    advance(current);
  }
  return breaks;
}

function wordIgnorable(value: number): boolean {
  return value === wExtend || value === wFormat || value === wZWJ;
}
function wordHardBreak(value: number): boolean {
  return value === wCR || value === wLF || value === wNewline;
}
function aheadLetter(value: number): boolean {
  return value === wALetter || value === wHebrew;
}
function midLetterQ(value: number): boolean {
  return value === wMidLetter || value === wMidNumLet || value === wSingleQuote;
}
function midNumQ(value: number): boolean {
  return value === wMidNum || value === wMidNumLet || value === wSingleQuote;
}
function wordBreaks(classes: number[]): boolean[] {
  const breaks: boolean[] = [],
    count = classes.length,
    word: number[] = [];
  for (let i = 0; i < count; i++) word.push(wordOf(classAt(classes, i)));
  function at(index: number): number {
    if (index < 0 || index >= count) return -1;
    const value = word[index];
    if (value === undefined) throw "SEGMENTATION_INDEX_INVARIANT";
    return value;
  }
  /** WB4: Extend/Format/ZWJ attach to the preceding character unless that
   * run starts at sot or after CR/LF/Newline, where the first ignorable
   * stands for itself. Returns the effective character before `position`. */
  function previous(position: number): number {
    const j = position - 1;
    if (j < 0) return -1;
    if (!wordIgnorable(at(j))) return j;
    let m = j;
    while (m >= 0 && wordIgnorable(at(m))) m--;
    if (m < 0 || wordHardBreak(at(m))) return m + 1;
    return m;
  }
  function next(position: number): number {
    let j = position + 1;
    while (j < count && wordIgnorable(at(j))) j++;
    return j;
  }
  if (count === 0) return breaks;
  breaks.push(true);
  for (let i = 1; i < count; i++) {
    const p = at(i - 1),
      c = at(i);
    let boundary: boolean | undefined;
    if (p === wCR && c === wLF)
      boundary = false; // WB3
    else if (wordHardBreak(p))
      boundary = true; // WB3a
    else if (wordHardBreak(c))
      boundary = true; // WB3b
    else if (p === wZWJ && pictographicOf(classAt(classes, i)))
      boundary = false; // WB3c
    else if (p === wWSegSpace && c === wWSegSpace)
      boundary = false; // WB3d
    else if (wordIgnorable(c)) boundary = false; // WB4
    if (boundary === undefined) {
      const pi = previous(i),
        P = at(pi),
        PP = pi < 0 ? -1 : at(previous(pi)),
        N = at(next(i));
      if (aheadLetter(P) && aheadLetter(c))
        boundary = false; // WB5
      else if (aheadLetter(P) && midLetterQ(c) && aheadLetter(N))
        boundary = false; // WB6
      else if (aheadLetter(PP) && midLetterQ(P) && aheadLetter(c))
        boundary = false; // WB7
      else if (P === wHebrew && c === wSingleQuote)
        boundary = false; // WB7a
      else if (P === wHebrew && c === wDoubleQuote && N === wHebrew)
        boundary = false; // WB7b
      else if (PP === wHebrew && P === wDoubleQuote && c === wHebrew)
        boundary = false; // WB7c
      else if (P === wNumeric && c === wNumeric)
        boundary = false; // WB8
      else if (aheadLetter(P) && c === wNumeric)
        boundary = false; // WB9
      else if (P === wNumeric && aheadLetter(c))
        boundary = false; // WB10
      else if (PP === wNumeric && midNumQ(P) && c === wNumeric)
        boundary = false; // WB11
      else if (P === wNumeric && midNumQ(c) && N === wNumeric)
        boundary = false; // WB12
      else if (P === wKatakana && c === wKatakana)
        boundary = false; // WB13
      else if (
        (aheadLetter(P) ||
          P === wNumeric ||
          P === wKatakana ||
          P === wExtendNumLet) &&
        c === wExtendNumLet
      )
        boundary = false; // WB13a
      else if (
        P === wExtendNumLet &&
        (aheadLetter(c) || c === wNumeric || c === wKatakana)
      )
        boundary = false; // WB13b
      else if (P === wRI && c === wRI) {
        // WB15, WB16: pair regional indicators from the start of their run.
        let run = 0,
          k = pi;
        while (k >= 0 && at(k) === wRI) {
          run++;
          k = previous(k);
        }
        boundary = run % 2 === 0;
      } else boundary = true; // WB999
    }
    breaks.push(boundary);
  }
  return breaks;
}

function sentenceIgnorable(value: number): boolean {
  return value === sExtend || value === sFormat;
}
function paragraphSeparator(value: number): boolean {
  return value === sSep || value === sCR || value === sLF;
}
function sentenceTerminal(value: number): boolean {
  return value === sSTerm || value === sATerm;
}
function sentenceBreaks(classes: number[]): boolean[] {
  const breaks: boolean[] = [],
    count = classes.length,
    sentence: number[] = [];
  for (let i = 0; i < count; i++)
    sentence.push(sentenceOf(classAt(classes, i)));
  function at(index: number): number {
    if (index < 0 || index >= count) return -1;
    const value = sentence[index];
    if (value === undefined) throw "SEGMENTATION_INDEX_INVARIANT";
    return value;
  }
  /** SB5: Extend/Format attach to the preceding character except at sot or
   * after a paragraph separator. */
  function previous(position: number): number {
    const j = position - 1;
    if (j < 0) return -1;
    if (!sentenceIgnorable(at(j))) return j;
    let m = j;
    while (m >= 0 && sentenceIgnorable(at(m))) m--;
    if (m < 0 || paragraphSeparator(at(m))) return m + 1;
    return m;
  }
  /** Skip Sp* then Close* backwards from an effective index. */
  function skipSpacesAndClose(index: number, spaces: boolean): number {
    let k = index;
    if (spaces) while (k >= 0 && at(k) === sSp) k = previous(k);
    while (k >= 0 && at(k) === sClose) k = previous(k);
    return k;
  }
  /** SB8: (¬(OLetter | Upper | Lower | ParaSep | SATerm))* Lower from `start`. */
  function lowerFollows(start: number): boolean {
    for (let j = start; j < count; j++) {
      const value = at(j);
      if (sentenceIgnorable(value)) continue;
      if (value === sLower) return true;
      if (
        value === sOLetter ||
        value === sUpper ||
        paragraphSeparator(value) ||
        sentenceTerminal(value)
      )
        return false;
    }
    return false;
  }
  if (count === 0) return breaks;
  breaks.push(true);
  for (let i = 1; i < count; i++) {
    const p = at(i - 1),
      c = at(i);
    let boundary: boolean;
    if (p === sCR && c === sLF)
      boundary = false; // SB3
    else if (paragraphSeparator(p))
      boundary = true; // SB4
    else if (sentenceIgnorable(c))
      boundary = false; // SB5
    else {
      const pi = previous(i),
        P = at(pi),
        PP = pi < 0 ? -1 : at(previous(pi));
      const closeOnly = skipSpacesAndClose(pi, false),
        terminal = skipSpacesAndClose(pi, true),
        T = at(terminal);
      let separatorTerminal = pi;
      if (paragraphSeparator(at(separatorTerminal)))
        separatorTerminal = previous(separatorTerminal);
      const ST = at(skipSpacesAndClose(separatorTerminal, true));
      if (P === sATerm && c === sNumeric)
        boundary = false; // SB6
      else if ((PP === sUpper || PP === sLower) && P === sATerm && c === sUpper)
        boundary = false; // SB7
      else if (T === sATerm && lowerFollows(i))
        boundary = false; // SB8
      else if (sentenceTerminal(T) && (c === sSContinue || sentenceTerminal(c)))
        boundary = false; // SB8a
      else if (
        sentenceTerminal(at(closeOnly)) &&
        (c === sClose || c === sSp || paragraphSeparator(c))
      )
        boundary = false; // SB9
      else if (sentenceTerminal(T) && (c === sSp || paragraphSeparator(c)))
        boundary = false; // SB10
      else if (sentenceTerminal(ST))
        boundary = true; // SB11
      else boundary = false; // SB998
    }
    breaks.push(boundary);
  }
  return breaks;
}

/** Boundary offsets in UTF-16 code units, including 0 and the text length;
 * empty text has no boundaries. Surrogate pairs are never split. */
export function segmentBoundaries(
  text: string,
  granularity: SegmentationGranularity,
): number[] {
  const decoded = decode(text);
  const breaks =
    granularity === "grapheme"
      ? graphemeBreaks(decoded.classes)
      : granularity === "word"
        ? wordBreaks(decoded.classes)
        : sentenceBreaks(decoded.classes);
  const boundaries: number[] = [];
  for (let i = 0; i < breaks.length; i++) {
    if (breaks[i] !== true) continue;
    const offset = decoded.offsets[i];
    if (offset === undefined) throw "SEGMENTATION_INDEX_INVARIANT";
    boundaries.push(offset);
  }
  if (text.length > 0) boundaries.push(text.length);
  return boundaries;
}

/** A word segment is word-like when it contains an Alphabetic code point
 * (letters, ideographs, kana, Brahmic letters) or a decimal digit. */
export function isWordLikeSegment(segment: string): boolean {
  let index = 0;
  while (index < segment.length) {
    const point = segment.codePointAt(index);
    if (point === undefined) throw "SEGMENTATION_INDEX_INVARIANT";
    if (
      hasUnicodeProperty("Alphabetic", "", point) === true ||
      hasUnicodeProperty("General_Category", "Decimal_Number", point) === true
    )
      return true;
    index += point > 0xffff ? 2 : 1;
  }
  return false;
}

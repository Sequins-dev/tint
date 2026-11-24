// Loop string builders (build-loop-strings, docs/design-one-byte-strings.md):
// loops that append to a string local build it in a buffer. Typed checks
// that every result equals the same pieces joined: one-byte and two-byte
// pieces (a two-byte piece widening a one-byte buffer mid-loop), empty
// pieces and seeds, a two-byte seed, sliced pieces, growth over thousands
// of appends, zero iterations, several exits (break, return), nested loops,
// reads of the result after each exit, pieces that branch, and appends
// whose pieces assign the string (directly or through a closure), which
// must still read it first. `run` returns 42, or the number of the first
// failed check. tools/string-builder-fixture.test.ts runs the
// same source under Node.
export const stringBuilderSource = `
const words: readonly string[] = ["alpha", "", "beta", "gamma-delta", "\\u00e9t\\u00e9", "z"];
function word(index: number): string {
  return words[index % words.length] ?? "";
}
function joined(pieces: readonly string[]): string {
  return pieces.join("");
}

function appendWords(count: number, seed: string): string {
  let text = seed;
  for (let i = 0; i < count; i++) text += word(i);
  return text;
}
function expectedWords(count: number, seed: string): string {
  const pieces: string[] = [seed];
  for (let i = 0; i < count; i++) pieces.push(word(i));
  return joined(pieces);
}
/** A two-byte piece arrives after a one-byte prefix; then one-byte again. */
function widen(count: number): string {
  let text = "";
  for (let i = 0; i < count; i++) {
    if (i === count >> 1) text += "\\u4e16\\u754c";
    else text = text + String(i) + ",";
  }
  return text;
}
function expectedWiden(count: number): string {
  const pieces: string[] = [];
  for (let i = 0; i < count; i++) {
    if (i === count >> 1) pieces.push("\\u4e16\\u754c");
    else pieces.push(String(i) + ",");
  }
  return joined(pieces);
}
/** Leaves by break and by return, and appends slices of a long parent. */
function exits(limit: number, parent: string): string {
  let text = "<";
  for (let i = 0; ; i++) {
    if (i === limit) break;
    if (i > 1000) return "unreachable";
    text += parent.slice(i, i + 20);
  }
  return text + ">";
}
function expectedExits(limit: number, parent: string): string {
  const pieces: string[] = ["<"];
  for (let i = 0; i < limit; i++) pieces.push(parent.slice(i, i + 20));
  pieces.push(">");
  return joined(pieces);
}
/** A builder per outer iteration, each read after its loop. */
function nested(rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    let line = "";
    for (let i = 0; i < 24; i++)
      line = line + String.fromCharCode(97 + ((i + round) % 26));
    total += line.length + line.charCodeAt(round % 24);
  }
  return total;
}
function expectedNested(rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const pieces: string[] = [];
    for (let i = 0; i < 24; i++)
      pieces.push(String.fromCharCode(97 + ((i + round) % 26)));
    const line = joined(pieces);
    total += line.length + line.charCodeAt(round % 24);
  }
  return total;
}
/** One builder over both levels of a loop nest. */
function nest(rows: number, columns: number): string {
  let text = "";
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++)
      text += String(row * columns + column) + (column === columns - 1 ? "\\n" : " ");
  return text;
}
function expectedNest(rows: number, columns: number): string {
  const pieces: string[] = [];
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++)
      pieces.push(String(row * columns + column) + (column === columns - 1 ? "\\n" : " "));
  return joined(pieces);
}
/** Pieces that branch (\`??\`, a conditional) between reads of the string. */
function branching(count: number): string {
  let text = "";
  for (let i = 0; i < count; i++)
    text += (words[i % 7] ?? "?") + (i % 3 === 0 ? "|" : ",");
  return text;
}
function expectedBranching(count: number): string {
  const pieces: string[] = [];
  for (let i = 0; i < count; i++)
    pieces.push((words[i % 7] ?? "?") + (i % 3 === 0 ? "|" : ","));
  return joined(pieces);
}
/** A piece that assigns the string: the append reads it first. */
function assigning(): string {
  let text = "a";
  text += (text = "b") + "c";
  let other = "x";
  other = other + (other = "y") + "z";
  return text + ":" + other;
}
/** A closure that writes the captured string while a piece is evaluated. */
function capturing(count: number): string {
  let text = "<";
  const piece = (): string => {
    text = "!" + text;
    return ".";
  };
  for (let i = 0; i < count; i++) text += piece();
  return text;
}

export function run(): number {
  // 1-5: one-byte, empty and two-byte seeds and pieces, zero iterations.
  if (appendWords(0, "") !== "" || appendWords(0, "seed") !== "seed") return 1;
  for (const count of [1, 2, 5, 13, 64, 100])
    if (appendWords(count, "") !== expectedWords(count, "")) return 2;
  if (appendWords(40, "start:") !== expectedWords(40, "start:")) return 3;
  if (appendWords(40, "\\u4e16:") !== expectedWords(40, "\\u4e16:")) return 4;
  const wordsText = appendWords(37, "");
  if (wordsText.length !== expectedWords(37, "").length || wordsText.charCodeAt(9) !== expectedWords(37, "").charCodeAt(9))
    return 5;
  // 6-8: widening mid-loop, and growth over thousands of appends.
  for (const count of [2, 3, 17, 100])
    if (widen(count) !== expectedWiden(count)) return 6;
  const long = appendWords(5000, "");
  if (long !== expectedWords(5000, "") || long.length !== expectedWords(5000, "").length) return 7;
  if (widen(3001) !== expectedWiden(3001)) return 8;
  // 9-10: exits by break with sliced pieces; the result is read afterwards.
  let parent = "";
  const parts: string[] = [];
  for (let i = 0; i < 80; i++) parts.push(String.fromCharCode(65 + (i % 26)));
  parent = parts.join("") + "\\u00ff" + parts.join("");
  for (const limit of [0, 1, 7, 40])
    if (exits(limit, parent) !== expectedExits(limit, parent)) return 9;
  if (exits(40, parent).charCodeAt(1) !== 65) return 10;
  // 11-12: nested loops.
  if (nested(50) !== expectedNested(50)) return 11;
  if (nest(7, 9) !== expectedNest(7, 9) || nest(0, 9) !== "" || nest(3, 0) !== "") return 12;
  // 13-15: branching pieces; pieces that assign the string, directly or
  // through a closure, after the append has read it.
  for (const count of [0, 1, 2, 3, 4, 50])
    if (branching(count) !== expectedBranching(count)) return 13;
  if (assigning() !== "abc:xyz") return 14;
  if (capturing(3) !== "<...") return 15;
  return 42;
}
`;

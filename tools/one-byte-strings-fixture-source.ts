// One-byte and two-byte string kinds (docs/design-one-byte-strings.md):
// typed checks of code-unit semantics across both kinds and their
// boundaries. `run` returns 42, or the number of the first failed check.
// Strings are built at run time (from code units, slices and joins) so the
// checks exercise heap strings of each kind against literals, which are
// encoded in their canonical kind at compile time.
export const oneByteStringsSource = `
function build(units: number[]): string {
  let text = "";
  for (let i = 0; i < units.length; i++)
    text += String.fromCharCode(units[i] ?? 0);
  return text;
}
function repeatUnit(unit: number, count: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) parts.push(String.fromCharCode(unit));
  return parts.join("");
}
function sumUnits(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return sum;
}
function same(left: string, right: string): boolean {
  return left === right;
}
/** One code unit from a run-time number (ToUint16 of ToNumber). */
function unitOf(value: number): number {
  return String.fromCharCode(value).charCodeAt(0);
}
export function run(): number {
  // 1-8: the 0xFF/0x100 boundary.
  const ff = String.fromCharCode(0xff),
    wide = String.fromCharCode(0x100);
  if (ff.length !== 1 || ff.charCodeAt(0) !== 0xff) return 1;
  if (wide.length !== 1 || wide.charCodeAt(0) !== 0x100) return 2;
  if (ff !== "\\u00ff" || wide !== "\\u0100") return 3;
  if (same(ff, wide) || ff === "\\u0100") return 4;
  if (String.fromCharCode(0x10068) !== "h") return 5; // ToUint16
  if (String.fromCharCode(104, 0x100) !== "h\\u0100") return 6;
  if (String.fromCharCode(104, 105) !== "hi") return 7;
  if (String.fromCharCode(-1).charCodeAt(0) !== 0xffff) return 8;
  // 9-16: concatenation widens; one-byte parts stay one-byte.
  const latin = build([99, 97, 102, 0xe9]);
  if (latin !== "caf\\u00e9" || latin.length !== 4) return 9;
  const mixed = latin + wide;
  if (mixed.length !== 5 || mixed.charCodeAt(4) !== 0x100) return 10;
  if (mixed.charCodeAt(3) !== 0xe9 || mixed !== "caf\\u00e9\\u0100") return 11;
  const front = wide + latin;
  if (front.charCodeAt(0) !== 0x100 || front.charCodeAt(4) !== 0xe9) return 12;
  if (front !== "\\u0100caf\\u00e9") return 13;
  if ("" + wide !== "\\u0100" || latin + "" !== "caf\\u00e9") return 14;
  if (\`\${latin}-\${wide}\` !== "caf\\u00e9-\\u0100") return 15;
  if (\`<\${latin}>\` !== "<caf\\u00e9>") return 16;
  // 17-26: slices of a two-byte string narrow when every unit fits.
  const source = wide + "hello world" + wide;
  const hello = source.slice(1, 6);
  if (hello !== "hello" || hello.length !== 5) return 17;
  if (source.slice(1, -1) !== "hello world") return 18;
  if (source.slice(0, 1) !== "\\u0100" || source.slice(-1) !== "\\u0100")
    return 19;
  if (source.slice(3, 3) !== "" || source.slice(5, 2) !== "") return 20;
  if (source.substring(7, 12) !== "world") return 21;
  if (source.slice(0, 3) !== "\\u0100he") return 22;
  if (latin.slice(3) !== "\\u00e9" || latin.slice(1, 3) !== "af") return 23;
  if (source.charAt(1) !== "h" || source.charAt(0) !== "\\u0100") return 24;
  if (source.at(-2) !== "d") return 25;
  if (source.slice(2).slice(0, 4) !== "ello") return 26;
  // 27-34: surrogate pairs are two code units in two-byte strings.
  const smile = "\\u{1F600}";
  if (smile.length !== 2 || smile.charCodeAt(0) !== 0xd83d) return 27;
  if (smile.charCodeAt(1) !== 0xde00) return 28;
  const around = "a" + smile + "b";
  if (around.length !== 4 || around.slice(1, 3) !== smile) return 29;
  if (around.slice(0, 2) !== "a\\ud83d" || around.slice(2) !== "\\ude00b")
    return 30;
  if (around.slice(3) !== "b") return 31;
  if (around.codePointAt(1) !== 0x1f600) return 32;
  if (String.fromCodePoint(0x1f600) !== smile) return 33;
  if (String.fromCharCode(0xd83d) + String.fromCharCode(0xde00) !== smile)
    return 34;
  // 35-44: searches across kinds.
  const haystack = "x" + wide + "hello hello";
  if (haystack.indexOf("hello") !== 2 || haystack.lastIndexOf("hello") !== 8)
    return 35;
  if (haystack.indexOf(wide) !== 1 || "hello".indexOf(wide) !== -1) return 36;
  if (!haystack.includes("lo h") || haystack.includes("hellohello")) return 37;
  if (!haystack.startsWith("hello", 2) || haystack.startsWith("hello", 3))
    return 38;
  if (!haystack.startsWith("x" + wide) || "xy".startsWith(wide)) return 39;
  if (!haystack.endsWith("llo") || !front.endsWith("\\u00e9")) return 40;
  if ("caf\\u00e9".indexOf("\\u00e9") !== 3) return 41;
  if (haystack.indexOf("") !== 0 || haystack.lastIndexOf("") !== 13) return 42;
  if ("abc".includes("abcd") || !"abc".includes("")) return 43;
  if (latin.indexOf(String.fromCharCode(0xe9 + 0x100)) !== -1) return 44;
  // 45-52: joins choose the kind from every part.
  if (["a", "b", "c"].join("-") !== "a-b-c") return 45;
  if (["a", wide, "c"].join("") !== "a\\u0100c") return 46;
  if (["a", "b"].join(wide) !== "a\\u0100b") return 47;
  if ([latin, latin].join("") !== "caf\\u00e9caf\\u00e9") return 48;
  const numbers = [1, 22, 333];
  if (numbers.join(",") !== "1,22,333") return 49;
  const empty: string[] = [];
  if (empty.join(wide) !== "" || [wide].join("x") !== "\\u0100") return 50;
  if (repeatUnit(0xe9, 12) !== "\\u00e9\\u00e9\\u00e9\\u00e9\\u00e9\\u00e9\\u00e9\\u00e9\\u00e9\\u00e9\\u00e9\\u00e9")
    return 51;
  if (repeatUnit(0x101, 3) !== "\\u0101\\u0101\\u0101") return 52;
  // 53-60: equality with literals of every inline width.
  const word9 = build([105, 110, 115, 116, 97, 110, 99, 101, 111]);
  if (word9 !== "instanceo" || word9 === "instancef") return 53;
  const word31 = repeatUnit(97, 30) + "b";
  if (word31 !== "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaab") return 54;
  if (word31 === "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") return 55;
  const word33 = repeatUnit(97, 32) + "b";
  if (word33 !== "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab") return 56;
  const short = build([0xe9, 0x100]);
  if (short !== "\\u00e9\\u0100" || short === "\\u00e9\\u00ff") return 57;
  const wide8 = repeatUnit(0x3b1, 8);
  if (wide8 !== "\\u03b1\\u03b1\\u03b1\\u03b1\\u03b1\\u03b1\\u03b1\\u03b1") return 58;
  if (wide8 === "\\u03b1\\u03b1\\u03b1\\u03b1\\u03b1\\u03b1\\u03b1\\u03b2") return 59;
  if (build([]) !== "" || "" !== source.slice(4, 4)) return 60;
  // 61-66: switch dispatch on fresh strings.
  let hits = 0;
  const words = (wide + "if while class " + wide + "return").slice(1).split(" ");
  for (let i = 0; i < words.length; i++) {
    switch (words[i] ?? "") {
      case "if":
        hits += 1;
        break;
      case "while":
        hits += 10;
        break;
      case "class":
        hits += 100;
        break;
      case "\\u0100return":
        hits += 1000;
        break;
      default:
        hits += 10000;
    }
  }
  if (hits !== 1111) return 61;
  if (words.length !== 4 || words[3] !== "\\u0100return") return 62;
  const parts = ("a" + wide + "b" + wide + "c").split(wide);
  if (parts.length !== 3 || parts[0] !== "a" || parts[2] !== "c") return 63;
  if ("a,b".split(",")[1] !== "b") return 64;
  if (String(123) !== "123" || String(-0.5) !== "-0.5") return 65;
  if (String(1 / 0) !== "Infinity" || \`\${2.5}\` !== "2.5") return 66;
  // 67-72: maps hash code units, whatever the kind.
  const map = new Map<string, number>();
  map.set("hello", 1);
  map.set("\\u0100", 2);
  map.set("caf\\u00e9", 3);
  if (map.get(hello) !== 1 || map.get(source.slice(0, 1)) !== 2) return 67;
  if (map.get(latin) !== 3 || map.get("hello" + wide) !== undefined) return 68;
  map.set(source.slice(7, 12), 4);
  if (map.get("world") !== 4 || map.size !== 4) return 69;
  // Mixed kinds of one length hash equal when the units are equal.
  if (sumUnits(hello) !== sumUnits("hello")) return 70;
  if (sumUnits(source) === sumUnits("\\u00ffhello world\\u00ff")) return 71;
  if (sumUnits(ff + ff) !== sumUnits("\\u00ff\\u00ff")) return 72;
  // 73-78: out-of-range indices, padding, trimming and repetition.
  if (!Number.isNaN(latin.charCodeAt(4)) || !Number.isNaN(latin.charCodeAt(-1)))
    return 73;
  if ("ab".padStart(4, wide) !== "\\u0100\\u0100ab") return 74;
  if ("ab".padEnd(5, "\\u00e9") !== "ab\\u00e9\\u00e9\\u00e9") return 75;
  if ((wide + " x " + wide).slice(1, -1).trim() !== "x") return 76;
  if (latin.repeat(2) !== "caf\\u00e9caf\\u00e9" || wide.repeat(0) !== "")
    return 77;
  if ("  \\u00e9 ".trim() !== "\\u00e9") return 78;
  // 79-82: a long built string keeps every unit.
  let long = "";
  for (let i = 0; i < 1000; i++) long += String.fromCharCode(32 + (i % 200));
  if (long.length !== 1000 || long.charCodeAt(999) !== 32 + (999 % 200))
    return 79;
  const longWide = long + wide;
  if (longWide.charCodeAt(500) !== long.charCodeAt(500)) return 80;
  if (longWide.slice(0, 1000) !== long) return 81;
  if (longWide.slice(990, 1000) !== long.slice(990)) return 82;
  // 83-92: search positions, overlong and empty searches, partial matches.
  const twice = build([97, 98, 99, 97, 98, 99]);
  if (twice.indexOf("abc", 1) !== 3 || twice.indexOf("abc", 4) !== -1)
    return 83;
  if (twice.lastIndexOf("abc", 2) !== 0 || twice.lastIndexOf("abc", 3) !== 3)
    return 84;
  if (twice.lastIndexOf("abc", -5) !== 0 || twice.indexOf("abc", -5) !== 0)
    return 85;
  if ("abc".indexOf("abcd") !== -1 || "abc".lastIndexOf("abcd") !== -1)
    return 86;
  if (twice.indexOf("", 10) !== 6 || twice.lastIndexOf("", 1) !== 1) return 87;
  if ("aaa".lastIndexOf("aa") !== 1 || "aaa".indexOf("aa", 1) !== 1) return 88;
  const wideTwice = wide + "ab" + wide + "ab";
  if (wideTwice.indexOf("ab", 2) !== 4 || wideTwice.lastIndexOf(wide + "ab") !== 3)
    return 89;
  const nan = 0 / 0;
  if (twice.lastIndexOf("abc", nan) !== 3 || twice.indexOf("abc", nan) !== 0)
    return 90;
  if (build([97, 97, 98]).indexOf("ab") !== 1 || "abab".lastIndexOf("ba") !== 1)
    return 91;
  if (wideTwice.indexOf(String.fromCharCode(0x100, 97)) !== 0 || wideTwice.includes("ba"))
    return 92;
  // 95-99: templates and + chains built at once keep order and kinds.
  let counter = 0;
  function tick(): number {
    counter++;
    return counter;
  }
  const chain = "a" + tick() + "b" + tick() + "c" + tick();
  if (chain !== "a1b2c3" || counter !== 3) return 95;
  const flag = counter > 2;
  if ("x" + flag + 1 + "y" !== "xtrue1y" || 1 + 2 + "z" !== "3z" || "z" + 1 + 2 !== "z12")
    return 96;
  const name = build([110, 97]);
  if (\`\${name}\` !== "na" || \`\${name}\${name}\` !== "nana" || \`\` !== "" || \`[\${tick()}]\` !== "[4]")
    return 97;
  const joinedText = \`\${name}-\${wide}-\${counter}\`;
  if (joinedText !== "na-\u0100-4" || joinedText.length !== 6 || joinedText.charCodeAt(3) !== 0x100)
    return 98;
  const latinChain = name + "\u00e9" + name + String(counter);
  if (latinChain !== "na\u00e9na4" || latinChain === "na\u00e9na5") return 99;
  // 93-94: ToUint16 of fractional, non-finite, negative and large units.
  if (unitOf(104.9) !== 104 || unitOf(-0.5) !== 0 || unitOf(0 / 0) !== 0)
    return 93;
  if (unitOf(1 / 0) !== 0 || unitOf(-1) !== 0xffff || unitOf(4294967296 + 104) !== 104 || unitOf(-65536.5) !== 0)
    return 94;
  // 100-102: one-unit strings, below 256 from the pooled table and above it
  // allocated, equal their literals, joins and slices, and serve as keys.
  const units: string[] = [];
  for (let unit = 0; unit < 0x200; unit++) {
    const one = String.fromCharCode(unit),
      again = String.fromCharCode(unit + 0x10000);
    if (one.length !== 1 || one.charCodeAt(0) !== unit || one !== again) return 100;
    if (one !== repeatUnit(unit, 1) || one + one !== repeatUnit(unit, 2)) return 100;
    units.push(one);
  }
  const unitText = units.join("");
  for (let unit = 0; unit < 0x200; unit += 7)
    if (unitText.slice(unit, unit + 1) !== String.fromCharCode(unit)) return 101;
  const keyed = new Map<string, number>();
  for (let unit = 0; unit < 0x200; unit++) keyed.set(units[unit] ?? "", unit);
  if (keyed.get("a") !== 97 || keyed.get("\u00ff") !== 255 || keyed.get("\u0100") !== 256)
    return 102;
  if (String.fromCharCode(97) !== "a" || String.fromCharCode(0xe9) !== "\u00e9") return 102;
  return 42;
}
`;

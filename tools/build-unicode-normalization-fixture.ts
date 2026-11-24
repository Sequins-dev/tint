import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyHostedFixture } from "./hosted-fixture.ts";
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("normalization fixture requires TINT_BUILD_ONLY=1");
const path = process.argv[2];
if (path === undefined)
  throw Error(
    "usage: node tools/build-unicode-normalization-fixture.ts <Unicode17 NormalizationTest.txt>",
  );
const bytes = readFileSync(path);
assert.equal(
  createHash("sha256").update(bytes).digest("hex"),
  "5019ffd530751a741900c849c0e010332f142a3612234639bd200b82138a87db",
);
const rows: string[][] = [];
for (const line of new TextDecoder().decode(bytes).split("\n")) {
  const text = line.split("#")[0]!.trim();
  if (text.length === 0 || text.startsWith("@")) continue;
  const columns = text
    .split(";")
    .slice(0, 5)
    .map((field) =>
      String.fromCodePoint(
        ...field
          .trim()
          .split(/\s+/)
          .map((point) => parseInt(point, 16)),
      ),
    );
  assert.equal(columns.length, 5);
  assert.ok(columns.every((column) => !column.includes("\u0000")));
  rows.push(columns);
}
assert.equal(rows.length, 20034);
// ASCII escapes preserve every UTF-16 code unit through source-file encoding.
const vectors = JSON.stringify(rows.flat().join("\u0000") + "\u0000").replace(
  /[\u007f-\uffff]/g,
  (unit) => "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0"),
);
verifyHostedFixture(
  `import {normalizeUnicode} from "normalization";
const vectors:string=${vectors};
export function run():number {
 const fields=vectors.split(String.fromCharCode(0));
 if(fields.length!==${rows.length * 5 + 1})return 1;
 let checked=0;
 for(let offset=0;offset+4<fields.length;offset+=5){
  const source=fields[offset],nfc=fields[offset+1],nfd=fields[offset+2],nfkc=fields[offset+3],nfkd=fields[offset+4];
  if(source===undefined||nfc===undefined||nfd===undefined||nfkc===undefined||nfkd===undefined)return 2;
  if(normalizeUnicode(source,"NFC")!==nfc)return 3;
  if(normalizeUnicode(source,"NFD")!==nfd)return 4;
  if(normalizeUnicode(source,"NFKC")!==nfkc)return 5;
  if(normalizeUnicode(source,"NFKD")!==nfkd)return 6;
  checked++;
 }
 if(checked!==${rows.length})return 7;
 if(normalizeUnicode(String.fromCharCode(55296))!==String.fromCharCode(55296))return 8;
 if(normalizeUnicode('a','nfc')!==undefined)return 9;
 const long="a"+String.fromCharCode(769,807).repeat(2048);
 const ordered="a"+String.fromCharCode(807).repeat(2048)+String.fromCharCode(769).repeat(2048);
 if(normalizeUnicode(long,"NFD")!==ordered)return 10;
 const dynamic=normalizeUnicode(long,"NFC");
 if(dynamic===undefined||normalizeUnicode(dynamic,"NFD")!==ordered)return 11;
 return 42;
}`,
  "unicode-normalization-v2",
  [["normalization", "packages/foundation/src/unicode/normalization/index.ts"]],
  [],
  [],
  [],
  {
    managedBytes: 33554432,
    allocationCapacity: 1048576,
    runtimeEntry: "initializeGenerationalRuntime",
  },
);

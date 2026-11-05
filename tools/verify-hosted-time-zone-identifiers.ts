import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readTimeZoneIdentifiers } from "@tint/foundation/chrono/time-zone-identifiers";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const bytes = readFileSync("/usr/share/zoneinfo/tzdata.zi");
const input = bytes.toString("utf8"),
  reference = readTimeZoneIdentifiers(input);
if (!reference.ok) throw new Error(JSON.stringify(reference));
let hash = 0;
for (const entry of reference.value.entries)
  for (const character of entry.identifier + "=" + entry.targetIdentifier + ";")
    hash = (hash * 33) ^ character.charCodeAt(0);
verifyHostedFixture(
  `import {readTimeZoneIdentifiers,lookupTimeZoneIdentifier} from "zones";
export function run():number {
 const result=readTimeZoneIdentifiers(${JSON.stringify(input)});
 if(!result.ok)return 1;
 if(result.value.entries.length!==${reference.value.entries.length})return 2;
 let hash=0;
 for(const entry of result.value.entries){
  if(entry===undefined)return 3;
  const text=entry.identifier+"="+entry.targetIdentifier+";";
  for(let i=0;i<text.length;i++)hash=(hash*33)^text.charCodeAt(i);
  const again=lookupTimeZoneIdentifier(result.value,entry.identifier);
  if(again===undefined||again.identifier!==entry.identifier||again.targetIdentifier!==entry.targetIdentifier)return 4;
 }
 if(hash!==${hash})return 5;
 const ny=lookupTimeZoneIdentifier(result.value,"uS/eAsTeRn");
 if(ny===undefined||ny.identifier!=="US/Eastern"||ny.targetIdentifier!=="America/New_York")return 6;
 for(const invalid of ["../Etc/UTC","America//New_York","America/../New_York","UTC\\0"]){
  if(invalid===undefined)return 7;
  if(lookupTimeZoneIdentifier(result.value,invalid)!==undefined)return 8;
 }
 for(const bad of ["L B A\\nL A B", "L Missing Alias", "Z A 0 - X\\nZ a 0 - X"]){
  if(bad===undefined)return 9;
  if(readTimeZoneIdentifiers(bad).ok)return 10;
 }
 return 42;
}`,
  "time-zone-identifiers",
  [["zones", "packages/foundation/src/chrono/time-zone-identifiers/index.ts"]],
);
console.log(
  JSON.stringify({
    dataPath: "/usr/share/zoneinfo/tzdata.zi",
    dataSha256: createHash("sha256").update(bytes).digest("hex"),
    entries: reference.value.entries.length,
    checksum: hash,
  }),
);

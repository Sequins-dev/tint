import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readTimeZoneIdentifiers } from "@tint/foundation/chrono/time-zone-identifiers";
import { resolveNamedTimeZoneIdentifier } from "@tint/js-runtime/objects";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const bytes = readFileSync("/usr/share/zoneinfo/tzdata.zi"),
  input = bytes.toString("utf8"),
  index = readTimeZoneIdentifiers(input);
if (!index.ok) throw new Error(JSON.stringify(index));
let hash = 0,
  unavailable = 0;
for (const entry of index.value.entries) {
  const resolved = resolveNamedTimeZoneIdentifier(
    index.value,
    entry.identifier,
  );
  if (resolved === undefined) throw new Error("Missing known identifier");
  if (resolved.primaryIdentifier === undefined) unavailable++;
  const text =
    resolved.identifier +
    "=" +
    (resolved.primaryIdentifier ?? "?") +
    "=" +
    resolved.dataIdentifier +
    ";";
  for (let i = 0; i < text.length; i++) hash = (hash * 33) ^ text.charCodeAt(i);
}
verifyHostedFixture(
  `import {readTimeZoneIdentifiers} from "zones";
import {resolveNamedTimeZoneIdentifier} from "object";
export function run():number {
 const index=readTimeZoneIdentifiers(${JSON.stringify(input)});
 if(!index.ok)return 1;
 let hash=0,unavailable=0;
 for(const entry of index.value.entries){
  if(entry===undefined)return 2;
  const resolved=resolveNamedTimeZoneIdentifier(index.value,entry.identifier);
  if(resolved===undefined)return 3;
  if(resolved.primaryIdentifier===undefined)unavailable++;
  const text=resolved.identifier+"="+(resolved.primaryIdentifier??"?")+"="+resolved.dataIdentifier+";";
  for(let i=0;i<text.length;i++)hash=(hash*33)^text.charCodeAt(i);
 }
 if(hash!==${hash}||unavailable!==${unavailable})return 4;
 if(resolveNamedTimeZoneIdentifier(index.value,"uS/eAsTeRn")?.primaryIdentifier!=="America/New_York")return 5;
 if(resolveNamedTimeZoneIdentifier(index.value,"Atlantic/Reykjavik")?.primaryIdentifier!=="Atlantic/Reykjavik")return 6;
 if(resolveNamedTimeZoneIdentifier(index.value,"Europe/Bratislava")?.primaryIdentifier!=="Europe/Bratislava")return 7;
 if(resolveNamedTimeZoneIdentifier(index.value,"Atlantic/Jan_Mayen")?.primaryIdentifier!=="Arctic/Longyearbyen")return 8;
 if(resolveNamedTimeZoneIdentifier(index.value,"Pacific/Truk")?.primaryIdentifier!=="Pacific/Chuuk")return 9;
 if(resolveNamedTimeZoneIdentifier(index.value,"Etc/GMT")?.primaryIdentifier!=="UTC")return 10;
 if(resolveNamedTimeZoneIdentifier(index.value,"../Etc/UTC")!==undefined)return 11;
 return 42;
}`,
  "time-zone-primary-identifiers",
  [
    ["zones", "packages/foundation/src/chrono/time-zone-identifiers/index.ts"],
    ["object", "packages/js-runtime/src/objects/index.ts"],
  ],
);
console.log(
  JSON.stringify({
    dataPath: "/usr/share/zoneinfo/tzdata.zi",
    dataSha256: createHash("sha256").update(bytes).digest("hex"),
    entries: index.value.entries.length,
    unavailable,
    checksum: hash,
  }),
);

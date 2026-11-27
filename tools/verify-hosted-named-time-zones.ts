import { readTimeZoneIdentifiers } from "@tint/foundation/chrono/time-zone-identifiers";
import {
  primaryTimeZoneIdentifiers,
  resolveNamedTimeZoneIdentifier,
} from "@tint/js-runtime/objects";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const metadata = readFileSync("/usr/share/zoneinfo/tzdata.zi"),
  ny = readFileSync("/usr/share/zoneinfo/America/New_York");
const expectedIndex = readTimeZoneIdentifiers(metadata.toString("utf8"));
if (!expectedIndex.ok) throw new Error("Invalid reference metadata");
// IANA links are host data: macOS links Atlantic/Reykjavik to Africa/Abidjan,
// while Debian's database (built with backzone) keeps Reykjavik a Zone. The
// property under test needs a database Link whose name and target are both
// ECMA-402 primary identifiers: the two share one transition model yet keep
// distinct identities. Take the first such host link of a fixed preference.
const linkCandidates = [
  "Atlantic/Reykjavik",
  "Europe/Bratislava",
  "Europe/Vatican",
  "Arctic/Longyearbyen",
];
function distinctPrimaryLink(name: string): string | undefined {
  if (!expectedIndex.ok) return undefined;
  const alias = resolveNamedTimeZoneIdentifier(expectedIndex.value, name);
  if (alias === undefined || alias.dataIdentifier === name) return undefined;
  const target = resolveNamedTimeZoneIdentifier(
    expectedIndex.value,
    alias.dataIdentifier,
  );
  return alias.primaryIdentifier === name &&
    target?.primaryIdentifier === alias.dataIdentifier
    ? alias.dataIdentifier
    : undefined;
}
const linkName = linkCandidates.find(
  (name) => distinctPrimaryLink(name) !== undefined,
);
if (linkName === undefined)
  throw new Error(
    "host tzdata links none of " +
      linkCandidates.join(", ") +
      " to another primary zone",
  );
const linkTarget = distinctPrimaryLink(linkName)!,
  linkTargetPath = "/usr/share/zoneinfo/" + linkTarget,
  linkTargetBytes = readFileSync(linkTargetPath);
const expectedPrimary = primaryTimeZoneIdentifiers(expectedIndex.value);
console.log(
  JSON.stringify({
    primaryCount: expectedPrimary.length,
    link: linkName + " -> " + linkTarget,
    kind: "named-zone-enumeration-native-build",
    sourceSnapshot: workspaceSourceIdentity(workspaceSources()),
  }),
);
verifyHostedFixture(
  `import {readTimeZoneIdentifiers} from "identifiers";
import {primaryTimeZoneIdentifiers,installIntlIntrinsics,getOwnProperty,createNamedTimeZoneProvider,interpretNamedZonedOffset,temporalStartOfDay,temporalTimeZoneOffsetNanoseconds,createObject,createErrorRealm,viewObjectValue,type TemporalNamedTimeZone,type ObjectHooks,type ScriptPropertyKey} from "object";
import {parseISODateTime} from "iso";
import {formatInteger,parseInteger} from "integer";
import {tzifOffsetSecondsAt} from "tzif";
export function run():number {
 const index=readTimeZoneIdentifiers(${JSON.stringify(metadata.toString("utf8"))});if(!index.ok)return 1;
 const nyBytes=new Uint8Array([${[...ny].join(",")}]),targetBytes=new Uint8Array([${[...linkTargetBytes].join(",")}]);
 const linkName=${JSON.stringify(linkName)},linkTarget=${JSON.stringify(linkTarget)};
 let reads=0;
 const provider=createNamedTimeZoneProvider(index.value,(name):Uint8Array|undefined=>{reads++;return name==="America/New_York"?nyBytes:name===linkTarget?targetBytes:name==="Europe/London"?new Uint8Array(4):undefined;});
 const alias=provider.lookup("uS/eAsTeRn"),ny=provider.lookup("America/New_York");
 if(alias.status!=="available"||ny.status!=="available")return 2;
 if(alias.zone!==ny.zone||alias.identifier.identifier!=="US/Eastern"||alias.identifier.primaryIdentifier!=="America/New_York")return 3;
 if(tzifOffsetSecondsAt(alias.zone,1710053999)!==-18000||tzifOffsetSecondsAt(alias.zone,1710054000)!==-14400)return 4;
 const target=provider.lookup(linkTarget),link=provider.lookup(linkName);
 if(target.status!=="available"||link.status!=="available")return 5;
 if(target.zone!==link.zone||target.identifier.primaryIdentifier!==linkTarget||link.identifier.primaryIdentifier!==linkName||reads!==2)return 6;
 const missing=provider.lookup("Europe/Kiev"),again=provider.lookup("Europe/Kyiv");
 if(missing.status!=="unavailable"||again.status!=="unavailable"||missing.error!=="MISSING_DATA"||again.error!=="MISSING_DATA"||reads!==3)return 7;
 const corrupt=provider.lookup("Europe/London");
 if(corrupt.status!=="unavailable"||corrupt.error!=="INVALID_TZIF")return 8;
 provider.lookup("Europe/London");
 if(provider.lookup("../Etc/UTC").status!=="unknown"||provider.lookup("Not/AZone").status!=="unknown"||reads!==4)return 9;
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(callee,receiver,args):unknown=>undefined};
 const root=createObject<ScriptPropertyKey,unknown>(undefined),realm=createErrorRealm(root,hooks);
 const zone:TemporalNamedTimeZone={kind:"named",identifier:alias.identifier.identifier,primaryIdentifier:alias.identifier.primaryIdentifier,model:alias.zone};
 const fold=parseISODateTime("2024-11-03T01:30:00.123456789").value;
 if(fold===undefined)return 10;
 if(formatInteger(interpretNamedZonedOffset(fold,zone,undefined,"reject",realm,"earlier",false),10)!=="1730611800123456789")return 11;
 if(formatInteger(interpretNamedZonedOffset(fold,zone,-18000000000000,"prefer",realm,"reject",false),10)!=="1730615400123456789")return 12;
 let rejected=false;try{interpretNamedZonedOffset(fold,zone,undefined,"reject",realm,"reject",false);}catch(error){const object=viewObjectValue(error,root);rejected=object!==undefined&&object.prototype===realm.prototypes.get("range");}if(!rejected)return 13;
 const gap=parseISODateTime("2024-03-10T02:30:00.000000001").value;if(gap===undefined)return 14;
 if(formatInteger(interpretNamedZonedOffset(gap,zone,undefined,"ignore",realm,"compatible",false),10)!=="1710055800000000001")return 15;
 if(formatInteger(temporalStartOfDay({year:2024,month:3,day:10},zone,realm),10)!=="1710046800000000000")return 16;
 const historical=parseISODateTime("1880-01-01T00:00").value;if(historical===undefined)return 17;
 if(formatInteger(interpretNamedZonedOffset(historical,zone,-17760000000000,"reject",realm,"compatible",true),10)!=="-2840123038000000000")return 18;
 const before=parseInteger("1710053999999999999",10),after=parseInteger("1710054000000000000",10);if(before===undefined||after===undefined)return 19;
 if(temporalTimeZoneOffsetNanoseconds(zone,before)!==-18000000000000||temporalTimeZoneOffsetNanoseconds(zone,after)!==-14400000000000)return 20;
 const primary=primaryTimeZoneIdentifiers(index.value),expected=${JSON.stringify(expectedPrimary)};
 if(primary.length!==expected.length)return 28;
 for(let i=0;i<primary.length;i++)if(primary[i]!==expected[i])return 29;
 if(primary.length<340||primary.indexOf("UTC")<0||primary.indexOf("US/Eastern")>=0)return 21;
 for(let i=1;i<primary.length;i++){const before=primary[i-1],after=primary[i];if(before===undefined||after===undefined||before>=after)return 22;}
 realm.availableTimeZoneIdentifiers=():readonly string[]=>primary;
 installIntlIntrinsics(root,realm,hooks);
 const intl=viewObjectValue(getOwnProperty<ScriptPropertyKey,unknown>(root,"Intl")?.value,root);if(intl===undefined)return 23;
 const method=viewObjectValue(getOwnProperty<ScriptPropertyKey,unknown>(intl,"supportedValuesOf")?.value,root),invoke=method?.internalRareSlots?.internalCall;if(invoke===undefined)return 24;
 const names=viewObjectValue(invoke(null,["timeZone"]),root);if(names===undefined||names.prototype!==realm.arrayPrototype||getOwnProperty<ScriptPropertyKey,unknown>(names,"length")?.value!==primary.length||invoke(null,["timeZone"])===names)return 25;
 for(let i=0;i<primary.length;i++)if(getOwnProperty<ScriptPropertyKey,unknown>(names,String(i))?.value!==primary[i])return 26;
 let invalid=false;try{invoke(null,["unknown"]);}catch(error){const object=viewObjectValue(error,root);invalid=object!==undefined&&object.prototype===realm.prototypes.get("range");}if(!invalid)return 27;
 return 42;
}`,
  "named-time-zones",
  [
    [
      "identifiers",
      "packages/foundation/src/chrono/time-zone-identifiers/index.ts",
    ],
    ["object", "packages/js-runtime/src/objects/index.ts"],
    ["tzif", "packages/foundation/src/chrono/tzif/index.ts"],
    ["iso", "packages/foundation/src/chrono/iso-date-time/index.ts"],
    ["integer", "packages/foundation/src/numeric/big-integer.ts"],
  ],
  [],
  ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"].map((name) => ({
    module: "packages/js-runtime/src/objects/index.ts",
    name,
    operation: "view",
  })),
  [
    {
      module: "packages/js-runtime/src/objects/index.ts",
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
);
console.log(
  JSON.stringify({
    data: (
      [
        ["/usr/share/zoneinfo/tzdata.zi", metadata],
        ["/usr/share/zoneinfo/America/New_York", ny],
        [linkTargetPath, linkTargetBytes],
      ] as const
    ).map(([path, bytes]) => ({
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })),
  }),
);

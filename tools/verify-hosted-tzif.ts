import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readTzif } from "@tint/foundation/chrono/tzif";
import {
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const bytes = new Uint8Array(
  readFileSync("/usr/share/zoneinfo/America/New_York"),
);
const expected = readTzif(bytes);
if (!expected.ok) throw Error(expected.error);
console.log(
  JSON.stringify({
    kind: "tzif-native-build",
    sourceSnapshot: workspaceSourceIdentity(workspaceSources()),
    fixture: {
      path: "/usr/share/zoneinfo/America/New_York",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    },
    transitions: expected.value.transitions.length,
    types: expected.value.types.length,
    footer: expected.value.footer,
  }),
);
verifyHostedFixture(
  `import {readTzif} from "tzif";
export function run():number {
 const bytes=new Uint8Array(${bytes.length});
 ${[...bytes].map((value, index) => `bytes[${index}]=${value};`).join("\n")}
 const read=readTzif(bytes);if(!read.ok)return 1;
 if(read.value.transitions.length!==${expected.value.transitions.length}||read.value.types.length!==${expected.value.types.length}||read.value.footer!==${JSON.stringify(expected.value.footer)})return 2;
 ${expected.value.types.map((type, index) => `{const item=read.value.types[${index}];if(item===undefined||item.offsetSeconds!==${type.offsetSeconds}||item.daylightSaving!==${type.daylightSaving})return 3;}`).join("\n")}
 ${expected.value.transitions.map((type, index) => `{const item=read.value.transitions[${index}];if(item===undefined||item.at.lo!==${type.at.lo}||item.at.hi!==${type.at.hi}||item.type!==${type.type})return 4;}`).join("\n")}
 bytes[0]=0;if(readTzif(bytes).ok)return 5;
 return 42;
}`,
  "tzif",
  [["tzif", "packages/foundation/src/chrono/tzif/index.ts"]],
);

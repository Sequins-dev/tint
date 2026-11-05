import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
const directory = mkdtempSync(join(tmpdir(), "tint-readlink-resource-"));
const target = "../" + "x".repeat(510) + "/😀.ts";
const link = join(directory, "alias🌟");
const regular = join(directory, "regular");
symlinkSync(target, link);
writeFileSync(regular, "regular file");
assert.equal(readlinkSync(link), target);
console.log(
  JSON.stringify({
    kind: "readlink-native-build",
    sourceSnapshot: workspaceSourceIdentity(workspaceSources()),
    directory,
    link,
    target,
    regular,
  }),
);
verifyHostedFixture(
  `import {readlinkSync} from "fs";
export function run():number {
 if(readlinkSync(${JSON.stringify(link)})!==${JSON.stringify(target)})return 1;
 let missing=false;try{readlinkSync(${JSON.stringify(join(directory, "missing"))});}catch(error){missing=true;}if(!missing)return 2;
 let regular=false;try{readlinkSync(${JSON.stringify(regular)});}catch(error){regular=true;}if(!regular)return 3;
 let invalid=false;try{readlinkSync("invalid\\0path");}catch(error){invalid=true;}if(!invalid)return 4;
 return 42;
}`,
  "readlink",
  [["fs", "packages/platform/src/darwin/fs.ts"]],
);

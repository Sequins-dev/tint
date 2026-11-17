import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";

// The image's nativeHostTarget() is the target it was built for (the
// `target-os` build fact), and the file host it selects names errno values
// with that OS's numbering: ELOOP is 62 on Darwin and 40 on Linux. Build
// with TINT_NATIVE_TARGET to check another target's image on its host.
const target = nativeFixtureTarget().name;
const directory = mkdtempSync(join(tmpdir(), "tint-host-target-"));
const loop = join(directory, "loop");
symlinkSync("loop", loop);
console.log(JSON.stringify({ kind: "host-target-native-build", target, loop }));
verifyHostedFixture(
  `import {nativeHostTarget,targetFileHost} from "host";
export function run():number {
 const target=nativeHostTarget();
 if(target.name!==${JSON.stringify(target)})return 1;
 const opened=targetFileHost(target).openRead(${JSON.stringify(loop)});
 if(opened.ok)return 2;
 const error=opened.error;
 if(error.kind!=="host")return 3;
 if(error.code!=="ELOOP")return 4;
 return 42;
}`,
  "host-target",
  [["host", "packages/platform/src/host.ts"]],
);

import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {compileRegExp,executeRegExp} from "engine";
export function run():number {
 const compiled=compileRegExp("a","");if(!compiled.ok)return 1;
 const input="b".repeat(1000001);
 if(executeRegExp(compiled.value,input).kind!=="no-match")return 2;
 if(executeRegExp(compiled.value,input,0,false,1000000).kind!=="limit")return 3;
 return 42;
}`,
  "regexp-work-budget",
  [["engine", "packages/foundation/src/regexp/engine/index.ts"]],
  [],
  [],
  [],
  { managedBytes: 268435456, allocationCapacity: 8388608 },
);

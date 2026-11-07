import { verifyHostedFixture } from "./hosted-fixture.ts";
import { packLocaleTables } from "./pack-locale-data.ts";
const tables = [
    "\ufeffyear|é\nmonth|正月",
    "😀".repeat(257),
    "abc".repeat(24000),
    "",
  ],
  packed = packLocaleTables(tables);
verifyHostedFixture(
  `import {unpackLocaleData} from "packedData";
export function run():number {
 const values=unpackLocaleData(${JSON.stringify(packed.payload)},${packed.packedBytes});
 if(values.length!==4)return 1;
 if(values[0]!=="\\ufeffyear|é\\nmonth|正月")return 2;
 if(values[1]!=="😀".repeat(257))return 3;
 if(values[2]!=="abc".repeat(24000)||values[3]!=="")return 4;
 return 42;
}`,
  "locale-data-pack",
  [["packedData", "packages/js-runtime/src/objects/locale-data-pack.ts"]],
  [],
  [],
  [],
  {
    managedBytes: 268435456,
    allocationCapacity: 8388608,
    stackBytes: 16777216,
    rootCapacity: 16384,
  },
);

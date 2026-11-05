import assert from "node:assert/strict";
import { buildDebugInfo, type DebugRequest } from "@tint/image/dwarf";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const request: DebugRequest = {
  codeAddress: 0x100001000,
  codeLength: 32,
  directory: "/project",
  functions: [
    {
      name: "mapped",
      offset: 0,
      byteLength: 28,
      frame: {
        register: 73,
        ranges: [
          { offset: 4, byteLength: 8 },
          { offset: 16, byteLength: 8 },
        ],
        variables: [
          { name: "__tint_context", offset: -0xffffffff },
          { name: "日本語", offset: -129 },
          { name: "boundary", offset: -65 },
          { name: "zero", offset: 0 },
          { name: "positive", offset: 128 },
        ],
      },
    },
  ],
  lines: [{ offset: 4, byteLength: 4, file: "main.ts", line: 129, column: 65 }],
  maxByteLength: 10000,
};
const expected = buildDebugInfo(request);
assert.ok(expected.ok);
const bytes = expected.value;
verifyHostedFixture(
  `import {buildDebugInfo,type DebugRequest} from "debug";
function equal(actual:Uint8Array,expected:readonly number[]):boolean{
 if(actual.length!==expected.length)return false;
 for(let index=0;index<actual.length;index++)if(actual[index]!==expected[index])return false;
 return true;
}
export function run():number{
 const request:DebugRequest=${JSON.stringify(request)};
 const result=buildDebugInfo(request);if(!result.ok)return 1;
 if(!equal(result.value.abbrev,${JSON.stringify([...bytes.abbrev])}))return 2;
 if(!equal(result.value.info,${JSON.stringify([...bytes.info])}))return 3;
 if(!equal(result.value.line,${JSON.stringify([...bytes.line])}))return 4;
 const limited=buildDebugInfo({...request,maxByteLength:${bytes.abbrev.length + bytes.info.length + bytes.line.length - 1}});
 if(limited.ok||limited.error!=="SIZE_LIMIT")return 5;
 return 42;
}`,
  "dwarf",
  [["debug", "packages/image/src/dwarf.ts"]],
);

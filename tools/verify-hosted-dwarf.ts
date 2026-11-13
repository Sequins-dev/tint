import assert from "node:assert/strict";
import { buildDebugInfo, type DebugRequest } from "@tint/image/dwarf";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const request: { -readonly [K in keyof DebugRequest]: DebugRequest[K] } = {
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
  types: [
    { kind: "base", name: "number", byteSize: 8, encoding: "float" },
    { kind: "base", name: "char16_t", byteSize: 2, encoding: "utf" },
    { kind: "pointer", target: 3 },
    {
      kind: "structure",
      name: "Point",
      byteSize: 32,
      members: [
        { name: "x", type: 0, offset: 16 },
        { name: "next", type: 2, offset: 24 },
      ],
    },
    { kind: "base", name: "uint64", byteSize: 8, encoding: "unsigned" },
    {
      kind: "enumeration",
      name: "tag",
      byteSize: 8,
      base: 4,
      values: [
        { name: "undefined", value: 0 },
        { name: "object", value: 5 },
      ],
    },
    { kind: "array", element: 1, count: undefined },
  ],
  origins: ["util.ts:helper"],
  maxByteLength: 10000,
};
// Variables, pieces, views and inline scopes of a second function.
request.functions = [
  ...request.functions,
  {
    name: "described",
    offset: 28,
    byteLength: 4,
    variables: [
      {
        name: "value",
        type: 0,
        parameter: true,
        file: "main.ts",
        line: 3,
        locations: [
          {
            offset: 28,
            byteLength: 4,
            pieces: [
              { part: { kind: "register", register: 72 }, byteSize: 8 },
              {
                part: { kind: "memory", register: 29, offset: -24 },
                byteSize: 8,
              },
            ],
          },
        ],
      },
      {
        name: "text",
        type: 1,
        locations: [
          {
            offset: 28,
            byteLength: 4,
            pieces: [
              {
                part: {
                  kind: "pointer",
                  base: { kind: "register", register: 22 },
                  add: 24,
                  value: false,
                },
              },
            ],
          },
        ],
        count: [
          {
            offset: 28,
            byteLength: 4,
            pieces: [
              {
                part: {
                  kind: "pointer",
                  base: { kind: "memory", register: 29, offset: -8 },
                  add: 16,
                  value: true,
                },
              },
            ],
          },
        ],
      },
      { name: "gone", type: 2, locations: [] },
    ],
    inlined: [
      {
        origin: 0,
        callFile: "main.ts",
        callLine: 4,
        callColumn: 7,
        ranges: [{ offset: 28, byteLength: 4 }],
        variables: [],
        inlined: [],
      },
    ],
  },
];
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
 if(!equal(result.value.loc,${JSON.stringify([...bytes.loc])}))return 6;
 if(!equal(result.value.ranges,${JSON.stringify([...bytes.ranges])}))return 7;
 const limited=buildDebugInfo({...request,maxByteLength:${bytes.abbrev.length + bytes.info.length + bytes.line.length + bytes.loc.length + bytes.ranges.length - 1}});
 if(limited.ok||limited.error!=="SIZE_LIMIT")return 5;
 return 42;
}`,
  "dwarf",
  [["debug", "packages/image/src/dwarf.ts"]],
);
